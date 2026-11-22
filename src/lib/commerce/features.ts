import { platformDb } from "@/lib/db/client";
import { tenantDb } from "@/lib/tenant/schema";
import { issueTenantContext, type TenantContext } from "@/lib/tenant/context";
import { authorize, type Actor } from "@/lib/auth/rbac";
import { appendAudit } from "@/lib/audit/log";
import { CATALOG, TOGGLES } from "@/lib/toggles/catalog";
import { dependentsOf } from "@/lib/toggles/graph";
import { evaluateToggles } from "@/lib/toggles/evaluate";
import { clearResolutionCache, type InstanceRecord } from "@/lib/tenant/resolve";
import { clearToggleCache } from "@/lib/toggles/service";
import type { Plan } from "@/lib/platform/plans";
import { PACK_BY_ID } from "@/catalog/packs";
import type { Effective } from "@/lib/toggles/types";
import type { Features } from "./orders";

export function featuresFrom(eff: ReadonlyMap<string, Effective>): Features {
  const on = (id: string) => eff.get(id)?.enabled ?? false;
  return { shipping: on("F-063"), freeShipping: on("F-065"), tax: on("F-042"), discounts: on("F-053"), cod: on("F-038"), card: on("F-037"), emails: on("F-030"), stockTracking: on("F-019"), manualBank: on("F-039"), wallet: on("F-040"), lowStock: on("F-020"), maintenance: on("F-110"), autoPromos: on("F-054"), flashSales: on("F-056"), couponLimits: on("F-057"), backorders: on("F-022"), hours: on("F-018"), zones: on("F-071"), orderTypes: on("F-017"), pickup: on("F-034"), tableQr: on("F-016"), scheduled: on("F-035"), throttle: on("F-125") };
}

export type ChangeResult = { ok: true; changed: string[] } | { ok: false; error: string };

async function context(instance: InstanceRecord) {
  const db = await platformDb();
  const plan = await db.collection<Plan>("plans").findOne({ _id: instance.planId });
  const ctx = issueTenantContext(instance._id);
  const settings = await (await tenantDb(ctx)).collection<{ ownerToggles?: Record<string, boolean> }>("settings").findOne({ instanceId: instance._id });
  const killSwitch = (await db.collection<{ killSwitch?: Record<string, boolean> }>("global_flags").findOne({ _id: "global" as never }))?.killSwitch;
  const inputBase = {
    killSwitch, locks: instance.toggleLocks, overrides: instance.toggleOverrides,
    planIncludes: plan?.includedToggles ? new Set(plan.includedToggles) : undefined,
    packDefaults: instance.industryPack ? PACK_BY_ID.get(instance.industryPack)?.toggles : undefined,
  };
  return { db, ctx, plan, owner: settings?.ownerToggles ?? {}, inputBase };
}

/** The store owner's view: what can they change, and why not. */
export async function featureStates(instance: InstanceRecord) {
  const { owner, inputBase } = await context(instance);
  const eff = evaluateToggles({ ...inputBase, owner });
  return TOGGLES.map((d) => {
    const e = eff.get(d.id)!;
    const locked = e.source === "instance_lock" || e.source === "kill_switch" || e.source === "instance_override";
    return { def: d, effective: e, locked, outOfPlan: e.source === "not_in_plan", dependents: dependentsOf(d.id, TOGGLES) };
  });
}

/** Missing prerequisite chain for turning `id` on (first member of each unmet OR group, recursively). */
export function prerequisiteChain(id: string, eff: ReadonlyMap<string, Effective>, seen = new Set<string>()): string[] {
  const def = CATALOG.get(id);
  if (!def || seen.has(id)) return [];
  seen.add(id);
  const out: string[] = [];
  for (const group of def.requires) {
    if (group.some((p) => eff.get(p)?.enabled)) continue;
    const blocked = new Set(["not_in_plan", "instance_lock", "kill_switch", "instance_override"]);
    const pick = group.find((p) => !blocked.has(eff.get(p)?.source ?? "")) ?? group[0];
    out.push(...prerequisiteChain(pick, eff, seen), pick);
  }
  return out;
}

async function bumpAll(instance: InstanceRecord, ctx: TenantContext) {
  await (await platformDb()).collection<InstanceRecord>("instances").updateOne({ _id: instance._id }, { $inc: { configVersion: 1 } });
  await (await tenantDb(ctx)).collection("settings").updateOne({ instanceId: instance._id }, { $inc: { configVersion: 1 } }, { upsert: true });
  clearResolutionCache();
  clearToggleCache();
}

