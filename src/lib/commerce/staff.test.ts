import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { getClient, closeClient, platformDb } from "@/lib/db/client";
import { provisionInstance, STAFF_INVITE_TTL_MS, INVITE_TTL_MS } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { users, inviteStaff, changeStaff, requestStaffReset, completeStaffReset, authenticateStaff } from "./staff";
import { createProduct, getSettings, ProductInput, products } from "./store";
import { placeStaffOrder, orders, refundOrder, type Features } from "./orders";
import { customerReport, productReport } from "./extras";
import { savePromo } from "./rules";
import type { Actor } from "@/lib/auth/rbac";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const PLATFORM = `test_staff_${Math.random().toString(36).slice(2, 8)}`;
const FEAT: Features = { shipping: true, freeShipping: false, tax: true, discounts: true, cod: true, card: false, emails: false, stockTracking: true };
let n = 0;
const key = () => `pos-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!HAS_DB)("staff accounts and the cashier till (Atlas, synthetic tenants)", () => {
  const created: string[] = [];
  let A: TenantContext, B: TenantContext, idA: string, owner: Actor, ownerB: Actor;
  const actor = (role: Actor["role"], userId = `u-${role}`, ctx = A): Actor => ({ userId, role, instanceId: ctx.instanceId });

  async function make(sub: string) {
    const r = await provisionInstance(sa, { name: `Store ${sub}`, subdomain: sub, packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId);
    return { ctx: issueTenantContext(r.instanceId), id: r.instanceId };
  }
  async function addUser(ctx: TenantContext, email: string, role: "store_owner" | "manager" | "cashier" | "kitchen_ops", extra: object = {}) {
    const id = randomUUID();
    await users.insert(ctx, { _id: id, email, passwordHash: await hashPassword("Old-Password-123"), role, createdAt: new Date(), ...extra } as never);
    return id;
  }
  const linkFor = async (ctx: TenantContext, to: string, type: string) => {
    const m = await (await tenantDb(ctx)).collection("emails").find({ to, type }).sort({ sentAt: -1 }).limit(1).next();
    return /\/(?:reset|invite)\/([A-Za-z0-9_-]{20,})/.exec(String(m?.body))?.[1] ?? "";
  };

  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    process.env.SESSION_SECRET ||= "y".repeat(40);
    const a = await make("staff-a"), b = await make("staff-b");
    A = a.ctx; idA = a.id; B = b.ctx;
    owner = actor("store_owner", await addUser(A, "owner@a.test", "store_owner"));
    ownerB = actor("store_owner", await addUser(B, "owner@b.test", "store_owner"), B);
    await (await tenantDb(A)).collection("settings").updateOne({ instanceId: idA }, { $set: { taxBps: 1000, shippingFlatMinor: 5000, "branding.storeName": "Burger Hut" } });
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  describe("invitations", () => {
    it("staff invites last 24 hours and are emailed; owner setup links stay at 1 hour", async () => {
      expect(STAFF_INVITE_TTL_MS).toBe(24 * 60 * 60 * 1000);
      expect(INVITE_TTL_MS).toBe(60 * 60 * 1000);
      const r = await inviteStaff(A, owner, "newcook@a.test", "kitchen_ops", 10, "Burger Hut");
      if (!r.ok) throw new Error(r.error);
      const left = r.expiresAt!.getTime() - Date.now();
      expect(left).toBeGreaterThan(23.9 * 3600_000);
      expect(left).toBeLessThanOrEqual(24 * 3600_000);
      const mail = await (await tenantDb(A)).collection("emails").findOne({ to: "newcook@a.test", type: "staff.invite" });
      expect(mail?.body).toContain(`/invite/${r.token}`);
      expect(mail?.subject).toContain("Burger Hut");
    });
    it("only the owner can invite, and a duplicate is refused", async () => {
      expect(await inviteStaff(A, actor("manager"), "x@a.test", "cashier", 10)).toMatchObject({ ok: false });
      expect(await inviteStaff(A, actor("cashier"), "x@a.test", "cashier", 10)).toMatchObject({ ok: false });
      expect(await inviteStaff(A, owner, "owner@a.test", "cashier", 10)).toMatchObject({ ok: false });
      expect(await inviteStaff(A, owner, "x@a.test", "store_owner", 10)).toMatchObject({ ok: false });
    });
  });

  describe("forgot password for staff", () => {
    let uid = "";
    beforeAll(async () => { uid = await addUser(A, "cashier@a.test", "cashier", { totp: { secret: "AAAAAAAAAAAAAAAA", enabled: true, lastStep: -1 } }); });

    it("a known address gets a one-time link, an unknown one gets nothing and no error", async () => {
      const db = await tenantDb(A);
      await requestStaffReset(A, "nobody@a.test", "Burger Hut", "1.1.1.1");
      await requestStaffReset(A, "not-an-email", "Burger Hut", "1.1.1.1");
      expect(await db.collection("outbox").countDocuments({ to: "nobody@a.test" })).toBe(0);
      await requestStaffReset(A, " Cashier@A.test ", "Burger Hut", "1.1.1.2");
      expect(await linkFor(A, "cashier@a.test", "staff.reset")).toHaveLength(43);
    });
    it("the link sets a new password once, signs out old sessions, and keeps two-step on", async () => {
      const tok = await linkFor(A, "cashier@a.test", "staff.reset");
      expect(await completeStaffReset(A, tok, "weak")).toMatchObject({ ok: false });
      const tok2 = await (async () => { await requestStaffReset(A, "cashier@a.test", "Burger Hut", "1.1.1.3"); return linkFor(A, "cashier@a.test", "staff.reset"); })();
      expect(await completeStaffReset(A, tok2, "Brand-New-Pass-77")).toEqual({ ok: true });
      expect(await completeStaffReset(A, tok2, "Another-Pass-88")).toMatchObject({ ok: false, error: expect.stringContaining("expired") }); // single use
      const u = (await users.findById(A, uid))!;
      expect(await verifyPassword("Brand-New-Pass-77", u.passwordHash)).toBe(true);
      expect(await verifyPassword("Old-Password-123", u.passwordHash)).toBe(false);
      expect(u.sessionsValidAfter).toBeInstanceOf(Date);
      expect(u.totp?.enabled).toBe(true); // a reset never bypasses the authenticator
      expect(await authenticateStaff(A, "cashier@a.test", "Brand-New-Pass-77", undefined, "2.2.2.2")).toMatchObject({ ok: false, reason: "code_required" });
    });
    it("expired, malformed, foreign and disabled-account tokens do nothing", async () => {
      await requestStaffReset(A, "cashier@a.test", "Burger Hut", "1.1.1.4");
      const tok = await linkFor(A, "cashier@a.test", "staff.reset");
      expect(await completeStaffReset(B, tok, "Brand-New-Pass-77")).toMatchObject({ ok: false }); // another store
      await (await tenantDb(A)).collection("staff_tokens").updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await completeStaffReset(A, tok, "Brand-New-Pass-77")).toMatchObject({ ok: false });
      for (const junk of ["", "short", "../../x", "a".repeat(200), "%00"]) expect(await completeStaffReset(A, junk, "Brand-New-Pass-77"), junk).toMatchObject({ ok: false });
      await users.updateById(A, uid, { disabled: true } as never);
      const before = await (await tenantDb(A)).collection("outbox").countDocuments({ to: "cashier@a.test", type: "staff.reset" });
      await requestStaffReset(A, "cashier@a.test", "Burger Hut", "1.1.1.5");
      expect(await (await tenantDb(A)).collection("outbox").countDocuments({ to: "cashier@a.test", type: "staff.reset" })).toBe(before); // disabled people get no link
      await users.updateById(A, uid, { disabled: false } as never);
    });
    it("is rate limited per address and per connection", async () => {
      const db = await tenantDb(A);
      const before = await db.collection("outbox").countDocuments({ to: "cashier@a.test", type: "staff.reset" });
      for (let i = 0; i < 8; i++) await requestStaffReset(A, "cashier@a.test", "Burger Hut", "9.9.9.9");
      const sent = (await db.collection("outbox").countDocuments({ to: "cashier@a.test", type: "staff.reset" })) - before;
      expect(sent).toBeLessThanOrEqual(3);
    });
    it("the owner can clear a lost authenticator; managers cannot; the owner account is protected", async () => {
      expect(await changeStaff(A, actor("manager"), uid, { resetTwoFactor: true })).toMatchObject({ ok: false });
      expect(await changeStaff(A, owner, owner.userId, { resetTwoFactor: true })).toMatchObject({ ok: false });
      expect(await changeStaff(B, ownerB, uid, { resetTwoFactor: true })).toMatchObject({ ok: false }); // not their store
      expect(await changeStaff(A, owner, uid, { resetTwoFactor: true })).toEqual({ ok: true });
      const u = (await users.findById(A, uid))!;
      expect(u.totp).toBeUndefined();
      expect(u.sessionsValidAfter).toBeInstanceOf(Date);
    });
  });

  describe("cashier till", () => {
    let burger: string, soda: string, rare: string;
    const mk = async (name: string, price: string, stock: number) => {
      const r = await createProduct(A, ProductInput.parse({ name, price, stock, status: "published", trackStock: true }), "PKR");
      if (!r.ok) throw new Error(r.error);
      return r.id;
    };
    const sell = async (items: { productId: string; qty: number }[], over: object = {}, by = actor("cashier"), feat: Partial<Features> = {}) =>
      placeStaffOrder(A, await getSettings(A), { ...FEAT, ...feat }, by, { items, tender: "cash", idempotencyKey: key(), ...over } as never);
    beforeAll(async () => { burger = await mk("Burger", "500", 100); soda = await mk("Soda", "100", 100); rare = await mk("Rare", "50", 3); });

    it("a cash sale is paid and completed on the spot, with tax, change and a stock decrease", async () => {
      const before = (await products.findById(A, burger))!.stock;
      const r = await sell([{ productId: burger, qty: 2 }, { productId: soda, qty: 1 }], { receivedMinor: 150000, customerName: " Table 4 " });
      if (!r.ok) throw new Error(r.error);
      expect(r.totalMinor).toBe(121000); // 1100.00 + 10% tax, no delivery fee at the counter
      expect(r.changeMinor).toBe(29000);
      const o = (await orders.findById(A, r.orderId))!;
      expect(o).toMatchObject({ state: "completed", source: "pos", cashierId: "u-cashier", shippingMinor: 0, customer: { name: "Table 4", address: "In store" }, payment: { method: "pos", state: "captured", pos: { tender: "cash", receivedMinor: 150000, changeMinor: 29000 } } });
      expect(o.history.map((h) => h.to)).toEqual(["completed", "captured"]);
      expect((await products.findById(A, burger))!.stock).toBe(before - 2);
    });
    it("refuses too little cash, bad tenders, empty sales, bad quantities and unknown products", async () => {
      expect(await sell([{ productId: soda, qty: 1 }], { receivedMinor: 100 })).toMatchObject({ ok: false, error: expect.stringContaining("less than") });
      expect(await sell([{ productId: soda, qty: 1 }], { tender: "bitcoin" })).toMatchObject({ ok: false });
      expect(await sell([])).toMatchObject({ ok: false });
      for (const qty of [0, -1, 1.5, 100, NaN]) expect(await sell([{ productId: soda, qty }]), String(qty)).toMatchObject({ ok: false });
      expect(await sell([{ productId: "nope", qty: 1 }])).toMatchObject({ ok: false });
      expect(await sell([{ productId: soda, qty: 1 }], { idempotencyKey: "short" })).toMatchObject({ ok: false });
    });
    it("card and wallet sales take exactly the total; only cash gives change", async () => {
      const r = await sell([{ productId: soda, qty: 1 }], { tender: "card", receivedMinor: 999999 });
      if (!r.ok) throw new Error(r.error);
      expect(r.changeMinor).toBe(0);
      expect((await orders.findById(A, r.orderId))!.payment.pos).toEqual({ tender: "card" });
    });
    it("only sales staff may sell: kitchen and customers cannot", async () => {
      expect(await sell([{ productId: soda, qty: 1 }], {}, actor("kitchen_ops"))).toMatchObject({ ok: false });
      expect(await sell([{ productId: soda, qty: 1 }], {}, actor("customer"))).toMatchObject({ ok: false });
      for (const r of ["cashier", "manager", "store_owner"] as const) expect((await sell([{ productId: soda, qty: 1 }], {}, actor(r))).ok, r).toBe(true);
    });
    it("a discount at the till is for managers and owners only, and is capped", async () => {
      expect(await sell([{ productId: burger, qty: 1 }], { discountPercent: 10 }, actor("cashier"))).toMatchObject({ ok: false, error: expect.stringContaining("manager") });
      const r = await sell([{ productId: burger, qty: 1 }], { discountPercent: 20 }, actor("manager"));
      if (!r.ok) throw new Error(r.error);
      expect(r.totalMinor).toBe(44000); // 500 - 20% = 400, plus 10% tax
      for (const bad of [-5, 101, NaN]) expect(await sell([{ productId: burger, qty: 1 }], { discountPercent: bad }, actor("manager")), String(bad)).toMatchObject({ ok: false });
    });
    it("automatic promotions apply at the till too, and the larger of promotion and manual discount wins", async () => {
      await savePromo(A, { name: "Lunch deal", kind: "flash", percent: "30", min: "", categoryId: "", startsAt: "", endsAt: new Date(Date.now() + 3600_000).toISOString() }, "PKR");
      const p = await sell([{ productId: burger, qty: 1 }], {}, actor("cashier"), { flashSales: true });
      if (!p.ok) throw new Error(p.error);
      expect(await orders.findById(A, p.orderId)).toMatchObject({ discountMinor: 15000, promo: { name: "Lunch deal" } });
      const m = await sell([{ productId: burger, qty: 1 }], { discountPercent: 50 }, actor("manager"), { flashSales: true });
      if (!m.ok) throw new Error(m.error);
      const o = (await orders.findById(A, m.orderId))!;
      expect(o.discountMinor).toBe(25000);
      expect(o.promo).toBeUndefined();
    });
    it("CONCURRENCY: ten tills fight for 3 items: exactly 3 sales succeed", async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => sell([{ productId: rare, qty: 1 }])));
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      expect((await products.findById(A, rare))!.stock).toBe(0);
    });
    it("a double tap with the same key makes one sale", async () => {
      const k = key();
      const before = (await products.findById(A, soda))!.stock;
      const rs = await Promise.all([1, 2, 3].map(() => sell([{ productId: soda, qty: 1 }], { idempotencyKey: k })));
      expect(new Set(rs.map((r) => (r.ok ? r.orderId : "x"))).size).toBe(1);
      expect((await products.findById(A, soda))!.stock).toBe(before - 1);
    });
    it("counter sales show up in product reports, not as a fake customer, and can be refunded", async () => {
      const from = new Date(Date.now() - 3600_000), to = new Date(Date.now() + 3600_000);
      expect((await productReport(A, from, to)).find((p) => p.name === "Burger")!.qty).toBeGreaterThan(2);
      expect((await customerReport(A, from, to)).some((c) => c._id === "")).toBe(false);
      const r = await sell([{ productId: soda, qty: 1 }]);
      if (!r.ok) throw new Error(r.error);
      expect(await refundOrder(A, r.orderId, 5000, owner, "refund-pos-0001", { emails: false, storeName: "S" })).toEqual({ ok: true });
      expect((await orders.findById(A, r.orderId))!.payment.state).toBe("partially_refunded");
    });
    it("another store's product cannot be sold", async () => {
      const r = await createProduct(B, ProductInput.parse({ name: "B item", price: "10", stock: 5, status: "published", trackStock: true }), "PKR");
      if (!r.ok) throw new Error(r.error);
      expect(await sell([{ productId: r.id, qty: 1 }])).toMatchObject({ ok: false });
      expect((await platformDb()).collection("instances")).toBeTruthy();
    });
  });
});
