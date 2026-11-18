import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient, platformDb } from "@/lib/db/client";
import { issueTenantContext, newInstanceId } from "@/lib/tenant/context";
import { TenantRepo } from "@/lib/tenant/repo";
import { resolveHost, clearResolutionCache, type InstanceRecord } from "@/lib/tenant/resolve";
import { migrate, TENANT_MIGRATIONS, PLATFORM_MIGRATIONS } from "@/lib/db/migrations";
import { appendAudit } from "@/lib/audit/log";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const suffix = Math.random().toString(36).slice(2, 8);
const PLATFORM = `test_platform_${suffix}`;

type Product = { _id: string; instanceId?: string; name: string; slug: string };
const products = new TenantRepo<Product>("products");

const idA = newInstanceId();
const idB = newInstanceId();
const ctxA = issueTenantContext(idA);
const ctxB = issueTenantContext(idB);

describe.skipIf(!HAS_DB)("Atlas integration (synthetic tenants, cleaned up afterwards)", () => {
  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    const client = await getClient();
    await migrate(client.db(PLATFORM), PLATFORM_MIGRATIONS);
    for (const [id, sub, status] of [
      [idA, "tenant-a", "active"],
      [idB, "tenant-b", "active"],
      [newInstanceId(), "tenant-sus", "suspended"],
      [newInstanceId(), "tenant-fail", "provisioning_failed"],
    ] as const) {
      const rec: InstanceRecord = { _id: id, name: `Store ${sub}`, subdomain: sub, status, planId: "starter" };
      await client.db(PLATFORM).collection<InstanceRecord>("instances").insertOne(rec);
    }
    await migrate(client.db(ctxA.dbName), TENANT_MIGRATIONS);
    await migrate(client.db(ctxB.dbName), TENANT_MIGRATIONS);
    clearResolutionCache();
  });

  afterAll(async () => {
    const client = await getClient();
    await client.db(PLATFORM).dropDatabase();
    await client.db(ctxA.dbName).dropDatabase();
    await client.db(ctxB.dbName).dropDatabase();
    await closeClient();
  });

  it("migrations are versioned and idempotent", async () => {
    const db = (await getClient()).db(ctxA.dbName);
    expect(await migrate(db, TENANT_MIGRATIONS)).toEqual({ from: 1, to: 1 });
  });

  it("resolves hosts: platform, active, suspended, unknown, not-active, reserved and malformed", async () => {
    const base = "shop.test";
    expect((await resolveHost("shop.test", base)).type).toBe("platform");
    const ok = await resolveHost("tenant-a.shop.test", base);
    expect(ok.type).toBe("ok");
    if (ok.type === "ok") expect(ok.ctx.instanceId).toBe(idA);
    expect((await resolveHost("tenant-sus.shop.test", base)).type).toBe("suspended");
    expect((await resolveHost("tenant-fail.shop.test", base)).type).toBe("not_found");
    expect((await resolveHost("nobody.shop.test", base)).type).toBe("not_found");
    expect((await resolveHost("evil.example.org", base)).type).toBe("not_found");
    expect((await resolveHost("a.b.shop.test", base)).type).toBe("not_found");
    expect((await resolveHost("admin.shop.test", base)).type).toBe("platform");
  });

  it("CROSS-TENANT: owner A cannot read, update, delete or list tenant B's resources", async () => {
    const bId = await products.insert(ctxB, { _id: "prod-b-1", name: "B secret", slug: "b-1" });
    await products.insert(ctxA, { _id: "prod-a-1", name: "A item", slug: "a-1" });

    expect(await products.findById(ctxA, bId)).toBeNull(); // read by B's id
    expect(await products.updateById(ctxA, bId, { name: "hacked" })).toBe(false); // mutate
    expect(await products.deleteById(ctxA, bId)).toBe(false); // delete
    expect((await products.find(ctxA)).map((p) => p._id)).toEqual(["prod-a-1"]); // search/list
    expect((await products.find(ctxA, { name: "B secret" })).length).toBe(0);

    const still = await products.findById(ctxB, bId);
    expect(still?.name).toBe("B secret"); // untouched
  });

  it("databases are physically separate per tenant", async () => {
    const client = await getClient();
    expect(await client.db(ctxA.dbName).collection("products").countDocuments({ _id: "prod-b-1" as never })).toBe(0);
    expect(await client.db(ctxB.dbName).collection("products").countDocuments({ _id: "prod-b-1" as never })).toBe(1);
  });

  it("repository rejects forged or missing tenant context", async () => {
    const forged = { instanceId: idB, dbName: ctxB.dbName } as never;
    await expect(products.find(forged)).rejects.toThrow(/forged|missing/);
    await expect(products.find(undefined as never)).rejects.toThrow();
  });

  it("a request body cannot override the tenant stamp", async () => {
    const id = await products.insert(ctxA, { _id: "prod-a-2", name: "x", slug: "a-2", instanceId: idB } as never);
    const doc = await products.findById(ctxA, id);
    expect(doc?.instanceId).toBe(idA);
    await products.updateById(ctxA, id, { instanceId: idB } as never);
    expect((await products.findById(ctxA, id))?.instanceId).toBe(idA);
  });

  it("audit entries are appended with secrets redacted", async () => {
    await appendAudit(
      { actorId: "sa1", actorRole: "super_admin", instanceId: idA, action: "setting.lock", outcome: "success", after: { password: "p", ok: 1 } },
      PLATFORM,
    );
    const db = await platformDb(PLATFORM);
    const row = await db.collection("audit_log").findOne({ action: "setting.lock" });
    expect(row?.after).toEqual({ password: "[redacted]", ok: 1 });
    expect(row?.at).toBeInstanceOf(Date);
  });
});
