import { createHash, randomBytes } from "node:crypto";
import { getClient, platformDb } from "@/lib/db/client";
import { newInstanceId, issueTenantContext } from "@/lib/tenant/context";
import { validateSubdomain } from "@/lib/tenant/host";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import { migrate, TENANT_MIGRATIONS } from "@/lib/db/migrations";
import { appendAudit } from "@/lib/audit/log";
import { PACK_BY_ID } from "@/catalog/packs";
import type { Actor } from "@/lib/auth/rbac";
import { authorize } from "@/lib/auth/rbac";
import { ensureDefaultPlans, type Plan } from "./plans";
import { ensurePlatform } from "./setup";

export type ProvisionInput = {
  name: string;
  subdomain: string;
  packId: string;
  planId: string;
  ownerEmail: string;
};

export type ProvisionResult =
  | { ok: true; instanceId: string; inviteToken: string; inviteExpiresAt: Date }
  | { ok: false; step: string; message: string };

export const INVITE_TTL_MS = 60 * 60 * 1000; // one-time setup link, 1 hour (SRS D-1)

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type Invite = {
  _id: string; // tokenHash
  instanceId: string;
  email: string;
  role: "store_owner";
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export async function createOwnerInvite(instanceId: string, email: string) {
  const db = await platformDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  // invalidate earlier unused invites for this owner
  await db.collection<Invite>("invites").updateMany({ instanceId, usedAt: null }, { $set: { usedAt: new Date() } });
  await db.collection<Invite>("invites").insertOne({
    _id: hashToken(token), instanceId, email, role: "store_owner", expiresAt, usedAt: null, createdAt: new Date(),
  });
  return { token, expiresAt };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Idempotent provisioning saga (SA-01, ADD-001). Each step is recorded; on failure
 * everything created so far is rolled back and the failing step is reported.
 * `failAt` exists only so tests can prove rollback.
 */
export async function provisionInstance(
  actor: Actor,
  input: ProvisionInput,
  opts: { failAt?: string } = {},
): Promise<ProvisionResult> {
  const allowed = authorize(actor, "instance.create");
  if (!allowed.allow) return { ok: false, step: "authorize", message: "You are not allowed to create stores." };

  const name = input.name.trim();
  const subdomain = input.subdomain.trim().toLowerCase();
  const email = input.ownerEmail.trim().toLowerCase();
  if (name.length < 2 || name.length > 60) return { ok: false, step: "validate", message: "Store name must be 2 to 60 characters." };
  if (!EMAIL_RE.test(email)) return { ok: false, step: "validate", message: "Enter a valid owner email address." };
  const sub = validateSubdomain(subdomain);
  if (!sub.ok) return { ok: false, step: "validate", message: sub.reason };
  const pack = PACK_BY_ID.get(input.packId);
  if (!pack) return { ok: false, step: "validate", message: "Choose an industry pack." };

  await ensurePlatform();
  await ensureDefaultPlans();
  const db = await platformDb();
  const plan = await db.collection<Plan>("plans").findOne({ _id: input.planId });
  if (!plan) return { ok: false, step: "validate", message: "Choose a plan." };

  const instanceId = newInstanceId();
  const ctx = issueTenantContext(instanceId);
  const instances = db.collection<InstanceRecord>("instances");
  const completed: string[] = [];
  let step = "reserve_subdomain";

  try {
    // 1. reserve: the unique index makes this atomic, so two requests cannot both win
    await instances.insertOne({
      _id: instanceId, name, subdomain, status: "provisioning", planId: plan._id, industryPack: pack.id, configVersion: 1,
    });
    completed.push(step);
    if (opts.failAt === step) throw new Error("injected failure");

    // 2. database and indexes
    step = "create_database";
    const tenantDb = (await getClient()).db(ctx.dbName);
    await migrate(tenantDb, TENANT_MIGRATIONS);
    completed.push(step);
    if (opts.failAt === step) throw new Error("injected failure");

    // 3. seed from the industry pack
    step = "seed_data";
    await tenantDb.collection("settings").updateOne(
      { instanceId },
      { $setOnInsert: { instanceId, configVersion: 1, ownerToggles: {}, branding: { storeName: name }, locale: "en", createdAt: new Date() } },
      { upsert: true },
    );
    if (pack.categories.length) {
      await tenantDb.collection("categories").insertMany(
        pack.categories.map((c, i) => ({ _id: `cat-${i + 1}` as never, instanceId, name: c, sortOrder: i })),
        { ordered: false },
      ).catch(() => undefined);
    }
    completed.push(step);
    if (opts.failAt === step) throw new Error("injected failure");

    // 4. owner invitation (one-time setup link, never a password)
    step = "owner_invite";
    const invite = await createOwnerInvite(instanceId, email);
    completed.push(step);
    if (opts.failAt === step) throw new Error("injected failure");

    // 5. activate
    step = "activate";
    await instances.updateOne({ _id: instanceId }, { $set: { status: "active" } });
    completed.push(step);

    await appendAudit({
      actorId: actor.userId, actorRole: actor.role, instanceId, action: "instance.create", target: subdomain, outcome: "success",
      after: { name, subdomain, plan: plan._id, pack: pack.id, ownerEmail: email },
    }).catch(() => undefined);
    return { ok: true, instanceId, inviteToken: invite.token, inviteExpiresAt: invite.expiresAt };
  } catch (e) {
    const duplicate = step === "reserve_subdomain" && (e as { code?: number }).code === 11000;
    // roll back everything created so far
    await Promise.allSettled([
      (await getClient()).db(ctx.dbName).dropDatabase(),
      db.collection("invites").deleteMany({ instanceId }),
      instances.deleteOne({ _id: instanceId }),
    ]);
    await appendAudit({
      actorId: actor.userId, actorRole: actor.role, instanceId: null, action: "instance.create", target: subdomain, outcome: "failure",
      after: { failedStep: step, completed },
    }).catch(() => undefined);
    return {
      ok: false,
      step,
      message: duplicate ? "That web address is already taken." : `Setup stopped at the "${step.replace(/_/g, " ")}" step. Nothing was created. Please try again.`,
    };
  }
}

export async function subdomainAvailable(name: string): Promise<boolean> {
  const db = await platformDb();
  return (await db.collection("instances").countDocuments({ subdomain: name })) === 0;
}

export async function suggestSubdomains(wanted: string, max = 3): Promise<string[]> {
  const base = wanted.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 22) || "store";
  const candidates = [`${base}-shop`, `${base}-store`, `${base}-online`, `${base}-${Math.floor(10 + Math.random() * 90)}`, `my-${base}`];
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= max) break;
    if (validateSubdomain(c).ok && (await subdomainAvailable(c))) out.push(c);
  }
  return out;
}
