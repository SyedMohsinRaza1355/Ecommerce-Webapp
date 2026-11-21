import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient, platformDb } from "@/lib/db/client";
import { provisionInstance, hashToken, type Invite } from "@/lib/platform/provision";
import { setToggleRule, changePlan } from "@/lib/platform/manage";
import { setKillSwitch } from "@/lib/platform/killswitch";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { clearResolutionCache, type InstanceRecord } from "@/lib/tenant/resolve";
import { clearToggleCache, getEffectiveToggles } from "@/lib/toggles/service";
import { tenantDb } from "@/lib/tenant/schema";
import { setOwnerFeature, undoChange, featureStates, recentChanges, prerequisiteChain } from "./features";
import { users, authenticateStaff, inviteStaff, changeStaff, listStaff, beginTotpEnrollment, confirmTotpEnrollment, setOwnPassword } from "./staff";
import { hashPassword } from "@/lib/auth/password";
import { hotp, base32Decode, stepOf } from "@/lib/auth/totp";
import { resetRateLimits } from "@/lib/auth/ratelimit";
import { evaluateToggles } from "@/lib/toggles/evaluate";
import type { Actor } from "@/lib/auth/rbac";

const sa: Actor = { userId: "sa", role: "super_admin", instanceId: null };
const HAS_DB = Boolean(process.env.MONGODB_URI);
const PLATFORM = `test_feat_${Math.random().toString(36).slice(2, 8)}`;
const created: string[] = [];
let ctx: TenantContext, ctxOther: TenantContext;
let inst: InstanceRecord, instOther: InstanceRecord;
const owner = (): Actor => ({ userId: "owner1", role: "store_owner", instanceId: ctx.instanceId });

async function fresh(id: string) {
  clearResolutionCache();
  clearToggleCache();
  return (await (await platformDb()).collection<InstanceRecord>("instances").findOne({ _id: id }))!;
}
const eff = async () => getEffectiveToggles(await fresh(inst._id));

describe("prerequisite chain helper (pure)", () => {
  it("lists missing prerequisites in order, handling OR groups and fully satisfied cases", () => {
    const e = evaluateToggles({ owner: {} });
    expect(prerequisiteChain("F-014", e)).toEqual(["F-003"]);
    expect(prerequisiteChain("F-124", e)).toEqual(["F-015"]);
    expect(prerequisiteChain("F-056", e)).toEqual(["F-054"]);
    expect(prerequisiteChain("F-001", e)).toEqual([]);
    const withCod = evaluateToggles({ locks: { "F-037": false } });
    expect(prerequisiteChain("F-026", withCod)).toEqual(["F-017", "F-038"]); // OR group: first available alternative, plus its own prerequisite
  });
});

