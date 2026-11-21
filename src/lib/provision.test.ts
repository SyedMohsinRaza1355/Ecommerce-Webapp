import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient, platformDb } from "@/lib/db/client";
import { provisionInstance, suggestSubdomains, hashToken, type Invite } from "@/lib/platform/provision";
import { PACKS } from "@/catalog/packs";
import { CATALOG, TOGGLES } from "@/lib/toggles/catalog";
import { evaluateToggles } from "@/lib/toggles/evaluate";
import { DEFAULT_PLANS } from "@/lib/platform/plans";
import { dbNameFor } from "@/lib/tenant/context";
import type { Actor } from "@/lib/auth/rbac";

const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };

describe("industry packs and plans (pure)", () => {
  it("there are eight packs with unique ids", () => {
    expect(PACKS).toHaveLength(8);
    expect(new Set(PACKS.map((p) => p.id)).size).toBe(8);
  });
  it.each(PACKS.map((p) => [p.id, p] as const))("pack %s only references real toggles and keeps defaults only", (_id, p) => {
    for (const id of Object.keys(p.toggles)) expect(CATALOG.has(id)).toBe(true);
    expect(p.categories.length).toBeGreaterThan(0);
    // a pack never forces anything: owner choices and locks still beat it
    const eff = evaluateToggles({ packDefaults: p.toggles, owner: Object.fromEntries(Object.keys(p.toggles).map((k) => [k, false])) });
    for (const id of Object.keys(p.toggles)) expect(eff.get(id)?.enabled).toBe(false);
  });
  it("restaurant pack turns on modifiers, option groups and the kitchen board", () => {
    const r = PACKS.find((p) => p.id === "restaurant")!;
    const eff = evaluateToggles({ packDefaults: r.toggles });
    for (const id of ["F-003", "F-014", "F-124", "F-017"]) expect(eff.get(id)?.enabled).toBe(true);
  });
  it("plans only include real toggles and Pro includes all", () => {
    for (const p of DEFAULT_PLANS) for (const id of p.includedToggles) expect(CATALOG.has(id)).toBe(true);
    expect(DEFAULT_PLANS.find((p) => p.slug === "pro")!.includedToggles).toHaveLength(TOGGLES.length);
    expect(DEFAULT_PLANS.find((p) => p.slug === "starter")!.includedToggles).not.toContain("F-100");
  });
});

const HAS_DB = Boolean(process.env.MONGODB_URI);
const PLATFORM = `test_prov_${Math.random().toString(36).slice(2, 8)}`;
const created: string[] = [];

describe.skipIf(!HAS_DB)("provisioning saga (Atlas, synthetic data)", () => {
  beforeAll(() => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  const input = (sub: string) => ({ name: "Test Burgers", subdomain: sub, packId: "restaurant", planId: "growth", ownerEmail: "Owner@Example.com" });

  it("creates the store, database, seed data and a one-time invite", async () => {
    const r = await provisionInstance(sa, input("burger-test"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    created.push(r.instanceId);
    const db = await platformDb();
    const inst = await db.collection("instances").findOne({ _id: r.instanceId as never });
    expect(inst).toMatchObject({ status: "active", subdomain: "burger-test", planId: "growth", industryPack: "restaurant" });
    const client = await getClient();
    const tdb = client.db(dbNameFor(r.instanceId));
    expect(await tdb.collection("categories").countDocuments()).toBe(5);
    expect((await tdb.collection("_meta").findOne({ _id: "schema" as never }))?.schemaVersion).toBe(2);
    const inv = await db.collection<Invite>("invites").findOne({ _id: hashToken(r.inviteToken) });
    expect(inv?.email).toBe("owner@example.com");
    expect(inv?.usedAt).toBeNull();
    expect(JSON.stringify(inv)).not.toContain(r.inviteToken); // only the hash is stored
    expect(await db.collection("audit_log").countDocuments({ action: "instance.create", outcome: "success" })).toBe(1);
  });

  it("refuses a taken or reserved web address and leaves nothing behind", async () => {
    const dup = await provisionInstance(sa, input("burger-test"));
    expect(dup).toMatchObject({ ok: false, step: "reserve_subdomain", message: expect.stringContaining("taken") });
    expect(await provisionInstance(sa, input("admin"))).toMatchObject({ ok: false, step: "validate" });
    const db = await platformDb();
    expect(await db.collection("instances").countDocuments({ subdomain: "burger-test" })).toBe(1);
  });

  it("two simultaneous requests for the same address: exactly one wins", async () => {
    const results = await Promise.all([provisionInstance(sa, input("race-shop")), provisionInstance(sa, input("race-shop"))]);
    const wins = results.filter((r) => r.ok);
    for (const w of wins) if (w.ok) created.push(w.instanceId);
    expect(wins).toHaveLength(1);
  });

  it.each(["create_database", "seed_data", "owner_invite"])("failure at %s rolls everything back and names the step", async (step) => {
    const sub = `fail-${step.replace(/_/g, "-")}`;
    const r = await provisionInstance(sa, input(sub), { failAt: step });
    expect(r).toMatchObject({ ok: false, step });
    const db = await platformDb();
    expect(await db.collection("instances").countDocuments({ subdomain: sub })).toBe(0);
    // invites exist only for stores that were really created
    expect(await db.collection("invites").countDocuments({})).toBe(created.length);
  });

  it("only a Super Admin may provision", async () => {
    const owner: Actor = { userId: "o", role: "store_owner", instanceId: "aaaaaaaaaaaa" };
    expect(await provisionInstance(owner, input("nope-shop"))).toMatchObject({ ok: false, step: "authorize" });
  });

  it("suggests free alternatives when a name is taken", async () => {
    const s = await suggestSubdomains("burger-test");
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toContain("burger-test");
  });
});
