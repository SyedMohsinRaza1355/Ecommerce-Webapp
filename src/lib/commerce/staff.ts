import { TenantRepo } from "@/lib/tenant/repo";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/ratelimit";
import { newTotpSecret, verifyTotp } from "@/lib/auth/totp";
import { authorize, type Actor } from "@/lib/auth/rbac";
import { createOwnerInvite, type Invite } from "@/lib/platform/provision";
import { platformDb } from "@/lib/db/client";
import { appendAudit } from "@/lib/audit/log";

export type StaffRole = "store_owner" | "manager" | "cashier" | "kitchen_ops";
export const STAFF_ROLES: StaffRole[] = ["store_owner", "manager", "cashier", "kitchen_ops"];
export const INVITABLE_ROLES: StaffRole[] = ["manager", "cashier", "kitchen_ops"];

export type StaffUser = {
  _id: string;
  instanceId?: string;
  email: string;
  passwordHash: string;
  role: StaffRole;
  disabled?: boolean;
  totp?: { secret: string; enabled: boolean; lastStep: number };
  createdAt: Date;
  lastLoginAt?: Date;
  /** sessions issued before this moment are no longer valid */
  sessionsValidAfter?: Date;
};

export const users = new TenantRepo<StaffUser>("users");

// bcrypt hash of a random string: unknown emails cost the same time as known ones
const DUMMY = "$2b$12$JGGTdxtQhWFC5TBm.BE7x.ZjWZBcVDJdMlBM5q38AgBxgONjKDkl2";

export type AuthResult =
  | { ok: true; user: StaffUser }
  | { ok: false; reason: "invalid" | "rate_limited" | "code_required" | "bad_code" | "disabled"; retryAfterSec?: number };

export async function authenticateStaff(ctx: TenantContext, email: string, password: string, code: string | undefined, ip: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  const rl = await rateLimit(`staff:${ctx.instanceId}:${ip}:${e}`, 5, 60_000);
  if (!rl.ok) return { ok: false, reason: "rate_limited", retryAfterSec: rl.retryAfterSec };
  const user = (await users.find(ctx, { email: e } as never, 1))[0];
  const good = await verifyPassword(password, user?.passwordHash ?? DUMMY);
  if (!user || !good) return { ok: false, reason: "invalid" };
  if (user.disabled) return { ok: false, reason: "disabled" };
  if (user.totp?.enabled) {
    if (!code) return { ok: false, reason: "code_required" };
    const step = verifyTotp(user.totp.secret, code.trim(), Date.now(), user.totp.lastStep);
    if (step === null) return { ok: false, reason: "bad_code" };
    await users.updateById(ctx, user._id, { totp: { ...user.totp, lastStep: step }, lastLoginAt: new Date() } as never);
  } else {
    await users.updateById(ctx, user._id, { lastLoginAt: new Date() } as never);
  }
  return { ok: true, user };
}

export async function beginTotpEnrollment(ctx: TenantContext, userId: string): Promise<string> {
  const secret = newTotpSecret();
  await users.updateById(ctx, userId, { totp: { secret, enabled: false, lastStep: -1 } } as never);
  return secret;
}

export async function confirmTotpEnrollment(ctx: TenantContext, userId: string, code: string): Promise<boolean> {
  const u = await users.findById(ctx, userId);
  if (!u?.totp || u.totp.enabled) return false;
  const step = verifyTotp(u.totp.secret, code.trim());
  if (step === null) return false;
  await users.updateById(ctx, userId, { totp: { ...u.totp, enabled: true, lastStep: step } } as never);
  return true;
}

export async function listStaff(ctx: TenantContext) {
  const rows = await users.find(ctx, {}, 200);
  const db = await platformDb();
  const invites = await db.collection<Invite>("invites").find({ instanceId: ctx.instanceId, usedAt: null, expiresAt: { $gt: new Date() } }).toArray();
  return { users: rows.map((u) => ({ id: u._id, email: u.email, role: u.role, disabled: !!u.disabled, twoFactor: !!u.totp?.enabled, lastLoginAt: u.lastLoginAt ?? null })), invites: invites.map((i) => ({ email: i.email, role: i.role, expiresAt: i.expiresAt })) };
}

