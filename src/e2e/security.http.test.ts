import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { getClient, closeClient, platformDb } from "@/lib/db/client";
import { signSession } from "@/lib/auth/session";
import { issueTenantContext, dbNameFor } from "@/lib/tenant/context";
import { users } from "@/lib/commerce/staff";
import { provisionInstance } from "@/lib/platform/provision";
import { hashPassword } from "@/lib/auth/password";
import { orders } from "@/lib/commerce/orders";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import type { Actor } from "@/lib/auth/rbac";

// Black-box security tests against a RUNNING server (npm run build && next start, same database name).
// Run with: E2E=1 PLATFORM_DB_NAME=e2e_ui PLATFORM_BASE_DOMAIN=localhost:3100 npx vitest run src/e2e
const ENABLED = process.env.E2E === "1";
const PORT = Number(process.env.E2E_PORT ?? 3100);
const SECRET = process.env.SESSION_SECRET ?? "";

type Res = { status: number; location: string; body: string; headers: http.IncomingHttpHeaders };
function call(path: string, o: { cookie?: string; host?: string; method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, path, method: o.method ?? "GET", headers: { host: o.host ?? `localhost:${PORT}`, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: String(res.headers.location ?? ""), body, headers: res.headers }));
    });
    r.on("error", reject);
    if (o.body) r.write(o.body);
    r.end();
  });
}

const sa: Actor = { userId: "sa-e2e", role: "super_admin", instanceId: null };
let idA = "", idB = "", subA = "demo-burgers", subB = "sec-b";
let ownerA = "", ownerB = "", cashierA = "", kitchenA = "";
let cookieOwnerA = "", cookieOwnerB = "", cookieCashierA = "", cookieKitchenA = "", cookieSA = "", orderTokenA = "", productSlugA = "zinger-burger";

const ADMIN_PAGES = ["", "/orders", "/products", "/products/new", "/categories", "/discounts", "/features", "/settings", "/staff", "/activity", "/emails", "/privacy", "/security", "/payments", "/content", "/inbox", "/reports", "/promotions", "/setup", "/integrations", "/help"];

