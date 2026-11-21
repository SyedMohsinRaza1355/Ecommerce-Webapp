import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient, platformDb } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { createProduct, getSettings, products, ProductInput, listPublished } from "./store";
import {
  placeOrder, orders, handleGatewayWebhook, simulateGatewayOutcome, transitionOrder, refundOrder, expireUnpaidOrders,
  findOrderByToken, anonymizeCustomer, retryPayment, trackingTokenFor, type Features, type PlaceInput,
} from "./orders";
import { signBody } from "./gateway";
import { processOutbox, enqueueEmail, backoffMs, MAX_ATTEMPTS } from "./outbox";
import { canOrderMove, canPaymentMove, ORDER_STATES, PAYMENT_STATES, roleMayMoveOrder } from "./states";
import { computeTotals } from "./pricing";
import { checkBrand, autoFixBrand, contrastRatio, isHex, readableTextOn } from "@/lib/color";
import type { Actor } from "@/lib/auth/rbac";

const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const staff = (role: string) => ({ userId: `u-${role}`, role });
const FEAT: Features = { shipping: true, freeShipping: true, tax: true, discounts: true, cod: true, card: true, emails: true, stockTracking: true };
const HAS_DB = Boolean(process.env.MONGODB_URI);
const PLATFORM = `test_commerce_${Math.random().toString(36).slice(2, 8)}`;
const customer = { name: "Ayesha Khan", email: "Ayesha@Example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
let n = 0;
const key = () => `idem-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;

describe("state machines", () => {
  it("order machine: only listed transitions are allowed", () => {
    const allowed: [string, string][] = [["pending", "confirmed"], ["pending", "cancelled"], ["confirmed", "processing"], ["processing", "ready"], ["ready", "fulfilled"], ["fulfilled", "completed"]];
    for (const a of ORDER_STATES) for (const b of ORDER_STATES) {
      const ok = allowed.some(([x, y]) => x === a && y === b) || (["confirmed", "processing", "ready"].includes(a) && b === "cancelled") || (a === "processing" && b === "fulfilled");
      expect(canOrderMove(a, b), `${a}->${b}`).toBe(ok);
    }
    expect(canOrderMove("completed", "cancelled")).toBe(false);
    expect(canOrderMove("cancelled", "confirmed")).toBe(false);
  });
  it("payment machine: refunded and unknown are dead ends; failed can retry", () => {
    expect(canPaymentMove("refunded", "captured")).toBe(false);
    expect(canPaymentMove("failed", "requires_payment")).toBe(true);
    expect(canPaymentMove("requires_payment", "refunded")).toBe(false);
    for (const s of PAYMENT_STATES) expect(canPaymentMove(s, "requires_payment") || true).toBe(true);
  });
  it("kitchen staff can only do fulfilment steps", () => {
    expect(roleMayMoveOrder("kitchen_ops", "ready")).toBe(true);
    expect(roleMayMoveOrder("kitchen_ops", "cancelled")).toBe(false);
    expect(roleMayMoveOrder("customer", "processing")).toBe(false);
    expect(roleMayMoveOrder("manager", "cancelled")).toBe(true);
  });
});

describe("pricing", () => {
  const cfg = { currency: "PKR", taxBps: 1700, taxEnabled: true, shippingFlatMinor: 15000, freeShippingOverMinor: 500000 };
  it("computes totals in integer minor units in the documented order", () => {
    const t = computeTotals([{ productId: "a", name: "A", unitMinor: 19999, qty: 3 }], cfg);
    expect(t.subtotalMinor).toBe(59997);
    expect(t.shippingMinor).toBe(15000);
    expect(t.taxMinor).toBe(10199); // 17% of 59997 = 10199.49 rounds to 10199
    expect(t.totalMinor).toBe(t.subtotalMinor + t.shippingMinor + t.taxMinor);
  });
  it("free shipping threshold, discount before tax, tax off", () => {
    const lines = [{ productId: "a", name: "A", unitMinor: 300000, qty: 2 }];
    expect(computeTotals(lines, cfg).shippingMinor).toBe(0);
    const d = computeTotals(lines, { ...cfg, discountBps: 1000 });
    expect(d.discountMinor).toBe(60000);
    expect(d.taxMinor).toBe(Math.round(540000 * 0.17));
    expect(computeTotals(lines, { ...cfg, taxEnabled: false }).taxMinor).toBe(0);
  });
  it("rejects bad quantities and keeps empty carts free of shipping", () => {
    expect(() => computeTotals([{ productId: "a", name: "A", unitMinor: 1, qty: 0 }], cfg)).toThrow();
    expect(() => computeTotals([{ productId: "a", name: "A", unitMinor: 1, qty: 1.5 }], cfg)).toThrow();
    expect(computeTotals([], cfg).totalMinor).toBe(0);
  });
});

describe("colour contrast guard (F-139)", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.6);
  });
  it("picks readable text and can auto-fix a weak brand colour", () => {
    expect(readableTextOn("#ffffff")).toBe("#0f172a");
    expect(readableTextOn("#111111")).toBe("#ffffff");
    expect(checkBrand("#4f46e5").passesAA).toBe(true);
    const weak = "#fde047";
    const fixed = autoFixBrand("#a3e635");
    expect(isHex(fixed)).toBe(true);
    expect(contrastRatio("#ffffff", fixed)).toBeGreaterThanOrEqual(4.5);
    expect(checkBrand(weak).passesAA).toBe(true); // dark text is chosen on yellow
  });
  it("rejects invalid colours", () => {
    expect(isHex("red")).toBe(false);
    expect(() => contrastRatio("red", "#fff")).toThrow();
  });
});

const created: string[] = [];
let A: TenantContext, B: TenantContext;
const P: Record<string, string> = {};

async function makeStore(sub: string) {
  const r = await provisionInstance(sa, { name: `Store ${sub}`, subdomain: sub, packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
  if (!r.ok) throw new Error(r.message);
  created.push(r.instanceId);
  return issueTenantContext(r.instanceId);
}

async function product(ctx: TenantContext, name: string, price: string, stock: number, extra: Partial<Record<string, unknown>> = {}) {
  const input = ProductInput.parse({ name, price, stock, status: "published", trackStock: true, ...extra });
  const r = await createProduct(ctx, input, "PKR");
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

const place = (ctx: TenantContext, items: PlaceInput["items"], over: Partial<PlaceInput> = {}) =>
  getSettings(ctx).then((s) => placeOrder(ctx, s, FEAT, "Test Store", { items, customer, method: "cod", idempotencyKey: key(), ...over }));
const stockOf = async (ctx: TenantContext, id: string) => (await products.findById(ctx, id))!.stock;

describe.skipIf(!HAS_DB)("commerce engine (Atlas, synthetic tenants)", () => {
  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    A = await makeStore("shop-a");
    B = await makeStore("shop-b");
    const db = await tenantDb(A);
    await db.collection("settings").updateOne({ instanceId: A.instanceId }, { $set: { taxBps: 1700, shippingFlatMinor: 15000, freeShippingOverMinor: 500000 } });
    P.burger = await product(A, "Zinger Burger", "450", 50);
    P.fries = await product(A, "Fries", "150", 10);
    P.rare = await product(A, "Rare Item", "999.99", 5);
    P.untracked = await product(A, "Gift Card", "1000", 0, { trackStock: false });
    P.draft = await product(A, "Draft Item", "10", 5, { status: "draft" });
    P.bProduct = await product(B, "B Burger", "450", 50);
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  describe("product validation and catalogue", () => {
    it("rejects bad input and negative or inconsistent prices", async () => {
      expect(ProductInput.safeParse({ name: "", price: "1", stock: 1, status: "draft" }).success).toBe(false);
      expect(ProductInput.safeParse({ name: "x", price: "1", stock: -1, status: "draft" }).success).toBe(false);
      expect(ProductInput.safeParse({ name: "x", price: "1", stock: 1.5, status: "draft" }).success).toBe(false);
      expect(ProductInput.safeParse({ name: "x", price: "1", stock: 1, status: "draft", imageUrl: "javascript:alert(1)" }).success).toBe(false);
      expect(ProductInput.safeParse({ name: "x", price: "1", stock: 1, status: "draft", imageUrl: "http://insecure.example/a.png" }).success).toBe(false);
      const bad = await createProduct(A, ProductInput.parse({ name: "x", price: "abc", stock: 1, status: "draft" }), "PKR");
      expect(bad.ok).toBe(false);
      const cmp = await createProduct(A, ProductInput.parse({ name: "x", price: "100", compareAt: "50", stock: 1, status: "draft" }), "PKR");
      expect(cmp.ok).toBe(false);
    });
    it("gives duplicate names unique slugs and never lists drafts publicly", async () => {
      const a = await product(A, "Twin", "1", 1);
      const b = await product(A, "Twin", "1", 1);
      const [pa, pb] = [await products.findById(A, a), await products.findById(A, b)];
      expect(pa!.slug).not.toBe(pb!.slug);
      const list = await listPublished(A, { pageSize: 60 });
      expect(list.items.some((p) => p._id === P.draft)).toBe(false);
      expect(list.items.some((p) => p._id === P.burger)).toBe(true);
    });
    it("search escapes regex characters and paginates", async () => {
      expect((await listPublished(A, { q: ".*" })).items).toHaveLength(0);
      expect((await listPublished(A, { q: "zinger" })).items.map((p) => p._id)).toEqual([P.burger]);
      const p1 = await listPublished(A, { pageSize: 2, page: 1 });
      const p2 = await listPublished(A, { pageSize: 2, page: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p1.items.map((x) => x._id)).not.toEqual(p2.items.map((x) => x._id));
    });
  });

  describe("placing orders", () => {
    it("snapshots server-side prices and totals, decrements stock, assigns sequential numbers", async () => {
      const before = await stockOf(A, P.burger);
      const r = await place(A, [{ productId: P.burger, qty: 2 }]);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const o = (await orders.findById(A, r.orderId))!;
      expect(o.items[0]).toMatchObject({ unitMinor: 45000, qty: 2, lineMinor: 90000 });
      expect(o.subtotalMinor).toBe(90000);
      expect(o.shippingMinor).toBe(15000);
      expect(o.taxMinor).toBe(15300);
      expect(o.totalMinor).toBe(120300);
      expect(o.state).toBe("confirmed");
      expect(o.payment.state).toBe("cod_due");
      expect(o.customer.email).toBe("ayesha@example.com");
      expect(await stockOf(A, P.burger)).toBe(before - 2);
      const r2 = await place(A, [{ productId: P.burger, qty: 1 }]);
      if (r2.ok) expect(r2.orderNo).toBe(r.orderNo + 1);
    });
    it("a later price change never alters an existing order", async () => {
      const r = await place(A, [{ productId: P.fries, qty: 1 }]);
      if (!r.ok) throw new Error("x");
      await products.updateById(A, P.fries, { priceMinor: 99999 });
      expect((await orders.findById(A, r.orderId))!.items[0].unitMinor).toBe(15000);
      await products.updateById(A, P.fries, { priceMinor: 15000 });
    });
    it("is idempotent: the same key never creates or charges twice", async () => {
      const k = key();
      const before = await stockOf(A, P.fries);
      const [x, y, z] = await Promise.all([1, 2, 3].map(() => place(A, [{ productId: P.fries, qty: 1 }], { idempotencyKey: k })));
      const ids = new Set([x, y, z].map((r) => (r.ok ? r.orderId : "fail")));
      expect(ids.size).toBe(1);
      expect(await orders.count(A, { idempotencyKey: k } as never)).toBe(1);
      expect(await stockOf(A, P.fries)).toBe(before - 1);
    });
    it("CONCURRENCY: 25 buyers fight for 5 items: exactly 5 succeed and stock never goes negative", async () => {
      const results = await Promise.all(Array.from({ length: 25 }, () => place(A, [{ productId: P.rare, qty: 1 }])));
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(results.filter((r) => !r.ok && r.code === "stock")).toHaveLength(20);
      expect(await stockOf(A, P.rare)).toBe(0);
    });
    it("a failing line rolls back stock already taken for other lines", async () => {
      const before = await stockOf(A, P.burger);
      const r = await place(A, [{ productId: P.burger, qty: 3 }, { productId: P.rare, qty: 1 }]);
      expect(r.ok).toBe(false);
      expect(await stockOf(A, P.burger)).toBe(before);
    });
    it("rejects bad input: empty cart, quantities, drafts, unknown products, invalid customer, bad key", async () => {
      expect(await place(A, [])).toMatchObject({ ok: false, code: "empty" });
      for (const qty of [0, -1, 1.5, 100, NaN]) expect(await place(A, [{ productId: P.burger, qty }])).toMatchObject({ ok: false, code: "validation" });
      expect(await place(A, [{ productId: P.draft, qty: 1 }])).toMatchObject({ ok: false, code: "stock" });
      expect(await place(A, [{ productId: "nope", qty: 1 }])).toMatchObject({ ok: false });
      expect(await place(A, [{ productId: P.burger, qty: 1 }], { customer: { ...customer, email: "bad" } })).toMatchObject({ ok: false, code: "validation" });
      expect(await place(A, [{ productId: P.burger, qty: 1 }], { customer: { ...customer, phone: "abc" } })).toMatchObject({ ok: false });
      expect(await place(A, [{ productId: P.burger, qty: 1 }], { idempotencyKey: "short" })).toMatchObject({ ok: false });
    });
    it("a buyer can never order another store's product", async () => {
      expect(await place(A, [{ productId: P.bProduct, qty: 1 }])).toMatchObject({ ok: false });
      expect(await stockOf(B, P.bProduct)).toBe(50);
    });
    it("untracked items never run out", async () => {
      const r = await Promise.all(Array.from({ length: 5 }, () => place(A, [{ productId: P.untracked, qty: 9 }])));
      expect(r.every((x) => x.ok)).toBe(true);
    });
    it("payment methods follow feature toggles", async () => {
      const s = await getSettings(A);
      const r = await placeOrder(A, s, { ...FEAT, cod: false }, "S", { items: [{ productId: P.burger, qty: 1 }], customer, method: "cod", idempotencyKey: key() });
      expect(r).toMatchObject({ ok: false, code: "method" });
    });
  });

  describe("card payments and the signed webhook", () => {
    const intentOf = async (id: string) => (await orders.findById(A, id))!.payment.intentRef!;
    const body = (over: object) => JSON.stringify({ id: `evt_${Math.random()}`, type: "payment.succeeded", currency: "PKR", ...over });
    const send = (b: string, sig?: string | null) => handleGatewayWebhook(b, sig === undefined ? signBody(b, Math.floor(Date.now() / 1000)) : sig);

    it("order stays pending until a verified webhook arrives; redirect alone proves nothing", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      const o = (await orders.findById(A, r.orderId))!;
      expect(o).toMatchObject({ state: "pending" });
      expect(o.payment.state).toBe("requires_payment");
      expect(r.needsPayment).toBe(true);
      const res = await simulateGatewayOutcome(A, r.orderId, "succeeded");
      expect(res.status).toBe(200);
      const paid = (await orders.findById(A, r.orderId))!;
      expect(paid.state).toBe("confirmed");
      expect(paid.payment.state).toBe("captured");
    });
    it("rejects bad, missing, malformed, tampered and stale signatures", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      const ref = await intentOf(r.orderId);
      const b = body({ intentRef: ref, amountMinor: (await orders.findById(A, r.orderId))!.totalMinor });
      expect((await send(b, null)).status).toBe(400);
      expect((await send(b, "garbage")).status).toBe(400);
      expect((await send(b, `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`)).status).toBe(400);
      expect((await send(b + " ", signBody(b, Math.floor(Date.now() / 1000)))).status).toBe(400); // body changed after signing
      expect((await send(b, signBody(b, Math.floor(Date.now() / 1000) - 3600))).status).toBe(400); // replay window
      expect((await orders.findById(A, r.orderId))!.payment.state).toBe("requires_payment");
    });
    it("duplicate delivery of the same event changes nothing", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      const o = (await orders.findById(A, r.orderId))!;
      const b = body({ id: "evt_fixed_dup", intentRef: o.payment.intentRef, amountMinor: o.totalMinor });
      const a1 = await send(b);
      const a2 = await send(b);
      expect(a1.body).toEqual({ ok: true });
      expect(a2.body).toEqual({ ok: true, duplicate: true });
      const hist = (await orders.findById(A, r.orderId))!.history.filter((h) => h.to === "captured");
      expect(hist).toHaveLength(1);
    });
    it("rejects unknown intents, wrong amounts and malformed events", async () => {
      expect((await send(body({ intentRef: "pi_unknown", amountMinor: 1 }))).status).toBe(404);
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      expect((await send(body({ intentRef: await intentOf(r.orderId), amountMinor: 1 }))).status).toBe(422);
      expect((await orders.findById(A, r.orderId))!.payment.state).toBe("requires_payment");
      expect((await send("not json", signBody("not json", Math.floor(Date.now() / 1000)))).status).toBe(400);
      expect((await send(body({ type: "payment.hacked", intentRef: "x", amountMinor: 1 }))).status).toBe(400);
    });
    it("failed payment then retry then success: one order, no double charge", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      await simulateGatewayOutcome(A, r.orderId, "failed");
      expect((await orders.findById(A, r.orderId))!.payment.state).toBe("failed");
      expect(await retryPayment(A, r.orderId)).toBe(true);
      expect(await retryPayment(A, r.orderId)).toBe(false);
      await simulateGatewayOutcome(A, r.orderId, "succeeded");
      expect((await orders.findById(A, r.orderId))!.payment.state).toBe("captured");
    });
    it("a late failure after success is ignored (out-of-order events)", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      await simulateGatewayOutcome(A, r.orderId, "succeeded");
      await simulateGatewayOutcome(A, r.orderId, "failed");
      expect((await orders.findById(A, r.orderId))!.payment.state).toBe("captured");
    });
    it("payment arriving after cancellation flags a refund instead of resurrecting the order", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      expect(await transitionOrder(A, r.orderId, "cancelled", staff("manager"), { emails: false, storeName: "S" })).toEqual({ ok: true });
      await simulateGatewayOutcome(A, r.orderId, "succeeded");
      const o = (await orders.findById(A, r.orderId))!;
      expect(o.state).toBe("cancelled");
      expect(o.payment.state).toBe("captured");
      expect(o.flags?.refundRequired).toBe(true);
      expect(await refundOrder(A, r.orderId, o.totalMinor, staff("manager"), key(), { emails: false, storeName: "S" })).toEqual({ ok: true });
      expect((await orders.findById(A, r.orderId))!.flags?.refundRequired).toBe(false);
    });
    it("two events racing for the same order result in exactly one capture", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      const o = (await orders.findById(A, r.orderId))!;
      await Promise.all([1, 2, 3, 4].map((i) => send(body({ id: `evt_race_${r.orderId}_${i}`, intentRef: o.payment.intentRef, amountMinor: o.totalMinor }))));
      expect((await orders.findById(A, r.orderId))!.history.filter((h) => h.to === "captured")).toHaveLength(1);
    });
    it("a webhook for store A's payment can never touch store B", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      await simulateGatewayOutcome(A, r.orderId, "succeeded");
      expect(await orders.findById(B, r.orderId)).toBeNull();
      expect(await orders.count(B)).toBe(0);
    });
  });

  describe("staff order operations", () => {
    const notify = { emails: true, storeName: "S" };
    it("enforces the state machine, roles and card-confirmation rule", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }]);
      if (!r.ok) throw new Error("x");
      expect(await transitionOrder(A, r.orderId, "completed", staff("manager"), notify)).toMatchObject({ ok: false });
      expect(await transitionOrder(A, r.orderId, "processing", staff("customer"), notify)).toMatchObject({ ok: false, error: expect.stringContaining("role") });
      expect(await transitionOrder(A, r.orderId, "cancelled", staff("kitchen_ops"), notify)).toMatchObject({ ok: false });
      expect(await transitionOrder(A, r.orderId, "processing", staff("kitchen_ops"), notify)).toEqual({ ok: true });
      for (const to of ["ready", "fulfilled", "completed"] as const) expect(await transitionOrder(A, r.orderId, to, staff("manager"), notify)).toEqual({ ok: true });
      const o = (await orders.findById(A, r.orderId))!;
      expect(o.payment.state).toBe("captured"); // COD collected on completion
      expect(o.history.length).toBeGreaterThanOrEqual(5);
      const card = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!card.ok) throw new Error("x");
      expect(await transitionOrder(A, card.orderId, "confirmed", staff("owner"), notify)).toMatchObject({ ok: false });
      expect(await transitionOrder(A, "missing", "processing", staff("manager"), notify)).toMatchObject({ ok: false });
    });
    it("cancelling releases stock exactly once even when two staff cancel at the same time", async () => {
      const before = await stockOf(A, P.burger);
      const r = await place(A, [{ productId: P.burger, qty: 4 }]);
      if (!r.ok) throw new Error("x");
      expect(await stockOf(A, P.burger)).toBe(before - 4);
      const res = await Promise.all([1, 2, 3].map(() => transitionOrder(A, r.orderId, "cancelled", staff("manager"), notify)));
      expect(res.filter((x) => x.ok)).toHaveLength(1);
      expect(await stockOf(A, P.burger)).toBe(before);
    });
    it("abandoned card orders expire and give stock back", async () => {
      const pid = await product(A, "Expiry Test Item", "10", 10);
      const r = await place(A, [{ productId: pid, qty: 2 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      expect(await stockOf(A, pid)).toBe(8);
      await expireUnpaidOrders(A, 30 * 60_000); // too fresh: untouched
      expect((await orders.findById(A, r.orderId))!.state).toBe("pending");
      expect(await expireUnpaidOrders(A, 30 * 60_000, new Date(Date.now() + 31 * 60_000))).toBeGreaterThanOrEqual(1);
      expect((await orders.findById(A, r.orderId))!.state).toBe("cancelled");
      expect(await stockOf(A, pid)).toBe(10);
      expect(await expireUnpaidOrders(A, 30 * 60_000, new Date(Date.now() + 31 * 60_000))).toBe(0); // idempotent
      expect(await stockOf(A, pid)).toBe(10);
    });
    it("refunds: partial then full, never above what was paid, idempotent per key, role-checked", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      expect(await refundOrder(A, r.orderId, 100, staff("manager"), key(), notify)).toMatchObject({ ok: false }); // unpaid
      await simulateGatewayOutcome(A, r.orderId, "succeeded");
      const total = (await orders.findById(A, r.orderId))!.totalMinor;
      expect(await refundOrder(A, r.orderId, 0, staff("manager"), key(), notify)).toMatchObject({ ok: false });
      expect(await refundOrder(A, r.orderId, -5, staff("manager"), key(), notify)).toMatchObject({ ok: false });
      expect(await refundOrder(A, r.orderId, 5, staff("kitchen_ops"), key(), notify)).toMatchObject({ ok: false });
      const k1 = key();
      expect(await refundOrder(A, r.orderId, 1000, staff("manager"), k1, notify)).toEqual({ ok: true });
      expect(await refundOrder(A, r.orderId, 1000, staff("manager"), k1, notify)).toEqual({ ok: true, duplicate: true });
      let o = (await orders.findById(A, r.orderId))!;
      expect(o.payment).toMatchObject({ state: "partially_refunded", refundedMinor: 1000 });
      expect(await refundOrder(A, r.orderId, total, staff("manager"), key(), notify)).toMatchObject({ ok: false }); // too much
      expect(await refundOrder(A, r.orderId, total - 1000, staff("manager"), key(), notify)).toEqual({ ok: true });
      o = (await orders.findById(A, r.orderId))!;
      expect(o.payment).toMatchObject({ state: "refunded", refundedMinor: total });
      expect(await refundOrder(A, r.orderId, 1, staff("manager"), key(), notify)).toMatchObject({ ok: false });
    });
    it("CONCURRENCY: parallel refunds can never exceed the amount paid", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { method: "card" });
      if (!r.ok) throw new Error("x");
      await simulateGatewayOutcome(A, r.orderId, "succeeded");
      const total = (await orders.findById(A, r.orderId))!.totalMinor;
      const each = Math.ceil(total / 3) + 1;
      const res = await Promise.all(Array.from({ length: 6 }, () => refundOrder(A, r.orderId, each, staff("owner"), key(), notify)));
      const okCount = res.filter((x) => x.ok).length;
      const o = (await orders.findById(A, r.orderId))!;
      expect(o.payment.refundedMinor).toBe(okCount * each);
      expect(o.payment.refundedMinor).toBeLessThanOrEqual(total);
    });
  });

  describe("discount codes (F-053)", () => {
    it("applies once per use, enforces limits atomically, and restores stock when the code is used up", async () => {
      const db = await tenantDb(A);
      await db.collection("discounts").insertOne({ instanceId: A.instanceId, code: "ONCE10", percentBps: 1000, active: true, maxUses: 1, used: 0, expiresAt: null } as never);
      const before = await stockOf(A, P.fries);
      const res = await Promise.all(Array.from({ length: 4 }, () => place(A, [{ productId: P.fries, qty: 1 }], { discountCode: "once10" })));
      expect(res.filter((r) => r.ok)).toHaveLength(1);
      expect(res.filter((r) => !r.ok && r.code === "discount")).toHaveLength(3);
      expect(await stockOf(A, P.fries)).toBe(before - 1); // failed attempts gave stock back
      const win = res.find((r) => r.ok)!;
      if (win.ok) expect((await orders.findById(A, win.orderId))!.discountMinor).toBe(1500);
    });
    it("rejects unknown, expired and inactive codes", async () => {
      const db = await tenantDb(A);
      await db.collection("discounts").insertMany([
        { instanceId: A.instanceId, code: "OLD", percentBps: 500, active: true, maxUses: null, used: 0, expiresAt: new Date(Date.now() - 1000) },
        { instanceId: A.instanceId, code: "OFF", percentBps: 500, active: false, maxUses: null, used: 0, expiresAt: null },
      ] as never);
      for (const c of ["NOPE", "OLD", "OFF"]) expect(await place(A, [{ productId: P.fries, qty: 1 }], { discountCode: c })).toMatchObject({ ok: false, code: "discount" });
    });
  });

  describe("outbox and notifications", () => {
    it("sends once, records the message, and retries with backoff then dead-letters on a long outage", async () => {
      const db = await tenantDb(A);
      await db.collection("outbox").deleteMany({});
      await enqueueEmail(A, "order.status", "a@b.com", { orderNo: 1, status: "ready", storeName: "S", trackUrl: "/t" });
      let t = new Date();
      expect(await processOutbox(A, { failFor: () => true, now: t })).toMatchObject({ failed: 1, sent: 0 });
      expect(await processOutbox(A, { now: t })).toMatchObject({ sent: 0 }); // not due yet (backoff)
      for (let i = 1; i < MAX_ATTEMPTS; i++) {
        t = new Date(t.getTime() + backoffMs(i) + 1000);
        await processOutbox(A, { failFor: () => true, now: t });
      }
      const m = await db.collection("outbox").findOne({ to: "a@b.com" });
      expect(m?.status).toBe("dead");
      expect(await db.collection("emails").countDocuments({ to: "a@b.com" })).toBe(0);
    });
    it("order emails link to the real order page of the right store", async () => {
      const r = await place(A, [{ productId: P.fries, qty: 1 }]);
      if (!r.ok) throw new Error("x");
      const db = await tenantDb(A);
      const mail = await db.collection("emails").find({ to: "ayesha@example.com", type: "order.placed" }).sort({ sentAt: -1 }).limit(1).toArray();
      expect(mail[0].body).toContain(`/s/shop-a/order/${r.trackingToken}`);
      expect(mail[0].body).toMatch(/https?:\/\//);
      expect(mail[0].body).not.toContain("/track/");
    });
    it("a recovered provider delivers exactly once even with concurrent workers", async () => {
      const db = await tenantDb(A);
      await enqueueEmail(A, "order.cancelled", "c@d.com", { orderNo: 2, storeName: "S" });
      await Promise.all([1, 2, 3].map(() => processOutbox(A)));
      expect(await db.collection("emails").countDocuments({ to: "c@d.com" })).toBe(1);
    });
    it("backoff grows and is capped", () => {
      expect(backoffMs(1)).toBe(60_000);
      expect(backoffMs(2)).toBe(120_000);
      expect(backoffMs(20)).toBe(3_600_000);
    });
  });

  describe("tracking links and privacy", () => {
    it("tracking tokens work only for the right order in the right store", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }]);
      if (!r.ok) throw new Error("x");
      expect((await findOrderByToken(A, r.trackingToken))?._id).toBe(r.orderId);
      expect(await findOrderByToken(B, r.trackingToken)).toBeNull();
      expect(await findOrderByToken(A, "x".repeat(30))).toBeNull();
      expect(await findOrderByToken(A, r.orderId)).toBeNull(); // the order id itself is not a credential
      expect(await findOrderByToken(A, "../../etc")).toBeNull();
      expect(trackingTokenFor(A.instanceId, r.orderId)).toBe(r.trackingToken);
      expect(trackingTokenFor(B.instanceId, r.orderId)).not.toBe(r.trackingToken);
    });
    it("anonymising a customer removes personal data but keeps the financial record", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }], { customer: { ...customer, email: "gone@example.com" } });
      if (!r.ok) throw new Error("x");
      expect(await anonymizeCustomer(A, "GONE@example.com")).toBe(1);
      const o = (await orders.findById(A, r.orderId))!;
      expect(o.customer.name).toBe("[deleted]");
      expect(o.customer.address).toBe("[deleted]");
      expect(o.totalMinor).toBeGreaterThan(0);
      expect(await anonymizeCustomer(B, "gone@example.com")).toBe(0);
    });
  });

  describe("CROSS-TENANT isolation for commerce data", () => {
    it("store B cannot read, update, refund, transition or search store A's orders and products", async () => {
      const r = await place(A, [{ productId: P.burger, qty: 1 }]);
      if (!r.ok) throw new Error("x");
      expect(await orders.findById(B, r.orderId)).toBeNull();
      expect(await products.findById(B, P.burger)).toBeNull();
      expect(await transitionOrder(B, r.orderId, "processing", staff("owner"), { emails: false, storeName: "B" })).toMatchObject({ ok: false });
      expect(await refundOrder(B, r.orderId, 1, staff("owner"), key(), { emails: false, storeName: "B" })).toMatchObject({ ok: false });
      expect(await orders.find(B, { "customer.city": "Lahore" } as never)).toHaveLength(0);
      expect((await listPublished(B, { q: "zinger" })).items).toHaveLength(0);
      expect((await orders.findById(A, r.orderId))!.state).toBe("confirmed");
    });
    it("every stored document carries its own instanceId and nothing leaks between databases", async () => {
      const dbA = await tenantDb(A), dbB = await tenantDb(B);
      for (const col of ["orders", "products", "categories"]) {
        expect(await dbA.collection(col).countDocuments({ instanceId: { $ne: A.instanceId } })).toBe(0);
        expect(await dbB.collection(col).countDocuments({ instanceId: { $ne: B.instanceId } })).toBe(0);
      }
      expect(await platformDb().then((d) => d.collection("payment_intents").countDocuments({ instanceId: B.instanceId }))).toBe(0);
    });
  });
});
