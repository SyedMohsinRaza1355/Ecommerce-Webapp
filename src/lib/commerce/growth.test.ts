import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { createProduct, getSettings, products, ProductInput } from "./store";
import { placeOrder, orders, type Features } from "./orders";
import { bestPromo, savePromo, listPromos, type Promo } from "./rules";
import {
  recordFunnel, funnel, submitQuote, listQuotes, requestReturn, setReturnState, returnForOrder, subscribeStockAlert, sweepStockAlerts,
  saveCartSnapshot, sweepAbandoned, cartForRestore, previewToken, previewOk, receiveStock, inStockNow,
} from "./growth";
import type { Actor } from "@/lib/auth/rbac";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const FEAT: Features = { shipping: false, freeShipping: false, tax: false, discounts: false, cod: true, card: false, emails: false, stockTracking: true, bxgy: true };
const PLATFORM = `test_grw_${Math.random().toString(36).slice(2, 8)}`;
const cust = { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
let n = 0;
const ip = () => `10.0.${Math.floor(Math.random() * 250)}.${++n % 250}`;

describe("buy X get Y (pure)", () => {
  const p: Promo = { _id: "p1", name: "Buy 2 get 1", kind: "bxgy", percentBps: 0, minSubtotalMinor: 0, categoryId: null, productId: "burger", buyQty: 2, getQty: 1, startsAt: null, endsAt: null, active: true, createdAt: new Date() };
  const line = (productId: string, qty: number, unit = 500) => ({ productId, categoryId: null, lineMinor: qty * unit, qty, unitMinor: unit });
  const on = { auto: false, flash: false, bxgy: true };
  it("gives one free for every three", () => {
    expect(bestPromo([p], [line("burger", 3)], new Date(), on)?.discountMinor).toBe(500);
    expect(bestPromo([p], [line("burger", 6)], new Date(), on)?.discountMinor).toBe(1000);
    expect(bestPromo([p], [line("burger", 5)], new Date(), on)?.discountMinor).toBe(500);
  });
  it("needs enough items, the right product, a running window and the feature", () => {
    expect(bestPromo([p], [line("burger", 2)], new Date(), on)).toBeNull();
    expect(bestPromo([p], [line("fries", 9)], new Date(), on)).toBeNull();
    expect(bestPromo([p], [line("burger", 3)], new Date(), { ...on, bxgy: false })).toBeNull();
    expect(bestPromo([{ ...p, active: false }], [line("burger", 3)], new Date(), on)).toBeNull();
    expect(bestPromo([{ ...p, endsAt: new Date(Date.now() - 1000) }], [line("burger", 3)], new Date(), on)).toBeNull();
    expect(bestPromo([{ ...p, buyQty: 0 }], [line("burger", 3)], new Date(), on)).toBeNull();
  });
  it("never discounts more than the basket", () => {
    expect(bestPromo([{ ...p, buyQty: 1, getQty: 5 }], [line("burger", 6, 100)], new Date(), on)!.discountMinor).toBeLessThanOrEqual(600);
  });
});

describe("preview links (pure)", () => {
  it("only match the right product in the right store", () => {
    const t = previewToken("inst1", "prod1");
    expect(previewOk("inst1", "prod1", t)).toBe(true);
    expect(previewOk("inst1", "prod2", t)).toBe(false);
    expect(previewOk("inst2", "prod1", t)).toBe(false);
    expect(previewOk("inst1", "prod1", undefined)).toBe(false);
    expect(previewOk("inst1", "prod1", t.slice(1))).toBe(false);
  });
});

describe.skipIf(!HAS_DB)("growth tools (Atlas, synthetic tenant)", () => {
  const created: string[] = [];
  let A: TenantContext, pid: string, idA: string;

  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    const r = await provisionInstance(sa, { name: "Grw", subdomain: "grw-a", packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId); idA = r.instanceId; A = issueTenantContext(idA);
    const p = await createProduct(A, ProductInput.parse({ name: "Burger", price: "500", stock: 50, status: "published", trackStock: true, sku: "BRG-1" }), "PKR");
    if (!p.ok) throw new Error(p.error);
    pid = p.id;
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  it("saves and applies a buy-get promotion at checkout", async () => {
    expect(await savePromo(A, { name: "B2G1", kind: "bxgy", percent: "", min: "", categoryId: "", startsAt: "", endsAt: "", productId: pid, buyQty: "2", getQty: "1" }, "PKR")).toEqual({ ok: true });
    expect(await savePromo(A, { name: "Bad", kind: "bxgy", percent: "", min: "", categoryId: "", startsAt: "", endsAt: "", productId: "nope", buyQty: "2", getQty: "1" }, "PKR")).toMatchObject({ ok: false });
    expect(await savePromo(A, { name: "Bad", kind: "bxgy", percent: "", min: "", categoryId: "", startsAt: "", endsAt: "", productId: pid, buyQty: "0", getQty: "1" }, "PKR")).toMatchObject({ ok: false });
    expect((await listPromos(A)).filter((x) => x.kind === "bxgy")).toHaveLength(1);
    const r = await placeOrder(A, await getSettings(A), FEAT, "S", { items: [{ productId: pid, qty: 3 }], customer: cust, method: "cod", idempotencyKey: `g-${Date.now()}-1` });
    if (!r.ok) throw new Error(r.error);
    const o = (await orders.findById(A, r.orderId))!;
    expect(o.discountMinor).toBe(50000);
    expect(o.subtotalMinor).toBe(150000);
  });

  it("counts funnel steps without storing who did them", async () => {
    const now = new Date();
    await recordFunnel(A, "view", now); await recordFunnel(A, "view", now); await recordFunnel(A, "cart", now); await recordFunnel(A, "checkout", now);
    const f = await funnel(A, 30, now);
    expect(f).toMatchObject({ view: 2, cart: 1, checkout: 1 });
    expect(f.orders).toBeGreaterThanOrEqual(1);
    expect((await funnel(A, 1, new Date(now.getTime() + 5 * 86_400_000))).view).toBe(0);
  });

  it("validates and stores quote requests, and rate limits them", async () => {
    const base = { productId: pid, name: "Bilal", email: "bilal@example.com", phone: "", qty: "20", message: "Need 20 for an event" };
    const addr = ip();
    expect(await submitQuote(A, base, addr, null, "S")).toEqual({ ok: true });
    for (const bad of [{ name: "B" }, { email: "nope" }, { qty: "0" }, { qty: "1.5" }, { message: "hi" }]) expect(await submitQuote(A, { ...base, ...bad }, ip(), null, "S"), JSON.stringify(bad)).toMatchObject({ ok: false });
    expect(await submitQuote(A, { ...base, honeypot: "x" }, ip(), null, "S")).toEqual({ ok: true }); // bots told it worked, nothing stored
    const rows = await listQuotes(A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productName: "Burger", qty: 20, status: "new" });
    const same = ip();
    const results = [];
    for (let i = 0; i < 7; i++) results.push((await submitQuote(A, base, same, null, "S")).ok);
    expect(results.filter(Boolean).length).toBe(5);
  });

  it("allows returns only after delivery, once, within 30 days", async () => {
    const col = await orders.collection(A);
    const o0 = (await orders.find(A, {} as never, 1))[0];
    const t = new Date();
    expect(await requestReturn(A, o0, "return", "It arrived broken", ip(), null, "S", t)).toMatchObject({ ok: false, error: expect.stringContaining("delivered") });
    await col.updateOne({ _id: o0._id, instanceId: idA } as never, { $set: { state: "completed" } });
    const o = (await orders.findById(A, o0._id))!;
    expect(await requestReturn(A, o, "swap", "It arrived broken", ip(), null, "S", t)).toMatchObject({ ok: false });
    expect(await requestReturn(A, o, "return", "bad", ip(), null, "S", t)).toMatchObject({ ok: false });
    expect(await requestReturn(A, o, "return", "It arrived broken", ip(), null, "S", new Date(t.getTime() + 31 * 86_400_000))).toMatchObject({ ok: false, error: expect.stringContaining("30 days") });
    expect(await requestReturn(A, o, "return", "It arrived broken", ip(), null, "S", t)).toEqual({ ok: true });
    expect(await requestReturn(A, o, "exchange", "Wrong size again", ip(), null, "S", t)).toMatchObject({ ok: false, error: expect.stringContaining("already open") });
    const r = (await returnForOrder(A, o._id))!;
    expect(r.state).toBe("requested");
    expect(await setReturnState(A, r._id, "approved", "", "S")).toEqual({ ok: true });
    expect(await setReturnState(A, r._id, "bogus", "", "S")).toMatchObject({ ok: false });
    expect(await setReturnState(A, "missing", "approved", "", "S")).toMatchObject({ ok: false });
    expect((await returnForOrder(A, o._id))!.state).toBe("approved");
    expect(await setReturnState(A, r._id, "rejected", "Outside policy", "S")).toEqual({ ok: true });
    expect(await requestReturn(A, o, "exchange", "Wrong size again", ip(), null, "S", t)).toEqual({ ok: true }); // a rejected one can be retried
  });

  it("emails people once when a sold-out product is back", async () => {
    const q = await createProduct(A, ProductInput.parse({ name: "Wrap", price: "300", stock: 0, status: "published", trackStock: true }), "PKR");
    if (!q.ok) throw new Error(q.error);
    expect(await subscribeStockAlert(A, q.id, "nope", ip())).toMatchObject({ ok: false });
    expect(await subscribeStockAlert(A, "missing", "w@example.com", ip())).toMatchObject({ ok: false });
    expect(await subscribeStockAlert(A, q.id, "w@example.com", ip())).toEqual({ ok: true });
    expect(await subscribeStockAlert(A, q.id, "W@example.com", ip())).toEqual({ ok: true }); // same person, no duplicate
    const db = await tenantDb(A);
    expect(await db.collection("stock_alerts").countDocuments({ instanceId: idA, productId: q.id })).toBe(1);
    expect(await sweepStockAlerts(A, "http://x/s/grw-a", "S")).toBe(0); // still sold out
    await products.collection(A).then((c) => c.updateOne({ _id: q.id, instanceId: idA } as never, { $set: { stock: 5 } }));
    expect(await sweepStockAlerts(A, "http://x/s/grw-a", "S")).toBe(1);
    expect(await sweepStockAlerts(A, "http://x/s/grw-a", "S")).toBe(0); // only once
    expect(await db.collection("outbox").countDocuments({ instanceId: idA, type: "stock.back", to: "w@example.com" })).toBe(1);
  });

  it("knows when variants are in stock", () => {
    const grp = (stocks: (number | null)[]) => ({ id: "g", name: "Size", kind: "variant" as const, required: true, multi: false, choices: stocks.map((s, i) => ({ id: `c${i}`, label: `c${i}`, priceDeltaMinor: 0, stock: s })) });
    expect(inStockNow({ trackStock: true, stock: 0, options: [grp([0, 0])] })).toBe(false);
    expect(inStockNow({ trackStock: true, stock: 0, options: [grp([0, 2])] })).toBe(true);
    expect(inStockNow({ trackStock: false, stock: 0 })).toBe(true);
    expect(inStockNow({ trackStock: true, stock: 0 })).toBe(false);
  });

  it("reminds about a forgotten cart once, not if they bought, and the link works for a week", async () => {
    const t0 = new Date("2026-06-01T10:00:00Z");
    const db = await tenantDb(A);
    await db.collection("carts").insertOne({ _id: "cartcartcartcartcart01" as never, instanceId: idA, items: [{ productId: pid, qty: 1 }], updatedAt: t0 });
    await saveCartSnapshot(A, "dana@example.com", "cartcartcartcartcart01", t0);
    await saveCartSnapshot(A, "not-an-email", "cartcartcartcartcart01", t0);
    expect(await db.collection("cart_snapshots").countDocuments({ instanceId: idA })).toBe(1);
    expect(await sweepAbandoned(A, "http://x/s/grw-a", "S", new Date(t0.getTime() + 30 * 60_000))).toBe(0); // too soon
    expect(await sweepAbandoned(A, "http://x/s/grw-a", "S", new Date(t0.getTime() + 2 * 3600_000))).toBe(1);
    expect(await sweepAbandoned(A, "http://x/s/grw-a", "S", new Date(t0.getTime() + 3 * 3600_000))).toBe(0); // once
    const snap = (await db.collection("cart_snapshots").findOne({ instanceId: idA, email: "dana@example.com" }))!;
    expect(await cartForRestore(A, String(snap.token), new Date(t0.getTime() + 2 * 86_400_000))).toBe("cartcartcartcartcart01");
    expect(await cartForRestore(A, String(snap.token), new Date(t0.getTime() + 8 * 86_400_000))).toBeNull();
    expect(await cartForRestore(A, "short", t0)).toBeNull();
    expect(await cartForRestore(A, "x".repeat(24), t0)).toBeNull();
    // a customer who already ordered is not nagged
    await db.collection("carts").insertOne({ _id: "cartcartcartcartcart02" as never, instanceId: idA, items: [{ productId: pid, qty: 1 }], updatedAt: t0 });
    await saveCartSnapshot(A, cust.email, "cartcartcartcartcart02", new Date(0));
    expect(await sweepAbandoned(A, "http://x/s/grw-a", "S", new Date(2 * 86_400_000))).toBe(0);
  });

  it("adds received stock by code and refuses unknown or duplicate codes", async () => {
    const before = (await products.findById(A, pid))!.stock;
    expect(await receiveStock(A, " brg-1 ", "10")).toMatchObject({ ok: true, name: "Burger", stock: before + 10 });
    expect(await receiveStock(A, "NOPE", "5")).toMatchObject({ ok: false });
    expect(await receiveStock(A, "BRG-1", "0")).toMatchObject({ ok: false });
    expect(await receiveStock(A, "BRG-1", "1.5")).toMatchObject({ ok: false });
    expect(await receiveStock(A, "", "1")).toMatchObject({ ok: false });
    expect(await receiveStock(A, ".*", "1")).toMatchObject({ ok: false }); // codes are text, never patterns
    await createProduct(A, ProductInput.parse({ name: "Burger copy", price: "500", stock: 1, status: "published", trackStock: true, sku: "BRG-1" }), "PKR");
    expect(await receiveStock(A, "BRG-1", "1")).toMatchObject({ ok: false, error: expect.stringContaining("unique") });
  });
});
