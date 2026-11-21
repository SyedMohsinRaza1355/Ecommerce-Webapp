import { platformDb } from "@/lib/db/client";
import { authorize, type Actor } from "@/lib/auth/rbac";
import { appendAudit } from "@/lib/audit/log";
import { CATALOG } from "@/lib/toggles/catalog";
import { clearResolutionCache, type InstanceRecord } from "@/lib/tenant/resolve";
import { clearToggleCache } from "@/lib/toggles/service";
import { createOwnerInvite } from "./provision";
import type { Plan } from "./plans";

export type ManageResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };
export type ToggleRule = "none" | "override_on" | "override_off" | "lock_on" | "lock_off";

const deny = (action: string, actor: Actor): ManageResult => ({
  ok: false,
  message: `Your role (${actor.role}) cannot do "${action}".`,
});

async function load(instanceId: string) {
  const db = await platformDb();
  const col = db.collection<InstanceRecord>("instances");
  return { db, col, inst: await col.findOne({ _id: instanceId }) };
}

/** Every change increments configVersion so caches refetch within 30 seconds (SRS 7.2). */
const bump = { $inc: { configVersion: 1 } };

function afterChange() {
  clearResolutionCache();
  clearToggleCache();
}

export async function setInstanceStatus(actor: Actor, instanceId: string, to: "active" | "suspended"): Promise<ManageResult> {
  if (!authorize(actor, "instance.suspend").allow) return deny("instance.suspend", actor);
  const { col, inst } = await load(instanceId);
  if (!inst) return { ok: false, message: "Store not found." };
  if (inst.status !== "active" && inst.status !== "suspended") return { ok: false, message: "Only active or suspended stores can be changed." };
  if (inst.status === to) return { ok: true }; // idempotent
  await col.updateOne({ _id: instanceId }, { $set: { status: to }, ...bump });
  afterChange();
  await appendAudit({
    actorId: actor.userId, actorRole: actor.role, instanceId, action: to === "suspended" ? "instance.suspend" : "instance.reactivate",
    target: inst.subdomain, outcome: "success", before: { status: inst.status }, after: { status: to },
  }).catch(() => undefined);
  return { ok: true };
}

export async function changePlan(actor: Actor, instanceId: string, planId: string): Promise<ManageResult<{ switchedOff: number }>> {
  if (!authorize(actor, "plan.set").allow) return deny("plan.set", actor) as ManageResult<{ switchedOff: number }>;
  const { db, col, inst } = await load(instanceId);
  if (!inst) return { ok: false, message: "Store not found." };
  const [oldPlan, newPlan] = await Promise.all([
    db.collection<Plan>("plans").findOne({ _id: inst.planId }),
    db.collection<Plan>("plans").findOne({ _id: planId }),
  ]);
  if (!newPlan) return { ok: false, message: "Plan not found." };
  if (inst.planId === planId) return { ok: true, switchedOff: 0 };
  // Features outside the new plan evaluate Off; no data is deleted (SA-03).
  const gone = (oldPlan?.includedToggles ?? []).filter((t) => !newPlan.includedToggles.includes(t)).length;
  await col.updateOne({ _id: instanceId }, { $set: { planId }, ...bump });
  afterChange();
  await appendAudit({
    actorId: actor.userId, actorRole: actor.role, instanceId, action: "plan.set", target: inst.subdomain, outcome: "success",
    before: { planId: inst.planId }, after: { planId, featuresSwitchedOff: gone },
  }).catch(() => undefined);
  return { ok: true, switchedOff: gone };
}

export async function setToggleRule(actor: Actor, instanceId: string, toggleId: string, rule: ToggleRule): Promise<ManageResult> {
  const needed = rule.startsWith("lock") ? "setting.lock" : "setting.override";
  // clearing a rule needs the permission for whichever kind exists; super admin holds both
  if (!authorize(actor, needed).allow) return deny(needed, actor);
  if (!CATALOG.has(toggleId)) return { ok: false, message: "Unknown feature." };
  const { col, inst } = await load(instanceId);
  if (!inst) return { ok: false, message: "Store not found." };

  const locks = { ...(inst.toggleLocks ?? {}) };
  const overrides = { ...(inst.toggleOverrides ?? {}) };
  const before = { lock: locks[toggleId], override: overrides[toggleId] };
  delete locks[toggleId];
  delete overrides[toggleId];
  if (rule === "lock_on") locks[toggleId] = true;
  if (rule === "lock_off") locks[toggleId] = false;
  if (rule === "override_on") overrides[toggleId] = true;
  if (rule === "override_off") overrides[toggleId] = false;

  await col.updateOne({ _id: instanceId }, { $set: { toggleLocks: locks, toggleOverrides: overrides }, ...bump });
  afterChange();
  await appendAudit({
    actorId: actor.userId, actorRole: actor.role, instanceId, action: `toggle.${rule === "none" ? "clear_rule" : rule}`,
    target: toggleId, outcome: "success", before, after: { lock: locks[toggleId], override: overrides[toggleId] },
  }).catch(() => undefined);
  return { ok: true };
}

export async function regenerateOwnerInvite(actor: Actor, instanceId: string, ownerEmail: string): Promise<ManageResult<{ token: string; expiresAt: Date }>> {
  if (!authorize(actor, "owner.password.reset").allow) return deny("owner.password.reset", actor) as ManageResult<{ token: string; expiresAt: Date }>;
  const email = ownerEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter a valid owner email address." };
  const { inst } = await load(instanceId);
  if (!inst) return { ok: false, message: "Store not found." };
  const { token, expiresAt } = await createOwnerInvite(instanceId, email);
  await appendAudit({
    actorId: actor.userId, actorRole: actor.role, instanceId, action: "owner.password.reset", target: inst.subdomain, outcome: "success",
    after: { ownerEmail: email },
  }).catch(() => undefined);
  return { ok: true, token, expiresAt };
}
