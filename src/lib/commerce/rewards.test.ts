import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { createProduct, getSettings, ProductInput } from "./store";
import { placeOrder, orders, transitionOrder, type Features, type PlaceInput } from "./orders";
import { registerCustomer } from "./customers";
import { issueGiftCard, giftCardBalance, balancesOf, grantCredit, setCustomerGroup, applyReferral, ensureReferralCode, ledgerOf, normaliseCode } from "./rewards";
import type { Actor } from "@/lib/auth/rbac";
import type { Settings } from "./types";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const FEAT: Features = { shipping: false, freeShipping: false, tax: false, discounts: false, cod: true, card: true, emails: false, stockTracking: true, giftCards: true, credit: true, loyalty: true, groups: true, referral: true };
const PLATFORM = `test_rwd_${Math.random().toString(36).slice(2, 8)}`;
const cust = { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
let n = 0;
const key = () => `rwd-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;

describe("code normalising (pure)", () => {
  it("ignores case and spaces", () => expect(normaliseCode(" gc-abcd- 2345 ")).toBe("GC-ABCD-2345"));
});

describe.skipIf(!HAS_DB)("rewards (Atlas, synthetic tenant)", () => {
  const created: string[] = [];
  let A: TenantContext, pid: string, idA: string, S: Settings;
  const actor = (): Actor => ({ userId: "owner", role: "store_owner", instanceId: idA });
  const buy = async (over: Partial<PlaceInput> = {}, feat: Partial<Features> = {}, qty = 1) =>
    placeOrder(A, S, { ...FEAT, ...feat }, "S", { items: [{ productId: pid, qty }], customer: cust, method: "cod", idempotencyKey: key(), ...over });
  const customer = async (email: string, pw = "Correct-Horse-9x") => {
    const r = await registerCustomer(A, { name: "Test Person", email, password: pw }, `10.1.${++n % 250}.1`);
    if (!r.ok) throw new Error(r.error);
    return r.customer._id;
  };

  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    const r = await provisionInstance(sa, { name: "Rwd", subdomain: "rwd-a", packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId); idA = r.instanceId; A = issueTenantContext(idA);
    const p = await createProduct(A, ProductInput.parse({ name: "Burger", price: "1000", stock: 500, status: "published", trackStock: true }), "PKR");
    if (!p.ok) throw new Error(p.error);
    pid = p.id;
    await (await tenantDb(A)).collection("settings").updateOne({ instanceId: idA }, { $set: { taxBps: 0, shippingFlatMinor: 0, groups: [{ id: "vip", name: "VIP", percentBps: 1000 }], referral: { rewardMinor: 20000 }, loyalty: { earnPer100: 5, pointMinor: 20 } } });
    S = await getSettings(A);
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  it("issues gift cards with unique codes and refuses odd amounts", async () => {
    expect(await issueGiftCard(A, { amountMinor: 50, note: "", expiresAt: "" })).toMatchObject({ ok: false });
    expect(await issueGiftCard(A, { amountMinor: 100_000, note: "", expiresAt: "2001-01-01" })).toMatchObject({ ok: false });
    const a = await issueGiftCard(A, { amountMinor: 100_000, note: "x", expiresAt: "" }), b = await issueGiftCard(A, { amountMinor: 100_000, note: "", expiresAt: "" });
    if (!a.ok || !b.ok) throw new Error("issue failed");
    expect(a.code).toMatch(/^GC-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(a.code).not.toBe(b.code);
    expect(await giftCardBalance(A, a.code.toLowerCase())).toMatchObject({ balanceMinor: 100_000 });
    expect(await giftCardBalance(A, "GC-NOPE-NOPE")).toBeNull();
    expect(await giftCardBalance(A, "$ne")).toBeNull();
  });

  it("splits a payment: the card covers part, the rest is cash on delivery", async () => {
    const g = await issueGiftCard(A, { amountMinor: 30_000, note: "", expiresAt: "" });
    if (!g.ok) throw new Error("issue");
    const r = await buy({ giftCode: g.code });
    if (!r.ok) throw new Error(r.error);
    const o = (await orders.findById(A, r.orderId))!;
    expect(o).toMatchObject({ subtotalMinor: 100_000, totalMinor: 70_000, rewards: { giftCode: g.code, giftMinor: 30_000 } });
    expect(o.payment).toMatchObject({ method: "cod", state: "cod_due" });
    expect(await giftCardBalance(A, g.code)).toBeNull(); // used up
    expect(await buy({ giftCode: g.code })).toMatchObject({ ok: false, error: expect.stringContaining("not valid") });
    expect(await buy({ giftCode: "GC-ZZZZ-ZZZZ" })).toMatchObject({ ok: false });
    expect(await buy({ giftCode: g.code }, { giftCards: false })).toMatchObject({ ok: false });
  });

  it("a card that covers everything marks the order paid and needs no gateway", async () => {
    const g = await issueGiftCard(A, { amountMinor: 500_000, note: "", expiresAt: "" });
    if (!g.ok) throw new Error("issue");
    const r = await buy({ giftCode: g.code, method: "card" });
    if (!r.ok) throw new Error(r.error);
    expect(r.needsPayment).toBe(false);
    const o = (await orders.findById(A, r.orderId))!;
    expect(o).toMatchObject({ totalMinor: 0, state: "confirmed", payment: { state: "captured" } });
    expect((await giftCardBalance(A, g.code))!.balanceMinor).toBe(400_000);
  });

  it("two shoppers cannot spend the same gift card twice", async () => {
    const g = await issueGiftCard(A, { amountMinor: 100_000, note: "", expiresAt: "" });
    if (!g.ok) throw new Error("issue");
    const rs = await Promise.all(Array.from({ length: 5 }, () => buy({ giftCode: g.code })));
    const wins = rs.filter((r) => r.ok);
    const spent = (await Promise.all(wins.map(async (r) => (await orders.findById(A, (r as { orderId: string }).orderId))!.rewards?.giftMinor ?? 0))).reduce((a, b) => a + b, 0);
    expect(spent).toBeLessThanOrEqual(100_000);
    expect(await giftCardBalance(A, g.code)).toBeNull();
  });

  it("cancelling gives the balances back exactly once", async () => {
    const g = await issueGiftCard(A, { amountMinor: 40_000, note: "", expiresAt: "" });
    if (!g.ok) throw new Error("issue");
    const r = await buy({ giftCode: g.code });
    if (!r.ok) throw new Error(r.error);
    expect(await giftCardBalance(A, g.code)).toBeNull();
    expect(await transitionOrder(A, r.orderId, "cancelled", actor(), { emails: false, storeName: "S" })).toEqual({ ok: true });
    expect((await giftCardBalance(A, g.code))!.balanceMinor).toBe(40_000);
    const o = (await orders.findById(A, r.orderId))!;
    const { restoreOrderRewards } = await import("./rewards");
    await restoreOrderRewards(A, o); await restoreOrderRewards(A, o);
    expect((await giftCardBalance(A, g.code))!.balanceMinor).toBe(40_000);
  });

  it("store credit and points are used only by their owner and only up to what they have", async () => {
    const id = await customer("credit@example.com");
    expect(await grantCredit(A, id, 25_000, "Apology")).toEqual({ ok: true });
    expect(await grantCredit(A, id, -99_999_999, "")).toMatchObject({ ok: false });
    expect(await grantCredit(A, id, 0, "")).toMatchObject({ ok: false });
    expect(await grantCredit(A, "nobody", 100, "")).toMatchObject({ ok: false });
    const r = await buy({ customerId: id, useCredit: true });
    if (!r.ok) throw new Error(r.error);
    expect((await orders.findById(A, r.orderId))!).toMatchObject({ totalMinor: 75_000, rewards: { creditMinor: 25_000 } });
    expect((await balancesOf(A, id)).creditMinor).toBe(0);
    // guests cannot spend credit, even if they ask
    const g = await buy({ useCredit: true });
    if (!g.ok) throw new Error(g.error);
    expect((await orders.findById(A, g.orderId))!.totalMinor).toBe(100_000);
    // feature off: ignored
    await grantCredit(A, id, 5_000, "x");
    const off = await buy({ customerId: id, useCredit: true }, { credit: false });
    if (!off.ok) throw new Error(off.error);
    expect((await orders.findById(A, off.orderId))!.totalMinor).toBe(100_000);
    expect((await ledgerOf(A, id)).length).toBeGreaterThanOrEqual(2);
  });

  it("earns points when an order completes (once) and lets them be spent", async () => {
    const id = await customer("points@example.com");
    const r = await buy({ customerId: id }, {}, 2); // Rs 2000 = 10 points at 5 per Rs 100
    if (!r.ok) throw new Error(r.error);
    const notify = { emails: false, storeName: "S", rewards: { settings: S, on: { loyalty: true, credit: true, referral: true } } };
    for (const to of ["processing", "ready", "fulfilled", "completed"] as const) expect(await transitionOrder(A, r.orderId, to, actor(), notify)).toEqual({ ok: true });
    expect((await balancesOf(A, id)).points).toBe(100);
    const o = (await orders.findById(A, r.orderId))!;
    const { awardOnCompletion } = await import("./rewards");
    await awardOnCompletion(A, S, { loyalty: true }, o);
    expect((await balancesOf(A, id)).points).toBe(100); // not twice
    const spend = await buy({ customerId: id, usePoints: true });
    if (!spend.ok) throw new Error(spend.error);
    expect((await orders.findById(A, spend.orderId))!).toMatchObject({ totalMinor: 100_000 - 100 * 20, rewards: { points: 100, pointsMinor: 2_000 } });
    expect((await balancesOf(A, id)).points).toBe(0);
  });

  it("gives group members their discount", async () => {
    const id = await customer("vip@example.com");
    await setCustomerGroup(A, id, "vip");
    const r = await buy({ customerId: id });
    if (!r.ok) throw new Error(r.error);
    expect((await orders.findById(A, r.orderId))!).toMatchObject({ discountMinor: 10_000, totalMinor: 90_000, rewards: { groupName: "VIP", groupMinor: 10_000 } });
    const none = await buy({ customerId: id }, { groups: false });
    if (!none.ok) throw new Error(none.error);
    expect((await orders.findById(A, none.orderId))!.totalMinor).toBe(100_000);
    await setCustomerGroup(A, id, "");
    const after = await buy({ customerId: id });
    if (!after.ok) throw new Error(after.error);
    expect((await orders.findById(A, after.orderId))!.totalMinor).toBe(100_000);
  });

  it("rewards both sides of a referral, once, and never your own code", async () => {
    const friend = await customer("friend@example.com");
    const code = await ensureReferralCode(A, friend);
    expect(code).toMatch(/^FRIEND-[0-9A-F]{6}$/);
    expect(await ensureReferralCode(A, friend)).toBe(code);
    await applyReferral(A, S, friend, code); // own code
    expect((await balancesOf(A, friend)).creditMinor).toBe(0);
    const newbie = await customer("newbie@example.com");
    await applyReferral(A, S, newbie, "friend-nonexistent");
    expect((await balancesOf(A, newbie)).creditMinor).toBe(0);
    await applyReferral(A, S, newbie, code.toLowerCase());
    await applyReferral(A, S, newbie, code); // second try does nothing
    expect((await balancesOf(A, newbie)).creditMinor).toBe(20_000);
    const r = await buy({ customerId: newbie });
    if (!r.ok) throw new Error(r.error);
    const notify = { emails: false, storeName: "S", rewards: { settings: S, on: { loyalty: true, credit: true, referral: true } } };
    for (const to of ["processing", "ready", "fulfilled", "completed"] as const) await transitionOrder(A, r.orderId, to, actor(), notify);
    expect((await balancesOf(A, friend)).creditMinor).toBe(20_000);
    const r2 = await buy({ customerId: newbie });
    if (!r2.ok) throw new Error(r2.error);
    for (const to of ["processing", "ready", "fulfilled", "completed"] as const) await transitionOrder(A, r2.orderId, to, actor(), notify);
    expect((await balancesOf(A, friend)).creditMinor).toBe(20_000); // only the first order counts
  });
});
