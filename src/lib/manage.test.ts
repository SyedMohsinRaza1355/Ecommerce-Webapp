import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient, platformDb } from "@/lib/db/client";
import { provisionInstance, hashToken, type Invite } from "@/lib/platform/provision";
import { setInstanceStatus, changePlan, setToggleRule, regenerateOwnerInvite } from "@/lib/platform/manage";
import { resolveHost, clearResolutionCache, type InstanceRecord } from "@/lib/tenant/resolve";
import { getEffectiveToggles, clearToggleCache } from "@/lib/toggles/service";
import { dbNameFor } from "@/lib/tenant/context";
import type { Actor } from "@/lib/auth/rbac";

const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const owner: Actor = { userId: "o1", role: "store_owner", instanceId: "aaaaaaaaaaaa" };
const HAS_DB = Boolean(process.env.MONGODB_URI);
const PLATFORM = `test_manage_${Math.random().toString(36).slice(2, 8)}`;
let id = "";

describe.skipIf(!HAS_DB)("managing a store (Atlas, synthetic data)", () => {
  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    process.env.PLATFORM_BASE_DOMAIN = "shop.test";
    const r = await provisionInstance(sa, { name: "Managed Shop", subdomain: "managed-shop", packId: "fashion", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    id = r.instanceId;
  });
  afterAll(async () => {
    const client = await getClient();
    await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  const inst = async () => (await platformDb()).collection<InstanceRecord>("instances").findOne({ _id: id });

  it("suspends and reactivates; suspended hosts show the notice; version increments; data kept", async () => {
    const v0 = (await inst())!.configVersion!;
    expect(await setInstanceStatus(sa, id, "suspended")).toEqual({ ok: true });
    clearResolutionCache();
    expect((await resolveHost("managed-shop.shop.test", "shop.test")).type).toBe("suspended");
    expect((await inst())!.configVersion).toBe(v0 + 1);
    expect(await (await getClient()).db(dbNameFor(id)).collection("categories").countDocuments()).toBeGreaterThan(0);
    expect(await setInstanceStatus(sa, id, "suspended")).toEqual({ ok: true }); // idempotent
    expect((await inst())!.configVersion).toBe(v0 + 1);
    await setInstanceStatus(sa, id, "active");
    clearResolutionCache();
    expect((await resolveHost("managed-shop.shop.test", "shop.test")).type).toBe("ok");
  });

  it("changing to a smaller plan switches excluded features off without deleting anything", async () => {
    const before = await getEffectiveToggles((await inst())!);
    expect(before.get("F-100")?.enabled === false || before.get("F-100")?.enabled === true).toBe(true);
    const r = await changePlan(sa, id, "starter");
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.switchedOff).toBeGreaterThan(0);
    clearToggleCache();
    const after = await getEffectiveToggles((await inst())!);
    expect(after.get("F-100")).toMatchObject({ enabled: false, source: "not_in_plan" });
    expect(after.get("F-089")).toMatchObject({ enabled: false, source: "not_in_plan" });
    expect(await changePlan(sa, id, "nope")).toMatchObject({ ok: false });
  });

  it("lock and override rules are applied, cleared, and audited", async () => {
    await setToggleRule(sa, id, "F-053", "lock_off");
    clearToggleCache();
    expect((await getEffectiveToggles((await inst())!)).get("F-053")).toMatchObject({ enabled: false, source: "instance_lock" });
    await setToggleRule(sa, id, "F-053", "override_off"); // replaces the lock
    expect((await inst())!.toggleLocks?.["F-053"]).toBeUndefined();
    await setToggleRule(sa, id, "F-053", "none");
    clearToggleCache();
    expect((await getEffectiveToggles((await inst())!)).get("F-053")?.enabled).toBe(true);
    expect(await setToggleRule(sa, id, "F-999", "lock_on")).toMatchObject({ ok: false });
    const audits = await (await platformDb()).collection("audit_log").countDocuments({ instanceId: id, action: /^toggle\./ });
    expect(audits).toBe(3);
  });

  it("regenerating the owner link invalidates the previous one", async () => {
    const db = await platformDb();
    const first = await regenerateOwnerInvite(sa, id, "o@x.com");
    const second = await regenerateOwnerInvite(sa, id, "o@x.com");
    if (!first.ok || !second.ok) throw new Error("expected ok");
    const a = await db.collection<Invite>("invites").findOne({ _id: hashToken(first.token) });
    const b = await db.collection<Invite>("invites").findOne({ _id: hashToken(second.token) });
    expect(a?.usedAt).not.toBeNull();
    expect(b?.usedAt).toBeNull();
  });

  it("every management action refuses non-Super-Admin roles", async () => {
    expect(await setInstanceStatus(owner, id, "suspended")).toMatchObject({ ok: false });
    expect(await changePlan(owner, id, "starter")).toMatchObject({ ok: false });
    expect(await setToggleRule(owner, id, "F-053", "lock_on")).toMatchObject({ ok: false });
    expect(await regenerateOwnerInvite(owner, id, "o@x.com")).toMatchObject({ ok: false });
    expect((await inst())!.status).toBe("active");
  });
});