export type StaffResult = { ok: true; token?: string; expiresAt?: Date } | { ok: false; error: string };

export async function inviteStaff(ctx: TenantContext, actor: Actor, email: string, role: string, seatLimit: number): Promise<StaffResult> {
  if (!authorize(actor, "staff.manage", ctx).allow) return { ok: false, error: "Only the store owner can manage staff." };
  if (!INVITABLE_ROLES.includes(role as StaffRole)) return { ok: false, error: "Choose manager, cashier or kitchen/ops." };
  const em = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { ok: false, error: "Enter a valid email address." };
  if (await users.count(ctx, { email: em } as never)) return { ok: false, error: "That person already has an account." };
  const { users: existing, invites } = await listStaff(ctx);
  const seats = existing.filter((u) => !u.disabled).length + invites.filter((i) => i.email !== em).length;
  if (seats >= seatLimit) return { ok: false, error: `Your plan allows ${seatLimit} staff seat${seatLimit === 1 ? "" : "s"}. Upgrade your plan to add more.` };
  const inv = await createOwnerInvite(ctx.instanceId, em, role as Invite["role"]);
  await appendAudit({ actorId: actor.userId, actorRole: actor.role, instanceId: ctx.instanceId, action: "staff.invite", target: em, outcome: "success", after: { role } }).catch(() => undefined);
  return { ok: true, token: inv.token, expiresAt: inv.expiresAt };
}

export async function changeStaff(ctx: TenantContext, actor: Actor, userId: string, change: { role?: string; disabled?: boolean }): Promise<StaffResult> {
  if (!authorize(actor, "staff.manage", ctx).allow) return { ok: false, error: "Only the store owner can manage staff." };
  const u = await users.findById(ctx, userId);
  if (!u) return { ok: false, error: "Staff member not found." };
  if (u.role === "store_owner") return { ok: false, error: "The store owner account cannot be changed here." };
  if (u._id === actor.userId) return { ok: false, error: "You cannot change your own access." };
  const set: Partial<StaffUser> = {};
  if (change.role !== undefined) {
    if (!INVITABLE_ROLES.includes(change.role as StaffRole)) return { ok: false, error: "Invalid role." };
    set.role = change.role as StaffRole;
  }
  if (change.disabled !== undefined) {
    set.disabled = change.disabled;
    if (change.disabled) set.sessionsValidAfter = new Date(); // signs them out at once
  }
  if (change.role !== undefined) set.sessionsValidAfter = new Date(); // a role change needs a fresh sign in
  await users.updateById(ctx, userId, set as never);
  await appendAudit({ actorId: actor.userId, actorRole: actor.role, instanceId: ctx.instanceId, action: "staff.change", target: u.email, outcome: "success", before: { role: u.role, disabled: !!u.disabled }, after: set }).catch(() => undefined);
  return { ok: true };
}

export async function setOwnPassword(ctx: TenantContext, userId: string, current: string, next: string): Promise<StaffResult> {
  const u = await users.findById(ctx, userId);
  if (!u || !(await verifyPassword(current, u.passwordHash))) return { ok: false, error: "Your current password is not correct." };
  try {
    await users.updateById(ctx, userId, { passwordHash: await hashPassword(next), sessionsValidAfter: new Date() } as never);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true };
}

export async function logActivity(ctx: TenantContext, actor: { userId: string; role: string }, action: string, detail?: string) {
  const db = await tenantDb(ctx);
  await db.collection("activity").insertOne({ instanceId: ctx.instanceId, at: new Date(), actorId: actor.userId, role: actor.role, action, detail: detail ?? "" });
}
