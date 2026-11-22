import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { createProduct, getSettings, ProductInput, products, categories } from "./store";
import { placeOrder, orders, refundOrder, type Features } from "./orders";
import { cartView, setCartQty } from "./cart";
import { bestPromo, isOpenNow, hasHours, validateHours, validateZones, zoneFor, savePromo, listPromos, setPromoActive, describeHours, type Promo } from "./rules";
import {
  isPrivateAddress, checkWebhookUrl, signWebhook, addEndpoint, processWebhooks, replayDelivery, recentDeliveries, emitWebhook, WEBHOOK_MAX_ATTEMPTS, setEndpoint, listEndpoints,
  createApiKey, verifyApiKey, revokeApiKey, instanceIdFromKey, listApiKeys,
} from "./integrations";
import { decryptSecret } from "@/lib/crypto/secretbox";
import { sendCampaign, unsubscribe, unsubscribeToken, verifyUnsubscribe, savePage, listPages, exportCsv, subscribeNewsletter } from "./extras";
import type { Actor } from "@/lib/auth/rbac";
import type { Settings } from "./types";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const FEAT: Features = { shipping: true, freeShipping: false, tax: false, discounts: true, cod: true, card: false, emails: false, stockTracking: true };
const PLATFORM = `test_rules_${Math.random().toString(36).slice(2, 8)}`;
const cust = { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
let n = 0;
const key = () => `idem-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;

const promo = (over: Partial<Promo>): Promo => ({ _id: "p", name: "Promo", kind: "auto", percentBps: 1000, minSubtotalMinor: 0, categoryId: null, startsAt: null, endsAt: null, active: true, createdAt: new Date(), ...over });
const lines = [{ productId: "a", categoryId: "c1", lineMinor: 10000 }, { productId: "b", categoryId: "c2", lineMinor: 5000 }];
const NOW = new Date("2026-06-10T12:00:00Z");

describe("promotion selection", () => {
  const on = { auto: true, flash: true };
  it("basket discounts need the minimum; flash sales respect their window and category", () => {
    expect(bestPromo([promo({ minSubtotalMinor: 20000 })], lines, NOW, on)).toBeNull();
    expect(bestPromo([promo({ minSubtotalMinor: 15000 })], lines, NOW, on)?.discountMinor).toBe(1500);
    expect(bestPromo([promo({ kind: "flash", categoryId: "c1", percentBps: 5000, endsAt: new Date("2026-06-11T00:00:00Z") })], lines, NOW, on)?.discountMinor).toBe(5000);
    expect(bestPromo([promo({ kind: "flash", endsAt: new Date("2026-06-09T00:00:00Z") })], lines, NOW, on)).toBeNull(); // ended
    expect(bestPromo([promo({ kind: "flash", startsAt: new Date("2026-06-11T00:00:00Z"), endsAt: new Date("2026-06-12T00:00:00Z") })], lines, NOW, on)).toBeNull(); // not yet
    expect(bestPromo([promo({ kind: "flash", categoryId: "other" })], lines, NOW, on)).toBeNull();
  });
  it("picks the single best one, never stacks, and honours switches and the off state", () => {
    const r = bestPromo([promo({ _id: "small", percentBps: 500 }), promo({ _id: "big", percentBps: 2000 }), promo({ _id: "off", percentBps: 9000, active: false })], lines, NOW, on);
    expect(r).toMatchObject({ promo: { _id: "big" }, discountMinor: 3000 });
    expect(bestPromo([promo({})], lines, NOW, { auto: false, flash: true })).toBeNull();
    expect(bestPromo([promo({ kind: "flash" })], lines, NOW, { auto: true, flash: false })).toBeNull();
    expect(bestPromo([], lines, NOW, on)).toBeNull();
    expect(bestPromo([promo({ percentBps: 10000 })], lines, NOW, on)?.discountMinor).toBe(15000); // never more than the basket
  });
});

describe("opening hours", () => {
  const h: Settings["hours"] = { mon: { open: "09:00", close: "17:00" }, tue: { open: "20:00", close: "02:00" }, wed: null };
  it("works in the store's timezone, not the server's", () => {
    // Monday 2026-06-08 08:30 UTC = 13:30 Karachi
    expect(isOpenNow(h, new Date("2026-06-08T08:30:00Z"), "Asia/Karachi")).toBe(true);
    expect(isOpenNow(h, new Date("2026-06-08T12:30:00Z"), "Asia/Karachi")).toBe(false); // 17:30 Karachi
    expect(isOpenNow(h, new Date("2026-06-08T03:59:00Z"), "Asia/Karachi")).toBe(false); // 08:59
    expect(isOpenNow(h, new Date("2026-06-08T04:00:00Z"), "Asia/Karachi")).toBe(true); // 09:00 exactly
    expect(isOpenNow(h, new Date("2026-06-08T12:00:00Z"), "Asia/Karachi")).toBe(false); // 17:00 exactly: closed
  });
  it("handles overnight shifts and days off", () => {
    expect(isOpenNow(h, new Date("2026-06-09T16:00:00Z"), "Asia/Karachi")).toBe(true); // Tue 21:00
    expect(isOpenNow(h, new Date("2026-06-09T20:30:00Z"), "Asia/Karachi")).toBe(true); // Wed 01:30, still Tuesday's shift
    expect(isOpenNow(h, new Date("2026-06-09T22:30:00Z"), "Asia/Karachi")).toBe(false); // Wed 03:30
    expect(isOpenNow(h, new Date("2026-06-10T07:00:00Z"), "Asia/Karachi")).toBe(false); // Wed (day off)
    expect(isOpenNow(h, new Date("2026-06-11T07:00:00Z"), "Asia/Karachi")).toBe(false); // Thu: unset day counts as closed once hours exist
  });
  it("no hours means always open; validation catches nonsense", () => {
    expect(isOpenNow(undefined, NOW)).toBe(true);
    expect(isOpenNow({}, NOW)).toBe(true);
    expect(hasHours({ mon: null })).toBe(false);
    expect(validateHours({ mon: { open: "25:00", close: "10:00" } })).toMatch(/times/);
    expect(validateHours({ mon: { open: "09:00", close: "09:00" } })).toMatch(/same/);
    expect(validateHours({ mon: { open: "09:00", close: "22:30" } })).toBeNull();
    expect(describeHours(h)).toContain("Mon 09:00-17:00");
  });
});

describe("delivery zones", () => {
  const zones = [{ id: "a", name: "Local", cities: ["Lahore", " Kasur "], feeMinor: 15000 }];
  it("matches cities case-insensitively and falls back to nothing", () => {
    expect(zoneFor(zones, "lahore")?.name).toBe("Local");
    expect(zoneFor(zones, "KASUR")?.name).toBe("Local");
    expect(zoneFor(zones, "Karachi")).toBeNull();
    expect(zoneFor(zones, "")).toBeNull();
    expect(zoneFor(undefined, "Lahore")).toBeNull();
  });
  it("rejects bad zones", () => {
    expect(validateZones([{ name: "", cities: ["A"], feeMinor: 1 }])).toMatch(/name/);
    expect(validateZones([{ name: "Z", cities: [], feeMinor: 1 }])).toMatch(/city/);
    expect(validateZones([{ name: "Z", cities: ["A"], feeMinor: -1 }])).toMatch(/negative/);
    expect(validateZones([{ name: "Z1", cities: ["A"], feeMinor: 1 }, { name: "Z2", cities: ["a"], feeMinor: 1 }])).toMatch(/more than one/);
    expect(validateZones(zones)).toBeNull();
  });
});

describe("webhook safety", () => {
  it("recognises private, loopback, metadata and mapped addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.63.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("refuses unsafe webhook addresses without touching the network", async () => {
    for (const u of ["http://example.com/x", "ftp://example.com", "https://user:pw@example.com/x", "https://example.com:8443/x", "https://localhost/x", "https://api.localhost/x", "https://printer.local/x", "https://db.internal/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://10.0.0.5/x", "not a url", "", "javascript:alert(1)", "https://" + "a".repeat(400) + ".com"]) {
      expect(await checkWebhookUrl(u), u).toBeTypeOf("string");
    }
    expect(await checkWebhookUrl("https://8.8.8.8/hook")).toBeNull();
  });
  it("signatures verify with the same scheme documented to customers", () => {
    const body = '{"id":"evt_1"}';
    const sig = signWebhook("whsec_abc", body, 1700000000);
    expect(sig).toBe(`t=1700000000,v1=${createHmac("sha256", "whsec_abc").update(`1700000000.${body}`).digest("hex")}`);
    expect(signWebhook("whsec_other", body, 1700000000)).not.toBe(sig);
  });
  it("API key ids parse strictly", () => {
    expect(instanceIdFromKey("sfk_abc123xyz_" + "A".repeat(40))).toBe("abc123xyz");
    for (const bad of ["", "sfk_", "sfk_abc_short", "xxx_abc123_" + "A".repeat(40), "sfk_../../_" + "A".repeat(40), "sfk_abc123_" + "A".repeat(200)]) expect(instanceIdFromKey(bad), bad).toBeNull();
  });
  it("unsubscribe tokens are bound to the store and the address", () => {
    process.env.SESSION_SECRET ||= "z".repeat(40);
    const t = unsubscribeToken("store1", "A@B.com");
    expect(verifyUnsubscribe("store1", "a@b.com", t)).toBe(true);
    expect(verifyUnsubscribe("store2", "a@b.com", t)).toBe(false);
    expect(verifyUnsubscribe("store1", "c@d.com", t)).toBe(false);
    expect(verifyUnsubscribe("store1", "a@b.com", t + "x")).toBe(false);
    expect(verifyUnsubscribe("store1", "a@b.com", "")).toBe(false);
  });
});

describe.skipIf(!HAS_DB)("rules, integrations and campaigns (Atlas, synthetic tenants)", () => {
  const created: string[] = [];
  let A: TenantContext, B: TenantContext, P: { burger: string; drink: string; sold: string };
  let catFood = "";
  async function makeStore(sub: string) {
    const r = await provisionInstance(sa, { name: `Store ${sub}`, subdomain: sub, packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId);
    return issueTenantContext(r.instanceId);
  }
  const mk = async (ctx: TenantContext, name: string, price: string, stock: number, extra: Record<string, unknown> = {}) => {
    const r = await createProduct(ctx, ProductInput.parse({ name, price, stock, status: "published", trackStock: true, ...extra }), "PKR");
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };
  const place = async (items: { productId: string; qty: number }[], feat: Partial<Features> = {}, over: object = {}, ctx = A) =>
    placeOrder(ctx, await getSettings(ctx), { ...FEAT, ...feat }, "S", { items, customer: cust, method: "cod", idempotencyKey: key(), ...over });
  const setSettings = async (set: object) => (await tenantDb(A)).collection("settings").updateOne({ instanceId: A.instanceId }, { $set: set });

  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    process.env.SESSION_SECRET ||= "y".repeat(40);
    A = await makeStore("rules-a");
    B = await makeStore("rules-b");
    catFood = "cat-food";
    await categories.insert(A, { _id: catFood, name: "Food", slug: "food" } as never);
    P = { burger: await mk(A, "Burger", "1000", 100, { categoryId: catFood }), drink: await mk(A, "Cola", "100", 100), sold: await mk(A, "Brownie", "200", 0) };
    await setSettings({ taxBps: 0, shippingFlatMinor: 15000, freeShippingOverMinor: null });
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  describe("automatic promotions at checkout", () => {
    it("a running flash sale lowers the order total, snapshots the promotion and survives price changes", async () => {
      expect(await savePromo(A, { name: "Weekend", kind: "flash", percent: "20", min: "", categoryId: catFood, startsAt: "", endsAt: new Date(Date.now() + 3600_000).toISOString() }, "PKR")).toEqual({ ok: true });
      const r = await place([{ productId: P.burger, qty: 2 }, { productId: P.drink, qty: 1 }], { flashSales: true });
      if (!r.ok) throw new Error(r.error);
      const o = (await orders.findById(A, r.orderId))!;
      expect(o.subtotalMinor).toBe(210000);
      expect(o.discountMinor).toBe(40000); // 20% of the food only (2000), not the cola
      expect(o.promo?.name).toBe("Weekend");
      expect(o.totalMinor).toBe(210000 - 40000 + 15000);
    });
    it("does nothing when the feature is off, the promo is paused or it has ended", async () => {
      const off = await place([{ productId: P.burger, qty: 1 }], { flashSales: false });
      if (!off.ok) throw new Error(off.error);
      expect((await orders.findById(A, off.orderId))!.discountMinor).toBe(0);
      const id = (await listPromos(A))[0]._id;
      await setPromoActive(A, id, false);
      const paused = await place([{ productId: P.burger, qty: 1 }], { flashSales: true });
      if (!paused.ok) throw new Error(paused.error);
      expect((await orders.findById(A, paused.orderId))!.discountMinor).toBe(0);
      await setPromoActive(A, id, true);
      const later = await place([{ productId: P.burger, qty: 1 }], { flashSales: true }, { now: new Date(Date.now() + 2 * 3600_000) });
      if (!later.ok) throw new Error(later.error);
      expect((await orders.findById(A, later.orderId))!.discountMinor).toBe(0);
    });
    it("the cart shows the same discount the order will get", async () => {
      const cartId = "cart-" + "x".repeat(24);
      await setCartQty(A, cartId, P.burger, 1);
      const v = await cartView(A, cartId, { currency: "PKR", taxBps: 0, taxEnabled: false, shippingFlatMinor: 0, freeShippingOverMinor: null }, true, { flashSales: true });
      expect(v.promo?.promo.name).toBe("Weekend");
      expect(v.totals.discountMinor).toBe(20000);
      const none = await cartView(A, cartId, { currency: "PKR", taxBps: 0, taxEnabled: false, shippingFlatMinor: 0, freeShippingOverMinor: null }, true, {});
      expect(none.totals.discountMinor).toBe(0);
    });
    it("a bigger discount code beats the promotion and is consumed; a smaller one is not used up", async () => {
      const db = await tenantDb(A);
      await db.collection("discounts").insertMany([
        { instanceId: A.instanceId, code: "BIG50", percentBps: 5000, active: true, maxUses: null, used: 0, expiresAt: null, createdAt: new Date() },
        { instanceId: A.instanceId, code: "TINY5", percentBps: 500, active: true, maxUses: null, used: 0, expiresAt: null, createdAt: new Date() },
      ] as never);
      const big = await place([{ productId: P.burger, qty: 1 }], { flashSales: true }, { discountCode: "BIG50" });
      if (!big.ok) throw new Error(big.error);
      expect(await orders.findById(A, big.orderId)).toMatchObject({ discountMinor: 50000, discountCode: "BIG50" });
      const tiny = await place([{ productId: P.burger, qty: 1 }], { flashSales: true }, { discountCode: "TINY5" });
      if (!tiny.ok) throw new Error(tiny.error);
      const o = (await orders.findById(A, tiny.orderId))!;
      expect(o.discountMinor).toBe(20000);
      expect(o.discountCode).toBeUndefined();
      expect((await db.collection("discounts").findOne({ code: "TINY5" }))?.used).toBe(0);
    });
    it("rejects bad promotions", async () => {
      for (const bad of [{ name: "x", kind: "flash", percent: "20", min: "", categoryId: "", startsAt: "", endsAt: "2030-01-01T00:00" }, { name: "Ok name", kind: "weird", percent: "20", min: "", categoryId: "", startsAt: "", endsAt: "" }, { name: "Ok name", kind: "auto", percent: "0", min: "", categoryId: "", startsAt: "", endsAt: "" }, { name: "Ok name", kind: "auto", percent: "95", min: "", categoryId: "", startsAt: "", endsAt: "" }, { name: "Ok name", kind: "flash", percent: "20", min: "", categoryId: "", startsAt: "", endsAt: "" }, { name: "Ok name", kind: "auto", percent: "10", min: "abc", categoryId: "", startsAt: "", endsAt: "" }, { name: "Ok name", kind: "flash", percent: "10", min: "", categoryId: "", startsAt: "2030-02-01T00:00", endsAt: "2030-01-01T00:00" }]) {
        expect(await savePromo(A, bad, "PKR"), JSON.stringify(bad)).toMatchObject({ ok: false });
      }
      expect((await listPromos(B)).length).toBe(0);
    });
  });

  describe("per-customer coupon limits", () => {
    it("guests cannot use a limited code; signed-in customers get exactly their allowance; cancelled orders do not count", async () => {
      await (await tenantDb(A)).collection("discounts").insertOne({ instanceId: A.instanceId, code: "ONCE", percentBps: 1000, active: true, maxUses: null, perCustomer: 1, used: 0, expiresAt: null, createdAt: new Date() } as never);
      expect(await place([{ productId: P.drink, qty: 1 }], { couponLimits: true }, { discountCode: "ONCE" })).toMatchObject({ ok: false, code: "discount", error: expect.stringContaining("Sign in") });
      const a = await place([{ productId: P.drink, qty: 1 }], { couponLimits: true }, { discountCode: "ONCE", customerId: "cust-1" });
      expect(a.ok).toBe(true);
      expect(await place([{ productId: P.drink, qty: 1 }], { couponLimits: true }, { discountCode: "ONCE", customerId: "cust-1" })).toMatchObject({ ok: false, error: expect.stringContaining("already") });
      expect((await place([{ productId: P.drink, qty: 1 }], { couponLimits: true }, { discountCode: "ONCE", customerId: "cust-2" })).ok).toBe(true);
      if (a.ok) await (await orders.collection(A)).updateOne({ _id: a.orderId } as never, { $set: { state: "cancelled" } });
      expect((await place([{ productId: P.drink, qty: 1 }], { couponLimits: true }, { discountCode: "ONCE", customerId: "cust-1" })).ok).toBe(true);
    });
    it("without the feature the limit is ignored", async () => {
      expect((await place([{ productId: P.drink, qty: 1 }], { couponLimits: false }, { discountCode: "ONCE" })).ok).toBe(true);
    });
  });

  describe("backorders, opening hours and delivery zones", () => {
    it("sold-out items can be ordered only when the feature is on AND the product allows it", async () => {
      expect(await place([{ productId: P.sold, qty: 1 }])).toMatchObject({ ok: false, code: "stock" });
      expect(await place([{ productId: P.sold, qty: 1 }], { backorders: true })).toMatchObject({ ok: false, code: "stock" }); // product not marked
      await products.updateById(A, P.sold, { backorder: true });
      const r = await place([{ productId: P.sold, qty: 3 }], { backorders: true });
      expect(r.ok).toBe(true);
      expect((await products.findById(A, P.sold))!.stock).toBe(0); // never goes negative
      expect(await place([{ productId: P.sold, qty: 1 }], { backorders: false })).toMatchObject({ ok: false, code: "stock" });
      expect(await setCartQty(A, "cart-" + "y".repeat(24), P.sold, 2)).toEqual({ ok: true });
    });
    it("closed hours refuse the order and name the hours; open hours accept", async () => {
      await setSettings({ hours: { mon: { open: "09:00", close: "17:00" } } });
      const closed = await place([{ productId: P.drink, qty: 1 }], { hours: true }, { now: new Date("2026-06-08T12:30:00Z") });
      expect(closed).toMatchObject({ ok: false, error: expect.stringContaining("Mon 09:00-17:00") });
      expect((await place([{ productId: P.drink, qty: 1 }], { hours: true }, { now: new Date("2026-06-08T08:30:00Z") })).ok).toBe(true);
      expect((await place([{ productId: P.drink, qty: 1 }], { hours: false }, { now: new Date("2026-06-08T12:30:00Z") })).ok).toBe(true);
      await setSettings({ hours: {} });
      expect((await place([{ productId: P.drink, qty: 1 }], { hours: true }, { now: new Date("2026-06-08T12:30:00Z") })).ok).toBe(true);
    });
    it("delivery zones replace the flat fee for listed cities only", async () => {
      await setSettings({ zones: [{ id: "z", name: "Near", cities: ["Kasur"], feeMinor: 5000 }] });
      const near = await place([{ productId: P.drink, qty: 1 }], { zones: true }, { customer: { ...cust, city: "kasur" } });
      const far = await place([{ productId: P.drink, qty: 1 }], { zones: true });
      const off = await place([{ productId: P.drink, qty: 1 }], { zones: false }, { customer: { ...cust, city: "Kasur" } });
      if (!near.ok || !far.ok || !off.ok) throw new Error("order failed");
      expect((await orders.findById(A, near.orderId))!.shippingMinor).toBe(5000);
      expect((await orders.findById(A, far.orderId))!.shippingMinor).toBe(15000);
      expect((await orders.findById(A, off.orderId))!.shippingMinor).toBe(15000);
    });
  });

  describe("outgoing webhooks", () => {
    it("rejects private addresses and stores the secret encrypted", async () => {
      expect(await addEndpoint(A, "https://127.0.0.1/hook", ["order.paid"])).toMatchObject({ ok: false });
      expect(await addEndpoint(A, "https://8.8.8.8/hook", [])).toMatchObject({ ok: false });
      const r = await addEndpoint(A, "https://8.8.8.8/hook", ["order.paid", "order.created", "bogus"]);
      if (!r.ok) throw new Error(r.error);
      expect(r.secret).toMatch(/^whsec_/);
      const raw = JSON.stringify(await (await tenantDb(A)).collection("webhook_endpoints").findOne({}));
      expect(raw).not.toContain(r.secret);
      expect((await listEndpoints(A))[0].events.sort()).toEqual(["order.created", "order.paid"]);
      expect(await listEndpoints(B)).toEqual([]);
    });
    it("only fires when the feature is on, only for subscribed events, and delivers a verifiable signed body", async () => {
      const db = await tenantDb(A);
      const o = (await orders.find(A, {}, 1))[0];
      await emitWebhook(A, "order.paid", o);
      expect(await db.collection("webhook_deliveries").countDocuments({})).toBe(0); // feature off
      await db.collection("settings").updateOne({ instanceId: A.instanceId }, { $set: { "ownerToggles.F-099": true } });
      await emitWebhook(A, "order.status", o); // endpoint does not subscribe to it
      expect(await db.collection("webhook_deliveries").countDocuments({})).toBe(0);
      const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
      await emitWebhook(A, "order.paid", o);
      const queued = await db.collection("webhook_deliveries").find({}).toArray();
      expect(queued).toHaveLength(1);
      await db.collection("webhook_deliveries").updateMany({}, { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(0) } });
      const res = await processWebhooks(A, { send: async (url, init) => { sent.push({ url, ...init }); return { status: 200 }; } });
      expect(res).toMatchObject({ sent: 1 });
      const ep = await db.collection("webhook_endpoints").findOne({});
      const secret = decryptSecret(String(ep!.secretEnc));
      const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sent[0].headers["x-storeforge-signature"])!;
      expect(m[2]).toBe(createHmac("sha256", secret).update(`${m[1]}.${sent[0].body}`).digest("hex"));
      expect(sent[0].headers["x-storeforge-event"]).toBe("order.paid");
      const payload = JSON.parse(sent[0].body);
      expect(payload).toMatchObject({ type: "order.paid", data: { order: { orderNo: o.orderNo } } });
      expect(sent[0].body).not.toContain("passwordHash");
    });
    it("retries with backoff, parks as failed after the last attempt, and one click replays it", async () => {
      const db = await tenantDb(A);
      await db.collection("webhook_deliveries").deleteMany({});
      const o = (await orders.find(A, {}, 1))[0];
      await emitWebhook(A, "order.created", o);
      await db.collection("webhook_deliveries").updateMany({}, { $set: { nextAttemptAt: new Date(0), status: "pending", attempts: 0 } });
      const fail = async () => ({ status: 500 });
      let now = new Date();
      for (let i = 1; i <= WEBHOOK_MAX_ATTEMPTS; i++) {
        const r = await processWebhooks(A, { send: fail, now });
        expect(i < WEBHOOK_MAX_ATTEMPTS ? r.failed : r.dead).toBe(1);
        now = new Date(now.getTime() + 4 * 3600_000);
      }
      const d = (await recentDeliveries(A))[0];
      expect(d).toMatchObject({ status: "dead", attempts: WEBHOOK_MAX_ATTEMPTS });
      expect(d.lastError).toContain("500");
      expect(await processWebhooks(A, { send: fail, now })).toEqual({ sent: 0, failed: 0, dead: 0 }); // parked: nothing more is tried
      expect(await replayDelivery(B, d.id)).toBe(false); // another store cannot replay it
      await db.collection("webhook_deliveries").updateOne({ _id: d.id as never }, { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(0) } });
      expect((await processWebhooks(A, { send: async () => ({ status: 204 }) })).sent).toBe(1);
    });
    it("a turned-off or removed endpoint is not called", async () => {
      const db = await tenantDb(A);
      const id = (await listEndpoints(A))[0].id;
      await db.collection("webhook_deliveries").deleteMany({});
      const o = (await orders.find(A, {}, 1))[0];
      await emitWebhook(A, "order.created", o);
      await db.collection("webhook_deliveries").updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
      await setEndpoint(A, id, "disable");
      let called = 0;
      const r = await processWebhooks(A, { send: async () => { called++; return { status: 200 }; } });
      expect(called).toBe(0);
      expect(r.failed + r.dead).toBe(1);
      await setEndpoint(A, id, "delete");
      expect(await listEndpoints(A)).toEqual([]);
    });
    it("order flow never fails because of a broken integration", async () => {
      const db = await tenantDb(A);
      await db.collection("webhook_endpoints").insertOne({ _id: "bad" as never, instanceId: A.instanceId, url: "https://127.0.0.1/x", secretEnc: "garbage", events: ["order.created"], active: true, createdAt: new Date() });
      expect((await place([{ productId: P.drink, qty: 1 }])).ok).toBe(true);
      await db.collection("webhook_endpoints").deleteMany({});
    });
  });

  describe("API keys", () => {
    it("creates a key shown once, stores only a hash, verifies, revokes and never crosses stores", async () => {
      expect(await createApiKey(A, "x")).toMatchObject({ ok: false });
      const r = await createApiKey(A, "Accounting sheet");
      if (!r.ok) throw new Error(r.error);
      expect(instanceIdFromKey(r.key)).toBe(A.instanceId);
      expect(JSON.stringify(await (await tenantDb(A)).collection("api_keys").find({}).toArray())).not.toContain(r.key);
      expect(await verifyApiKey(A, r.key)).toBe(true);
      expect(await verifyApiKey(B, r.key)).toBe(false);
      expect(await verifyApiKey(A, r.key.slice(0, -1) + (r.key.endsWith("A") ? "B" : "A"))).toBe(false);
      expect((await listApiKeys(A))[0]).toMatchObject({ name: "Accounting sheet", revoked: false });
      await revokeApiKey(A, (await listApiKeys(A))[0].id);
      expect(await verifyApiKey(A, r.key)).toBe(false);
      for (let i = 0; i < 10; i++) await createApiKey(A, `key ${i}`);
      expect(await createApiKey(A, "one too many")).toMatchObject({ ok: false });
    });
  });

  describe("campaigns, blog and ledger", () => {
    it("sends to subscribers with a working unsubscribe link, throttles, and removing someone is permanent", async () => {
      expect(await sendCampaign(A, { subject: "Sale", message: "Big sale this weekend, come and see." }, "S")).toMatchObject({ ok: false, error: expect.stringContaining("subscribed") });
      for (const e of ["a@example.com", "b@example.com"]) await subscribeNewsletter(A, e, "9.9.9." + e.length, { storeName: "S", welcome: false });
      expect(await sendCampaign(A, { subject: "x", message: "short" }, "S")).toMatchObject({ ok: false });
      const r = await sendCampaign(A, { subject: "Weekend sale", message: "Everything is 20% off.\n\nSee you soon." }, "S");
      expect(r).toEqual({ ok: true, queued: 2 });
      const db = await tenantDb(A);
      const mail = await db.collection("emails").findOne({ to: "a@example.com", type: "campaign" });
      expect(mail?.subject).toBe("Weekend sale");
      const url = /unsubscribe\?e=([^&\s]+)&t=([A-Za-z0-9_-]+)/.exec(String(mail?.body))!;
      expect(await unsubscribe(A, decodeURIComponent(url[1]), "wrong")).toBe(false);
      expect(await unsubscribe(B, decodeURIComponent(url[1]), url[2])).toBe(false);
      expect(await db.collection("newsletter").countDocuments({ email: "a@example.com" })).toBe(1);
      expect(await unsubscribe(A, decodeURIComponent(url[1]), url[2])).toBe(true);
      expect(await db.collection("newsletter").countDocuments({ email: "a@example.com" })).toBe(0);
      expect(await sendCampaign(A, { subject: "Second", message: "A second message here." }, "S")).toMatchObject({ ok: true, queued: 1 });
      expect(await sendCampaign(A, { subject: "Third", message: "A third message here." }, "S")).toMatchObject({ ok: false, error: expect.stringContaining("two campaigns") });
    });
    it("blog posts and pages stay in their own lists, posts newest first, drafts hidden", async () => {
      await savePage(A, { title: "Our story", body: "x", kind: "page", published: true, inFooter: true });
      await savePage(A, { title: "First post", body: "hello", kind: "post", published: true, inFooter: true });
      await new Promise((r) => setTimeout(r, 15));
      await savePage(A, { title: "Second post", body: "again", kind: "post", published: true, inFooter: false });
      await savePage(A, { title: "Hidden post", body: "wip", kind: "post", published: false, inFooter: false });
      expect((await listPages(A, true, "post")).map((p) => p.title)).toEqual(["Second post", "First post"]);
      expect((await listPages(A, true, "page")).map((p) => p.title)).toEqual(["Our story"]);
      expect((await listPages(A, true, "post")).every((p) => p.inFooter === false)).toBe(true); // posts never appear in the footer
      expect(await savePage(A, { title: "Blog", body: "x", published: true, inFooter: false })).toMatchObject({ ok: false });
    });
    it("the ledger lists each sale and each refund with the right sign, per store", async () => {
      const r = await place([{ productId: P.drink, qty: 1 }], {}, { customer: { ...cust, email: "ledger@example.com", city: "Lahore" } });
      if (!r.ok) throw new Error(r.error);
      await (await orders.collection(A)).updateOne({ _id: r.orderId } as never, { $set: { "payment.state": "captured" } });
      expect(await refundOrder(A, r.orderId, 2500, { userId: "u", role: "store_owner" }, "refund-key-0001", { emails: false, storeName: "S" })).toEqual({ ok: true });
      const csv = await exportCsv(A, "ledger");
      const rows = csv.trim().split("\r\n");
      expect(rows[0]).toBe("date,order,type,method,reference,amount,tax_included,currency");
      const orderNo = (await orders.findById(A, r.orderId))!.orderNo;
      expect(rows.some((l) => l.includes(`,${orderNo},sale,`))).toBe(true);
      expect(rows.some((l) => l.includes(",refund,") && l.includes(",-25.00,"))).toBe(true);
      expect((await exportCsv(B, "ledger")).trim().split("\r\n")).toHaveLength(1);
    });
  });
});