describe.skipIf(!HAS_DB)("owner features, undo, staff and 2FA (Atlas, synthetic data)", () => {
  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    for (const [sub, plan] of [["feat-shop", "growth"], ["feat-other", "growth"]] as const) {
      const r = await provisionInstance(sa, { name: `Shop ${sub}`, subdomain: sub, packId: "fashion", planId: plan, ownerEmail: "o@x.com" });
      if (!r.ok) throw new Error(r.message);
      created.push(r.instanceId);
    }
    ctx = issueTenantContext(created[0]);
    ctxOther = issueTenantContext(created[1]);
    inst = await fresh(created[0]);
    instOther = await fresh(created[1]);
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  describe("features", () => {
    it("owner turns a feature on and off; version increments; data of the flag stays", async () => {
      const v0 = (await fresh(inst._id)).configVersion!;
      expect(await setOwnerFeature(inst, owner(), "F-003", true, false)).toMatchObject({ ok: true, changed: ["F-003"] });
      expect((await fresh(inst._id)).configVersion).toBe(v0 + 1);
      expect((await eff()).get("F-003")).toMatchObject({ enabled: true, source: "owner" });
      expect(await setOwnerFeature(await fresh(inst._id), owner(), "F-003", false, false)).toMatchObject({ ok: true });
      expect((await eff()).get("F-003")?.enabled).toBe(false);
    });
    it("a missing prerequisite is explained, and one confirmation enables the whole chain", async () => {
      const r1 = await setOwnerFeature(await fresh(inst._id), owner(), "F-014", true, false);
      expect(r1).toMatchObject({ ok: false, error: expect.stringContaining("Modifiers") });
      const r2 = await setOwnerFeature(await fresh(inst._id), owner(), "F-014", true, true);
      expect(r2).toMatchObject({ ok: true });
      const e = await eff();
      expect(e.get("F-014")?.enabled).toBe(true);
      expect(e.get("F-003")?.enabled).toBe(true);
    });
    it("turning a feature off lists dependents and can switch them off together", async () => {
      const r1 = await setOwnerFeature(await fresh(inst._id), owner(), "F-003", false, false);
      expect(r1).toMatchObject({ ok: false, error: expect.stringContaining("Required option groups") });
      const r2 = await setOwnerFeature(await fresh(inst._id), owner(), "F-003", false, true);
      expect(r2).toMatchObject({ ok: true });
      const e = await eff();
      expect(e.get("F-003")?.enabled).toBe(false);
      expect(e.get("F-014")?.enabled).toBe(false);
    });
    it("24-hour undo restores the earlier state, exactly once, and expires", async () => {
      const i = await fresh(inst._id);
      await setOwnerFeature(i, owner(), "F-054", true, true); // needs F-053 which is already on
      expect((await eff()).get("F-054")?.enabled).toBe(true);
      const changes = await recentChanges(ctx);
      expect(changes[0].keys).toContain("F-054");
      expect(await undoChange(await fresh(inst._id), owner(), changes[0].id)).toMatchObject({ ok: true });
      expect((await eff()).get("F-054")?.enabled).toBe(false);
      expect(await undoChange(await fresh(inst._id), owner(), changes[0].id)).toMatchObject({ ok: false }); // already undone
      await setOwnerFeature(await fresh(inst._id), owner(), "F-054", true, true);
      const latest = (await recentChanges(ctx))[0];
      const future = new Date(Date.now() + 25 * 3600_000);
      expect(await undoChange(await fresh(inst._id), owner(), latest.id, future)).toMatchObject({ ok: false, error: expect.stringContaining("24 hours") });
      expect(await undoChange(await fresh(inst._id), owner(), "not-an-id")).toMatchObject({ ok: false });
    });
    it("owners cannot change locked, overridden, kill-switched or out-of-plan features", async () => {
      await setToggleRule(sa, inst._id, "F-058", "lock_off");
      expect(await setOwnerFeature(await fresh(inst._id), owner(), "F-058", true, false)).toMatchObject({ ok: false, error: expect.stringContaining("locked") });
      await setToggleRule(sa, inst._id, "F-058", "override_on");
      expect(await setOwnerFeature(await fresh(inst._id), owner(), "F-058", false, false)).toMatchObject({ ok: false, error: expect.stringContaining("managed") });
      await setToggleRule(sa, inst._id, "F-058", "none");
      await setKillSwitch(sa, "F-059", "off");
      expect(await setOwnerFeature(await fresh(inst._id), owner(), "F-059", true, false)).toMatchObject({ ok: false });
      await setKillSwitch(sa, "F-059", "clear");
      expect(await setOwnerFeature(await fresh(inst._id), owner(), "F-124", true, true)).toMatchObject({ ok: false, error: expect.stringContaining("plan") });
      const states = await featureStates(await fresh(inst._id));
      expect(states.find((s) => s.def.id === "F-124")?.outOfPlan).toBe(true);
    });
    it("only the owner can change features, and only for their own store", async () => {
      const cashier: Actor = { userId: "c", role: "cashier", instanceId: ctx.instanceId };
      const otherOwner: Actor = { userId: "o2", role: "store_owner", instanceId: ctxOther.instanceId };
      expect(await setOwnerFeature(await fresh(inst._id), cashier, "F-058", true, false)).toMatchObject({ ok: false });
      expect(await setOwnerFeature(await fresh(inst._id), otherOwner, "F-058", true, false)).toMatchObject({ ok: false });
      expect(await setOwnerFeature(await fresh(inst._id), owner(), "F-999", true, false)).toMatchObject({ ok: false });
    });
    it("a store's choices never leak into another store", async () => {
      await setOwnerFeature(await fresh(inst._id), owner(), "F-058", true, false);
      clearToggleCache();
      expect((await getEffectiveToggles(await fresh(instOther._id))).get("F-058")?.enabled).toBe(false);
      expect((await getEffectiveToggles(await fresh(inst._id))).get("F-058")?.enabled).toBe(true);
    });
    it("downgrading the plan switches a feature off but keeps the owner's choice for a later upgrade", async () => {
      await setOwnerFeature(await fresh(inst._id), owner(), "F-099", true, false); // webhooks, in growth
      expect((await eff()).get("F-099")?.enabled).toBe(true);
      await changePlan(sa, inst._id, "starter");
      expect((await eff()).get("F-099")).toMatchObject({ enabled: false, source: "not_in_plan" });
      await changePlan(sa, inst._id, "growth");
      expect((await eff()).get("F-099")).toMatchObject({ enabled: true, source: "owner" });
    });
  });

  describe("staff accounts, 2FA, sessions", () => {
    const addUser = async (email: string, role: "store_owner" | "manager" | "cashier" | "kitchen_ops", password = "Correct-horse-42") => {
      const id = crypto.randomUUID();
      await users.insert(ctx, { _id: id, email, passwordHash: await hashPassword(password), role, createdAt: new Date() } as never);
      return id;
    };
    it("signs in with the right password only; unknown users and wrong passwords look identical", async () => {
      await resetRateLimits();
      await addUser("login@shop.test", "manager");
      expect(await authenticateStaff(ctx, "LOGIN@shop.test", "Correct-horse-42", undefined, "1.1.1.1")).toMatchObject({ ok: true });
      expect(await authenticateStaff(ctx, "login@shop.test", "wrong-password-1", undefined, "1.1.1.2")).toEqual({ ok: false, reason: "invalid" });
      expect(await authenticateStaff(ctx, "nobody@shop.test", "wrong-password-1", undefined, "1.1.1.3")).toEqual({ ok: false, reason: "invalid" });
    });
    it("rate limits repeated failures per account and address", async () => {
      await resetRateLimits();
      const rs = [];
      for (let i = 0; i < 7; i++) rs.push(await authenticateStaff(ctx, "login@shop.test", "bad-password-1", undefined, "9.9.9.9"));
      expect(rs.slice(0, 5).every((r) => !r.ok && r.reason === "invalid")).toBe(true);
      expect(rs[5]).toMatchObject({ ok: false, reason: "rate_limited" });
    });
    it("a staff member of store A cannot sign in to store B with the same credentials", async () => {
      await resetRateLimits();
      expect(await authenticateStaff(ctxOther, "login@shop.test", "Correct-horse-42", undefined, "2.2.2.2")).toEqual({ ok: false, reason: "invalid" });
    });
    it("disabled accounts cannot sign in", async () => {
      await resetRateLimits();
      const id = await addUser("off@shop.test", "cashier");
      expect(await changeStaff(ctx, owner(), id, { disabled: true })).toEqual({ ok: true });
      expect(await authenticateStaff(ctx, "off@shop.test", "Correct-horse-42", undefined, "3.3.3.3")).toEqual({ ok: false, reason: "disabled" });
    });
    it("two-step sign in: enrolment needs a valid code, then every login needs one, and codes cannot be replayed", async () => {
      await resetRateLimits();
      const id = await addUser("mfa@shop.test", "manager");
      const secret = await beginTotpEnrollment(ctx, id);
      expect(await confirmTotpEnrollment(ctx, id, "000000")).toBe(false);
      const code = hotp(base32Decode(secret), stepOf());
      expect(await confirmTotpEnrollment(ctx, id, code)).toBe(true);
      expect(await authenticateStaff(ctx, "mfa@shop.test", "Correct-horse-42", undefined, "4.4.4.4")).toEqual({ ok: false, reason: "code_required" });
      expect(await authenticateStaff(ctx, "mfa@shop.test", "Correct-horse-42", "123456", "4.4.4.4")).toMatchObject({ ok: false, reason: "bad_code" });
      // the enrolment code was already consumed, so the same code is rejected (replay)
      expect(await authenticateStaff(ctx, "mfa@shop.test", "Correct-horse-42", code, "4.4.4.4")).toMatchObject({ ok: false, reason: "bad_code" });
      const next = hotp(base32Decode(secret), stepOf() + 1);
      expect(await authenticateStaff(ctx, "mfa@shop.test", "Correct-horse-42", next, "4.4.4.4")).toMatchObject({ ok: true });
      expect(await authenticateStaff(ctx, "mfa@shop.test", "Correct-horse-42", next, "4.4.4.4")).toMatchObject({ ok: false, reason: "bad_code" });
    });
    it("staff invitations: owner-only, valid roles, seat limit enforced, single pending invite per email", async () => {
      const mgr: Actor = { userId: "m", role: "manager", instanceId: ctx.instanceId };
      expect(await inviteStaff(ctx, mgr, "new@shop.test", "cashier", 10)).toMatchObject({ ok: false });
      expect(await inviteStaff(ctx, owner(), "bad", "cashier", 10)).toMatchObject({ ok: false });
      expect(await inviteStaff(ctx, owner(), "x@shop.test", "store_owner", 10)).toMatchObject({ ok: false, error: expect.stringContaining("manager") });
      expect(await inviteStaff(ctx, owner(), "login@shop.test", "cashier", 10)).toMatchObject({ ok: false, error: expect.stringContaining("already") });
      const { users: u, invites } = await listStaff(ctx);
      const used = u.filter((x) => !x.disabled).length + invites.length;
      expect(await inviteStaff(ctx, owner(), "full@shop.test", "cashier", used)).toMatchObject({ ok: false, error: expect.stringContaining("seat") });
      const ok = await inviteStaff(ctx, owner(), "ok@shop.test", "kitchen_ops", used + 5);
      expect(ok).toMatchObject({ ok: true });
      if (ok.ok) {
        const inv = await (await platformDb()).collection<Invite>("invites").findOne({ _id: hashToken(ok.token!) });
        expect(inv).toMatchObject({ role: "kitchen_ops", email: "ok@shop.test", instanceId: ctx.instanceId });
      }
    });
    it("owners cannot be changed, nobody changes their own access, roles are validated", async () => {
      const ownerId = await addUser("theowner@shop.test", "store_owner");
      const mgrId = await addUser("mgr2@shop.test", "manager");
      expect(await changeStaff(ctx, owner(), ownerId, { disabled: true })).toMatchObject({ ok: false });
      expect(await changeStaff(ctx, { ...owner(), userId: mgrId }, mgrId, { role: "cashier" })).toMatchObject({ ok: false });
      expect(await changeStaff(ctx, owner(), mgrId, { role: "store_owner" })).toMatchObject({ ok: false });
      expect(await changeStaff(ctx, owner(), mgrId, { role: "cashier" })).toEqual({ ok: true });
      expect((await users.findById(ctx, mgrId))!.role).toBe("cashier");
      expect(await changeStaff(ctxOther, owner(), mgrId, { role: "manager" })).toMatchObject({ ok: false }); // wrong store
    });
    it("password change needs the current password and a strong new one", async () => {
      const id = await addUser("pw@shop.test", "manager");
      expect(await setOwnPassword(ctx, id, "wrong", "Another-strong-77")).toMatchObject({ ok: false });
      expect(await setOwnPassword(ctx, id, "Correct-horse-42", "short")).toMatchObject({ ok: false });
      expect(await setOwnPassword(ctx, id, "Correct-horse-42", "Another-strong-77")).toEqual({ ok: true });
      await resetRateLimits();
      expect(await authenticateStaff(ctx, "pw@shop.test", "Another-strong-77", undefined, "5.5.5.5")).toMatchObject({ ok: true });
      expect(await authenticateStaff(ctx, "pw@shop.test", "Correct-horse-42", undefined, "5.5.5.6")).toMatchObject({ ok: false });
    });
    it("password hashes are never stored in plain text", async () => {
      const db = await tenantDb(ctx);
      const raw = await db.collection("users").find({}).toArray();
      for (const u of raw) {
        expect(String(u.passwordHash)).toMatch(/^\$2[aby]\$12\$/);
        expect(JSON.stringify(u)).not.toContain("Correct-horse-42");
      }
    });
  });
});