/** Owner turns a feature on or off (within plan, never against a lock). `cascade` also handles prerequisites / dependents. */
export async function setOwnerFeature(instance: InstanceRecord, actor: Actor, id: string, value: boolean, cascade: boolean): Promise<ChangeResult> {
  const { ctx } = await context(instance);
  if (!authorize(actor, "toggle.enable", ctx).allow) return { ok: false, error: "Only the store owner can change features." };
  const def = CATALOG.get(id);
  if (!def) return { ok: false, error: "Unknown feature." };
  const { owner, inputBase } = await context(instance);
  const eff = evaluateToggles({ ...inputBase, owner });
  const cur = eff.get(id)!;
  if (cur.source === "instance_lock" || cur.source === "kill_switch") return { ok: false, error: "This feature is locked by the platform administrator." };
  if (cur.source === "instance_override") return { ok: false, error: "This feature is managed by the platform administrator." };
  if (cur.source === "not_in_plan" && value) return { ok: false, error: "Your plan does not include this feature. Upgrade to turn it on." };

  const set: Record<string, boolean> = {};
  if (value) {
    const chain = prerequisiteChain(id, eff);
    if (chain.length && !cascade) return { ok: false, error: `Turn on ${chain.map((c) => CATALOG.get(c)?.name ?? c).join(", ")} first.` };
    for (const c of chain) {
      const e = eff.get(c)!;
      if (e.source === "not_in_plan" || e.source === "instance_lock" || e.source === "kill_switch" || e.source === "instance_override") {
        return { ok: false, error: `${CATALOG.get(c)?.name ?? c} is needed first, but it is not available on your store.` };
      }
      set[c] = true;
    }
    set[id] = true;
  } else {
    const deps = dependentsOf(id, TOGGLES).filter((d) => eff.get(d)?.enabled);
    if (deps.length && !cascade) return { ok: false, error: `These features need it: ${deps.map((d) => CATALOG.get(d)?.name ?? d).join(", ")}.` };
    for (const d of deps) {
      const e = eff.get(d)!;
      if (e.source === "instance_lock" || e.source === "kill_switch" || e.source === "instance_override") return { ok: false, error: `${CATALOG.get(d)?.name ?? d} depends on it but is locked by the administrator.` };
      set[d] = false;
    }
    set[id] = false;
  }

  const db = await tenantDb(ctx);
  const before: Record<string, boolean | null> = {};
  for (const k of Object.keys(set)) before[k] = owner[k] ?? null;
  await db.collection("settings").updateOne(
    { instanceId: instance._id },
    { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`ownerToggles.${k}`, v])) },
    { upsert: true },
  );
  // 24-hour undo window (ST-16): keep the previous values
  await db.collection("settings_history").insertOne({ instanceId: instance._id, at: new Date(), by: actor.userId, kind: "features", before, after: set, undone: false });
  await bumpAll(instance, ctx);
  await appendAudit({ actorId: actor.userId, actorRole: actor.role, instanceId: instance._id, action: "toggle.owner_set", target: id, outcome: "success", before, after: set }).catch(() => undefined);
  return { ok: true, changed: Object.keys(set) };
}

export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function recentChanges(ctx: TenantContext, now = new Date()) {
  const db = await tenantDb(ctx);
  const rows = await db.collection("settings_history").find({ instanceId: ctx.instanceId, undone: false, at: { $gt: new Date(now.getTime() - UNDO_WINDOW_MS) } }).sort({ at: -1 }).limit(10).toArray();
  return rows.map((r) => ({ id: String(r._id), at: r.at as Date, kind: r.kind as string, keys: Object.keys(r.after ?? {}) }));
}

/** Restore the previous values of a recent change. Expires after 24 hours; the undo itself is audited. */
export async function undoChange(instance: InstanceRecord, actor: Actor, historyId: string, now = new Date()): Promise<ChangeResult> {
  const { ctx } = await context(instance);
  if (!authorize(actor, "toggle.enable", ctx).allow) return { ok: false, error: "Only the store owner can undo changes." };
  const db = await tenantDb(ctx);
  const { ObjectId } = await import("mongodb");
  let oid;
  try { oid = new ObjectId(historyId); } catch { return { ok: false, error: "Change not found." }; }
  const row = await db.collection("settings_history").findOneAndUpdate(
    { _id: oid, instanceId: instance._id, undone: false, at: { $gt: new Date(now.getTime() - UNDO_WINDOW_MS) } },
    { $set: { undone: true, undoneAt: now } },
  );
  if (!row) return { ok: false, error: "This change can no longer be undone (it is older than 24 hours or was already undone)." };
  if (row.kind === "features") {
    const set: Record<string, unknown> = {}, unset: Record<string, ""> = {};
    for (const [k, v] of Object.entries(row.before as Record<string, boolean | null>)) {
      if (v === null) unset[`ownerToggles.${k}`] = ""; else set[`ownerToggles.${k}`] = v;
    }
    await db.collection("settings").updateOne({ instanceId: instance._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  }
  await bumpAll(instance, ctx);
  await appendAudit({ actorId: actor.userId, actorRole: actor.role, instanceId: instance._id, action: "settings.undo", target: historyId, outcome: "success" }).catch(() => undefined);
  return { ok: true, changed: Object.keys(row.after ?? {}) };
}

import type { Settings } from "./types";
import type { PricingConfig } from "./pricing";

export function pricingConfig(settings: Settings, feat: Features): PricingConfig {
  return {
    currency: settings.currency, taxBps: settings.taxBps, taxEnabled: feat.tax,
    shippingFlatMinor: feat.shipping ? settings.shippingFlatMinor : 0,
    freeShippingOverMinor: feat.freeShipping ? settings.freeShippingOverMinor : null,
  };
}