describe.skipIf(!ENABLED)("HTTP security: authentication, authorisation and tenant isolation", () => {
  beforeAll(async () => {
    const db = await platformDb();
    const a = await db.collection<InstanceRecord>("instances").findOne({ subdomain: subA });
    if (!a) throw new Error("Run the browser walkthrough first so demo-burgers exists");
    idA = a._id;
    const rb = await provisionInstance(sa, { name: "Sec B", subdomain: subB, packId: "restaurant", planId: "pro", ownerEmail: "b@x.com" });
    if (!rb.ok && !/taken/.test(rb.message)) throw new Error(rb.message);
    idB = rb.ok ? rb.instanceId : (await db.collection<InstanceRecord>("instances").findOne({ subdomain: subB }))!._id;
    const ctxA = issueTenantContext(idA), ctxB = issueTenantContext(idB);
    ownerA = (await users.find(ctxA, { role: "store_owner" } as never, 1))[0]._id;
    const mk = async (ctx: typeof ctxA, email: string, role: "store_owner" | "cashier" | "kitchen_ops") => {
      const existing = (await users.find(ctx, { email } as never, 1))[0];
      if (existing) return existing._id;
      const id = crypto.randomUUID();
      await users.insert(ctx, { _id: id, email, passwordHash: await hashPassword("Correct-horse-42"), role, totp: { secret: "AAAAAAAAAAAAAAAA", enabled: true, lastStep: -1 }, createdAt: new Date() } as never);
      return id;
    };
    ownerB = await mk(ctxB, "ownerb@x.com", "store_owner");
    cashierA = await mk(ctxA, "cashier@a.test", "cashier");
    kitchenA = await mk(ctxA, "kitchen@a.test", "kitchen_ops");
    const tok = (userId: string, role: Actor["role"], iid: string | null, o: { imp?: boolean; ttl?: number } = {}) => signSession({ userId, role, instanceId: iid, impersonating: o.imp }, SECRET, o.ttl);
    cookieOwnerA = `store_session=${await tok(ownerA, "store_owner", idA)}`;
    cookieOwnerB = `store_session=${await tok(ownerB, "store_owner", idB)}`;
    cookieCashierA = `store_session=${await tok(cashierA, "cashier", idA)}`;
    cookieKitchenA = `store_session=${await tok(kitchenA, "kitchen_ops", idA)}`;
    cookieSA = `session=${await tok("sa-e2e", "super_admin", null)}`;
    const o = (await orders.find(ctxA, {}, 1))[0];
    if (o) {
      const { trackingTokenFor } = await import("@/lib/commerce/orders");
      orderTokenA = trackingTokenFor(idA, o._id);
    }
  });
  afterAll(async () => {
    const client = await getClient();
    if (idB) {
      await client.db(dbNameFor(idB)).dropDatabase();
      await (await platformDb()).collection("instances").deleteOne({ _id: idB as never });
    }
    await closeClient();
  });

  describe("store admin pages", () => {
    it.each(ADMIN_PAGES)("%s: signed-out visitors are sent to sign in", async (p) => {
      const r = await call(`/s/${subA}/admin${p}`);
      expect(r.status).toBe(307);
      expect(r.location).toContain(`/s/${subA}/admin/login`);
      expect(r.body).not.toContain("Zinger");
    });
    it.each(ADMIN_PAGES)("%s: the owner of ANOTHER store is sent to sign in (cross-tenant)", async (p) => {
      const r = await call(`/s/${subA}/admin${p}`, { cookie: cookieOwnerB });
      expect(r.status).toBe(307);
      expect(r.location).toContain("/admin/login");
    });
    it.each(ADMIN_PAGES)("%s: the right owner gets in", async (p) => {
      const r = await call(`/s/${subA}/admin${p}`, { cookie: cookieOwnerA });
      expect(r.status).toBe(200);
      expect(r.headers["cache-control"]).toContain("no-store");
    });
    it("tampered, truncated, wrong-secret and expired session cookies are rejected", async () => {
      const good = cookieOwnerA.split("=")[1];
      const wrong = await signSession({ userId: ownerA, role: "store_owner", instanceId: idA }, "x".repeat(40));
      const expired = await signSession({ userId: ownerA, role: "store_owner", instanceId: idA }, SECRET, -60);
      const forgedRole = good.split(".").map((part, i) => (i === 1 ? Buffer.from(JSON.stringify({ sub: ownerA, role: "super_admin", iid: idA })).toString("base64url") : part)).join(".");
      for (const c of [good + "x", good.slice(0, 20), wrong, expired, forgedRole, "garbage", ""]) {
        const r = await call(`/s/${subA}/admin`, { cookie: `store_session=${c}` });
        expect(r.status, c.slice(0, 20)).toBe(307);
      }
    });
    it("a deleted or disabled user's old session stops working immediately", async () => {
      const ghost = `store_session=${await signSession({ userId: "no-such-user", role: "store_owner", instanceId: idA }, SECRET)}`;
      expect((await call(`/s/${subA}/admin`, { cookie: ghost })).status).toBe(307);
      // role in the token must match the database
      const lie = `store_session=${await signSession({ userId: cashierA, role: "store_owner", instanceId: idA }, SECRET)}`;
      expect((await call(`/s/${subA}/admin/staff`, { cookie: lie })).status).toBe(307);
    });
    it("cashiers cannot open owner-only or catalogue pages; they can open orders", async () => {
      for (const p of ["/staff", "/features", "/settings", "/discounts", "/privacy", "/products/new", "/categories", "/activity", "/payments", "/content", "/inbox", "/reports", "/promotions", "/setup", "/integrations"]) {
        const r = await call(`/s/${subA}/admin${p}`, { cookie: cookieCashierA });
        expect(r.status, p).toBe(307);
        expect(r.location, p).toContain("denied=1");
      }
      expect((await call(`/s/${subA}/admin/orders`, { cookie: cookieCashierA })).status).toBe(200);
    });
    it("kitchen staff only see orders and stock, nothing financial", async () => {
      for (const p of ["/staff", "/features", "/settings", "/discounts", "/privacy", "/products/new", "/categories", "/activity", "/emails", "/payments", "/content", "/inbox", "/reports", "/promotions", "/setup", "/integrations"]) {
        expect((await call(`/s/${subA}/admin${p}`, { cookie: cookieKitchenA })).status, p).toBe(307);
      }
      expect((await call(`/s/${subA}/admin/orders`, { cookie: cookieKitchenA })).status).toBe(200);
      expect((await call(`/s/${subA}/admin/products`, { cookie: cookieKitchenA })).status).toBe(200);
    });
    it("order and product detail pages never reveal another store's records", async () => {
      const ctxA = issueTenantContext(idA);
      const o = (await orders.find(ctxA, {}, 1))[0];
      if (!o) return;
      const r = await call(`/s/${subB}/admin/orders/${o._id}`, { cookie: cookieOwnerB });
      expect(r.status).toBe(404);
      expect(r.body).not.toContain(o.customer.email);
      expect((await call(`/s/${subB}/admin/products/p1`, { cookie: cookieOwnerB })).status).toBe(404);
    });
  });

  describe("storefront isolation", () => {
    it("a product page exists only in its own store", async () => {
      expect((await call(`/s/${subA}/product/${productSlugA}`)).status).toBe(200);
      expect((await call(`/s/${subB}/product/${productSlugA}`)).status).toBe(404);
    });
    it("order and payment pages need the secret token, and only work in their own store", async () => {
      if (!orderTokenA) return;
      expect((await call(`/s/${subA}/order/${orderTokenA}`)).status).toBe(200);
      expect((await call(`/s/${subB}/order/${orderTokenA}`)).status).toBe(404);
      expect((await call(`/s/${subA}/order/${orderTokenA.slice(0, -1)}x`)).status).toBe(404);
      expect((await call(`/s/${subA}/order/1001`)).status).toBe(404);
      expect((await call(`/s/${subA}/pay/${orderTokenA}`)).status).toBeLessThan(400);
      expect((await call(`/s/${subB}/pay/${orderTokenA}`)).status).toBe(404);
    });
    it("order pages are not indexable or cacheable", async () => {
      if (!orderTokenA) return;
      const r = await call(`/s/${subA}/order/${orderTokenA}`);
      expect(r.headers["cache-control"]).toContain("no-store");
      expect(r.body).toMatch(/noindex/);
    });
    it("search never returns another store's products", async () => {
      expect((await call(`/s/${subB}/products?q=zinger`)).body).not.toContain("Zinger Burger");
      expect((await call(`/s/${subA}/products?q=zinger`)).body).toContain("Zinger Burger");
    });
    it("robots.txt blocks private pages; sitemap lists only this store", async () => {
      const robots = (await call(`/s/${subA}/robots.txt`)).body;
      for (const d of ["/checkout", "/order/", "/pay/", "/admin/"]) expect(robots).toContain(`Disallow: ${d}`);
      const sm = (await call(`/s/${subA}/sitemap`)).body;
      expect(sm).toContain(`/s/${subA}/product/zinger-burger`);
      expect(sm).not.toContain(`/s/${subB}/`);
    });
  });

  describe("platform (Super Admin) pages and APIs", () => {
    const SA_PAGES = ["/admin", "/admin/instances", "/admin/instances/new", "/admin/plans", "/admin/audit", "/admin/killswitch"];
    it.each(SA_PAGES)("%s: signed-out visitors are sent to the admin sign in", async (p) => {
      const r = await call(p);
      expect(r.status).toBe(307);
      expect(r.location).toContain("/admin/login");
    });
    it.each(SA_PAGES)("%s: a store owner's token is not a Super Admin session", async (p) => {
      const asSession = `session=${cookieOwnerA.split("=")[1]}`;
      const r = await call(p, { cookie: asSession });
      expect(r.status).toBe(307);
    });
    it.each(SA_PAGES)("%s: a Super Admin is let in", async (p) => {
      expect((await call(p, { cookie: cookieSA })).status).toBe(200);
    });
    it("Super Admin cookies do not open any store admin", async () => {
      const asStore = `store_session=${cookieSA.split("=")[1]}`;
      expect((await call(`/s/${subA}/admin`, { cookie: asStore })).status).toBe(307);
    });
    it("API endpoints refuse anonymous and wrong-role callers", async () => {
      expect((await call("/api/admin/subdomain-check?name=abc")).status).toBe(403);
      expect((await call("/api/admin/subdomain-check?name=abc", { cookie: `session=${cookieOwnerA.split("=")[1]}` })).status).toBe(403);
      expect((await call(`/admin/instances/${idA}/export`)).status).toBe(403);
      expect((await call(`/admin/instances/${idA}/export`, { cookie: `session=${cookieOwnerA.split("=")[1]}` })).status).toBe(403);
      const ok = await call(`/admin/instances/${idA}/export`, { cookie: cookieSA });
      expect(ok.status).toBe(200);
      expect(ok.body).not.toContain("passwordHash");
      expect(ok.body).not.toContain("secret");
    });
    it("the setup page closes once an administrator exists", async () => {
      expect((await call("/setup")).status).toBe(307);
    });
  });

  describe("payment webhook endpoint", () => {
    it("rejects unsigned, badly signed, oversized and wrong-method requests", async () => {
      expect((await call("/api/webhooks/gateway", { method: "POST", body: "{}" })).status).toBe(400);
      expect((await call("/api/webhooks/gateway", { method: "POST", body: "{}", headers: { "x-gateway-signature": "t=1,v1=" + "0".repeat(64) } })).status).toBe(400);
      expect((await call("/api/webhooks/gateway", { method: "POST", body: "x".repeat(20000), headers: { "content-length": "20000" } })).status).toBe(413);
      const g = await call("/api/webhooks/gateway");
      expect(g.status).toBe(405);
    });
  });

  describe("host handling", () => {
    it("unknown, malformed and nested hosts fail closed", async () => {
      for (const h of ["nobody.localhost:3100", "a.b.localhost:3100", "evil.example.org", "bad_host.localhost:3100", "xn--.localhost:3100"]) {
        const r = await call("/", { host: h });
        expect(r.status, h).toBe(404);
      }
    });
    it("a store resolves from its own host and tenant headers from the client are ignored", async () => {
      const r = await call("/", { host: `${subA}.localhost:3100` });
      expect(r.status).toBe(200);
      expect(r.body).toContain("Demo Burgers");
      const forged = await call("/", { host: `${subB}.localhost:3100`, headers: { "x-tenant-id": idA, "x-instance-id": idA } });
      expect(forged.body).not.toContain("Demo Burgers");
    });
    it("reserved names serve the platform, never a store", async () => {
      const r = await call("/", { host: "admin.localhost:3100" });
      expect(r.body).toContain("Storeforge");
    });
    it("direct /s/ paths are blocked on a store's own host", async () => {
      expect((await call(`/s/${subB}`, { host: `${subA}.localhost:3100` })).status).toBe(404);
    });
  });

  describe("robustness: hostile input never causes a server error", () => {
    const NASTY = [
      "/s/demo-burgers/products?q=%7B%22%24ne%22%3Anull%7D", "/s/demo-burgers/products?q=.*", "/s/demo-burgers/products?q=" + "a".repeat(5000),
      "/s/demo-burgers/products?page=-5", "/s/demo-burgers/products?page=abc", "/s/demo-burgers/products?cat=%00", "/s/demo-burgers/product/%00", "/s/demo-burgers/product/..%2f..%2fetc",
      "/s/demo-burgers/order/%00", "/s/%00", "/s/--/", "/s/DEMO-BURGERS", "/s/demo-burgers/admin/orders/%00", "/s/demo-burgers/admin/products/%24where", "/s/demo-burgers/<script>alert(1)</script>",
      "/invite/%00", "/invite/" + "a".repeat(500), "/api/admin/subdomain-check?name=%00", "/admin/instances/%24ne/export", "//", "/s/demo-burgers//products",
    ];
    it.each(NASTY)("%s", async (p) => {
      const r = await call(p, { cookie: cookieOwnerA });
      expect(r.status, `${p} -> ${r.status}`).toBeLessThan(500);
    });
    it("script injection in query text is escaped in the page", async () => {
      const r = await call(`/s/${subA}/products?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
      expect(r.body).not.toContain("<img src=x onerror=alert(1)>");
    });
  });

  describe("security headers", () => {
    it.each(["/", `/s/${subA}`, `/s/${subA}/admin/login`, "/privacy", "/api/health"])("%s carries the hardening headers", async (p) => {
      const r = await call(p);
      expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(r.headers["content-security-policy"]).toContain("object-src 'none'");
      expect(r.headers["strict-transport-security"]).toContain("max-age=");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["x-frame-options"]).toBe("DENY");
      expect(r.headers["referrer-policy"]).toBeTruthy();
      expect(r.headers["permissions-policy"]).toContain("camera=()");
      expect(r.headers["x-powered-by"]).toBeUndefined();
    });
    it("serves security.txt", async () => {
      const r = await call("/.well-known/security.txt");
      expect(r.status).toBe(200);
      expect(r.body).toContain("Contact:");
      expect(r.body).toContain("Expires:");
    });
  });
});

describe.skipIf(!ENABLED)("HTTP: accounts, payments webhooks, exports and housekeeping", () => {
  const S = () => `/s/${subA}`;
  it("customer account pages render and protect what is private", async () => {
    for (const p of ["/account/login", "/account/register", "/account/forgot", "/contact"]) {
      const r = await call(`${S()}${p}`);
      expect(r.status, p).toBe(200);
      expect(r.headers["content-security-policy"], p).toContain("nonce-");
    }
    const acct = await call(`${S()}/account`);
    expect(acct.status).toBe(307);
    expect(acct.location).toContain("/account/login");
    expect((await call(`${S()}/account/export`)).status).toBe(401);
    expect((await call(`${S()}/account/wishlist`)).status).toBe(404); // wishlist is off by default
    expect((await call(`${S()}/account/link/${"a".repeat(43)}`)).status).toBe(200); // shows a button, uses nothing up
    expect((await call(`${S()}/p/does-not-exist`)).status).toBe(404);
  });
  it("a forged customer cookie opens nothing", async () => {
    const forged = `cust_${idA}=${await signSession({ userId: "someone", role: "customer", instanceId: idA }, SECRET)}`; // a STAFF-style token is not a customer token
    expect((await call(`${S()}/account`, { cookie: forged })).status).toBe(307);
    expect((await call(`${S()}/account/export`, { cookie: forged })).status).toBe(401);
    expect((await call(`${S()}/account/export`, { cookie: `cust_${idA}=garbage` })).status).toBe(401);
  });
  it("a staff session is not a customer session and a customer cookie is not a staff session", async () => {
    const asCustomer = `cust_${idA}=${cookieOwnerA.split("=")[1]}`;
    expect((await call(`${S()}/account/export`, { cookie: asCustomer })).status).toBe(401);
    const asStaff = `store_session=${cookieOwnerA.split("=")[1]}`.replace("store_session", "cust_x");
    expect((await call(`${S()}/admin`, { cookie: asStaff })).status).toBe(307);
  });
  it("CSV exports: staff with report access only, never signed-out, cashiers or other stores", async () => {
    expect((await call(`${S()}/admin/export/orders`)).status).toBe(403);
    expect((await call(`${S()}/admin/export/orders`, { cookie: cookieCashierA })).status).toBe(403);
    expect((await call(`${S()}/admin/export/orders`, { cookie: cookieOwnerB })).status).toBe(403);
    const ok = await call(`${S()}/admin/export/orders`, { cookie: cookieOwnerA });
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/csv");
    expect(ok.headers["content-disposition"]).toContain("attachment");
    expect(ok.body.split("\r\n")[0]).toContain("order,date,status");
    expect((await call(`${S()}/admin/export/secrets`, { cookie: cookieOwnerA })).status).toBe(404);
    expect((await call(`${S()}/admin/export/users`, { cookie: cookieOwnerA })).status).toBe(404);
  });
  it("backup is owner only and off until the feature is switched on", async () => {
    expect((await call(`${S()}/admin/backup`)).status).toBe(403);
    expect((await call(`${S()}/admin/backup`, { cookie: cookieCashierA })).status).toBe(403);
    expect((await call(`${S()}/admin/backup`, { cookie: cookieOwnerA })).status).toBe(403);
  });
  it("receipts are staff-only", async () => {
    const ctxA = issueTenantContext(idA);
    const o = (await orders.find(ctxA, {}, 1))[0];
    if (!o) return;
    expect((await call(`${S()}/admin/print/${o._id}`)).status).toBe(307);
    expect((await call(`${S()}/admin/print/${o._id}`, { cookie: cookieOwnerB })).status).toBe(307);
    const r = await call(`${S()}/admin/print/${o._id}`, { cookie: cookieOwnerA });
    expect(r.status).toBe(200);
    expect(r.body).toContain(`#${o.orderNo}`);
  });
  it("the Stripe webhook refuses everything unsigned, unknown or oversized, and GET", async () => {
    const url = `/api/webhooks/stripe/${idA}`;
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    expect((await call(url, { method: "GET" })).status).toBe(405);
    expect((await call(url, { method: "POST", body })).status).toBe(400); // no Stripe account connected: nothing can be verified
    expect((await call(url, { method: "POST", body, headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` } })).status).toBe(400);
    expect((await call("/api/webhooks/stripe/not-a-real-store-id", { method: "POST", body })).status).toBe(404);
    expect((await call("/api/webhooks/stripe/..%2F..%2Fadmin", { method: "POST", body })).status).toBe(404);
    const big = await call(url, { method: "POST", body: "x".repeat(300 * 1024), headers: { "content-length": String(300 * 1024) } });
    expect(big.status).toBe(413);
  });
  it("housekeeping endpoint is closed without the secret", async () => {
    const r = await call("/api/cron/maintenance");
    expect([401, 503]).toContain(r.status);
    expect((await call("/api/cron/maintenance", { headers: { authorization: "Bearer wrong-secret-value-123" } })).status).toBeGreaterThanOrEqual(401);
  });
  it("payments page needs the owner: kitchen and cashier are turned away", async () => {
    expect((await call(`${S()}/admin/payments`, { cookie: cookieOwnerA })).status).toBe(200);
    expect((await call(`${S()}/admin/payments`, { cookie: cookieCashierA })).status).toBe(307);
  });
});

describe.skipIf(!ENABLED)("HTTP: public API, blog, unsubscribe and owner-only integration pages", () => {
  const S = () => `/s/${subA}`;
  it("API refuses missing, malformed, unknown-store and wrong keys with the same answer", async () => {
    const answers = [];
    for (const h of [undefined, "Bearer", "Bearer short", "Basic abc", "Bearer sfk_nope_" + "A".repeat(40), `Bearer sfk_${idA}_${"A".repeat(40)}`, "Bearer sfk_../../etc_" + "A".repeat(40)]) {
      const r = await call("/api/v1/orders", { headers: h ? { authorization: h } : {} });
      expect(r.status, String(h)).toBe(401);
      answers.push(JSON.parse(r.body).error.code);
      expect(r.headers["cache-control"]).toContain("no-store");
    }
    expect(new Set(answers).size).toBe(1);
  });
  it("a valid key is turned away while the API feature is off, works when on, and never leaks other data", async () => {
    const { createApiKey } = await import("@/lib/commerce/integrations");
    const { bumpInstance } = await import("@/lib/platform/manage");
    const { tenantDb } = await import("@/lib/tenant/schema");
    const ctxA = issueTenantContext(idA);
    const k = await createApiKey(ctxA, "e2e");
    if (!k.ok) throw new Error(k.error);
    const auth = { authorization: `Bearer ${k.key}` };
    const off = await call("/api/v1/orders", { headers: auth });
    expect(off.status).toBe(403);
    expect(JSON.parse(off.body).error.code).toBe("feature_off");
    const db = await tenantDb(ctxA);
    await db.collection("settings").updateOne({ instanceId: idA }, { $set: { "ownerToggles.F-100": true } });
    await bumpInstance(idA);
    let on = await call("/api/v1/orders?limit=5", { headers: auth });
    for (let i = 0; i < 6 && on.status === 403; i++) { await new Promise((r) => setTimeout(r, 1500)); on = await call("/api/v1/orders?limit=5", { headers: auth }); }
    expect(on.status).toBe(200);
    const body = JSON.parse(on.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(on.body).not.toContain("passwordHash");
    expect(on.body).not.toContain("trackingHash");
    expect((await call("/api/v1/products?limit=3", { headers: auth })).status).toBe(200);
    expect((await call("/api/v1/secrets", { headers: auth })).status).toBe(404);
    expect((await call("/api/v1/orders/abc", { headers: auth })).status).toBe(400);
    expect((await call("/api/v1/orders/999999", { headers: auth })).status).toBe(404);
    expect((await call("/api/v1/orders?before=garbage", { headers: auth })).status).toBe(400);
    expect((await call("/api/v1/orders", { method: "POST", headers: auth, body: "{}" })).status).toBe(405); // read only
    expect((await call("/api/v1/orders", { method: "DELETE", headers: auth })).status).toBe(405);
    // a key of store A used against store B's id in the key text finds nothing
    const forged = k.key.replace(idA, idB || "zzzzzz");
    expect((await call("/api/v1/orders", { headers: { authorization: `Bearer ${forged}` } })).status).toBe(401);
    await db.collection("settings").updateOne({ instanceId: idA }, { $unset: { "ownerToggles.F-100": "" } });
    await bumpInstance(idA);
  });
  it("blog and unsubscribe pages behave", async () => {
    expect((await call(`${S()}/blog`)).status).toBe(404); // blog is off by default
    const u = await call(`${S()}/unsubscribe?e=a@b.com&t=bad`);
    expect(u.status).toBe(200);
    expect(u.body).toContain("not valid");
    expect((await call(`${S()}/unsubscribe`)).status).toBe(200);
  });
  it("integration and promotion pages are for the owner (managers and cashiers are turned away)", async () => {
    expect((await call(`${S()}/admin/integrations`, { cookie: cookieOwnerA })).status).toBe(200);
    expect((await call(`${S()}/admin/integrations`, { cookie: cookieCashierA })).status).toBe(307);
    expect((await call(`${S()}/admin/integrations`)).status).toBe(307);
    expect((await call(`${S()}/admin/help`, { cookie: cookieCashierA })).status).toBe(200); // help is for every signed-in member
    expect((await call(`${S()}/admin/export/ledger`, { cookie: cookieOwnerA })).status).toBe(403); // accounting export is off by default
  });
});
