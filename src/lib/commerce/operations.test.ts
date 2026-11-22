import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { createProduct, getSettings, products, ProductInput } from "./store";
import { placeOrder, type Features } from "./orders";
import { parseMajor } from "@/lib/money/money";
import { parseTiers, weightSurcharge } from "./weight";
import { saveSupplier, listSuppliers, deleteSupplier, createPurchaseOrder, listPurchaseOrders, setPurchaseOrderStatus, receivePurchaseOrder, bookTable, setBookingStatus, listBookings, validateBookingConfig, slotTimes, bookableDates, localNow, DEFAULT_BOOKING } from "./operations";
import { tenantDb } from "@/lib/tenant/schema";
import type { Actor } from "@/lib/auth/rbac";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const PLATFORM = `test_ops_${Math.random().toString(36).slice(2, 8)}`;
const toMinor = (s: string) => parseMajor(s, "PKR").minor;
let n = 0;
const ip = () => `10.2.${Math.floor(Math.random() * 250)}.${++n % 250}`;

describe("weight steps (pure)", () => {
  it("reads steps, sorts them and rejects nonsense", () => {
    expect(parseTiers("5000 | 150\n1000 | 0", toMinor)).toEqual({ ok: true, tiers: [{ upToGrams: 1000, feeMinor: 0 }, { upToGrams: 5000, feeMinor: 15000 }] });
    for (const bad of ["abc", "0 | 10", "1000", "1000 | x", "1000 | 5\n1000 | 6", "-5 | 1"]) expect(parseTiers(bad, toMinor), bad).toMatchObject({ ok: false });
    expect(parseTiers(Array.from({ length: 13 }, (_, i) => `${i + 1} | 1`).join("\n"), toMinor)).toMatchObject({ ok: false });
  });
  it("charges the first step the order fits in, and the last step beyond it", () => {
    const t = [{ upToGrams: 1000, feeMinor: 0 }, { upToGrams: 5000, feeMinor: 15000 }];
    expect(weightSurcharge(t, 0)).toBe(0);
    expect(weightSurcharge(t, 1000)).toBe(0);
    expect(weightSurcharge(t, 1001)).toBe(15000);
    expect(weightSurcharge(t, 99999)).toBe(15000);
    expect(weightSurcharge(undefined, 500)).toBe(0);
  });
});

describe("booking rules (pure)", () => {
  it("validates the settings", () => {
    expect(validateBookingConfig(DEFAULT_BOOKING)).toBeNull();
    for (const bad of [{ capacity: 0 }, { maxParty: 99 }, { slotMinutes: 20 }, { from: "9:00" }, { to: "11:00" }, { daysAhead: 100 }]) expect(validateBookingConfig({ ...DEFAULT_BOOKING, ...bad }), JSON.stringify(bad)).not.toBeNull();
  });
  it("lists the slots and dates", () => {
    expect(slotTimes({ ...DEFAULT_BOOKING, from: "12:00", to: "14:00", slotMinutes: 60 })).toEqual(["12:00", "13:00", "14:00"]);
    const now = new Date("2026-06-08T05:00:00Z"); // 10:00 in Karachi
    expect(localNow(now)).toEqual({ date: "2026-06-08", minutes: 600 });
    const d = bookableDates({ ...DEFAULT_BOOKING, daysAhead: 3 }, now);
    expect(d).toEqual(["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11"]);
    expect(localNow(new Date("2026-06-08T20:30:00Z")).date).toBe("2026-06-09"); // already tomorrow in Karachi
  });
});

describe.skipIf(!HAS_DB)("suppliers, purchase orders and bookings (Atlas, synthetic tenant)", () => {
  const created: string[] = [];
  let A: TenantContext, pid: string, idA: string;

  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    const r = await provisionInstance(sa, { name: "Ops", subdomain: "ops-a", packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId); idA = r.instanceId; A = issueTenantContext(idA);
    const p = await createProduct(A, ProductInput.parse({ name: "Burger", price: "500", stock: 100, status: "published", trackStock: true, sku: "BRG-1", weight: "400" }), "PKR");
    if (!p.ok) throw new Error(p.error);
    pid = p.id;
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  it("adds weight-based delivery fees at checkout", async () => {
    await (await tenantDb(A)).collection("settings").updateOne({ instanceId: idA }, { $set: { shippingFlatMinor: 10000, taxBps: 0, weightTiers: [{ upToGrams: 1000, feeMinor: 0 }, { upToGrams: 3000, feeMinor: 5000 }] } });
    const S = await getSettings(A);
    const feat: Features = { shipping: true, freeShipping: false, tax: false, discounts: false, cod: true, card: false, emails: false, stockTracking: true, weight: true };
    const cust = { name: "Ayesha Khan", email: "a@example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
    const go = (qty: number, f: Features = feat) => placeOrder(A, S, f, "S", { items: [{ productId: pid, qty }], customer: cust, method: "cod", idempotencyKey: `w-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}` });
    const ship = async (r: Awaited<ReturnType<typeof go>>) => { if (!r.ok) throw new Error(r.error); return (await (await tenantDb(A)).collection("orders").findOne({ _id: r.orderId as never }))!.shippingMinor as number; };
    expect(await ship(await go(2))).toBe(10000); // 800 g: first step, no extra
    expect(await ship(await go(5))).toBe(15000); // 2000 g
    expect(await ship(await go(9))).toBe(15000); // 3600 g: beyond the last step pays the last fee
    expect(await ship(await go(5, { ...feat, weight: false }))).toBe(10000); // feature off
  });

  it("keeps suppliers and checks their details", async () => {
    expect(await saveSupplier(A, { name: "A", phone: "", email: "", note: "" })).toMatchObject({ ok: false });
    expect(await saveSupplier(A, { name: "Fresh Meats", phone: "", email: "bad", note: "" })).toMatchObject({ ok: false });
    expect(await saveSupplier(A, { name: "Fresh Meats", phone: "0300 1111111", email: "meat@example.com", note: "Mon and Thu" })).toEqual({ ok: true });
    expect(await listSuppliers(A)).toHaveLength(1);
  });

  it("makes a purchase order, and receiving adds stock exactly once", async () => {
    const sup = (await listSuppliers(A))[0];
    expect(await createPurchaseOrder(A, { supplierId: "nope", text: "BRG-1 x 5 @ 300", note: "" }, toMinor)).toMatchObject({ ok: false });
    for (const bad of ["", "BRG-1", "BRG-1 x 0 @ 300", "NOPE x 5 @ 300", "BRG-1 x 5 @ abc", ".* x 5 @ 300"]) expect(await createPurchaseOrder(A, { supplierId: sup._id, text: bad, note: "" }, toMinor), bad).toMatchObject({ ok: false });
    const r = await createPurchaseOrder(A, { supplierId: sup._id, text: "brg-1 x 20 @ 300.50", note: "" }, toMinor);
    expect(r).toMatchObject({ ok: true, no: 1 });
    const po = (await listPurchaseOrders(A))[0];
    expect(po).toMatchObject({ status: "draft", totalMinor: 20 * 30050 });
    expect(await receivePurchaseOrder(A, po._id)).toMatchObject({ ok: false }); // not ordered yet
    expect(await setPurchaseOrderStatus(A, po._id, "ordered")).toEqual({ ok: true });
    expect(await setPurchaseOrderStatus(A, po._id, "ordered")).toMatchObject({ ok: false });
    expect(await deleteSupplier(A, sup._id)).toMatchObject({ ok: false }); // open order
    const before = (await products.findById(A, pid))!.stock;
    const both = await Promise.all([receivePurchaseOrder(A, po._id), receivePurchaseOrder(A, po._id)]);
    expect(both.filter((x) => x.ok)).toHaveLength(1);
    expect((await products.findById(A, pid))!.stock).toBe(before + 20);
    expect(await setPurchaseOrderStatus(A, po._id, "cancelled")).toMatchObject({ ok: false });
    expect(await deleteSupplier(A, sup._id)).toEqual({ ok: true });
  });

  it("never books more tables than a slot has, and cancelling frees one", async () => {
    const cfg = { ...DEFAULT_BOOKING, capacity: 2, from: "12:00", to: "20:00", slotMinutes: 60, daysAhead: 7 };
    const now = new Date("2026-06-08T05:00:00Z"); // 10:00 Karachi
    const owner = { email: null, storeName: "S" };
    const ask = (over: Partial<Parameters<typeof bookTable>[2]> = {}) => bookTable(A, cfg, { date: "2026-06-10", time: "19:00", party: "4", name: "Bilal", email: "b@example.com", phone: "0300 1234567", note: "", ...over }, ip(), owner, now);
    const results = await Promise.all(Array.from({ length: 5 }, () => ask()));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: expect.stringContaining("fully booked") });
    const first = (await listBookings(A, "2026-06-10"))[0];
    expect(await setBookingStatus(A, first._id, "cancelled", "S")).toEqual({ ok: true });
    expect(await setBookingStatus(A, first._id, "cancelled", "S")).toMatchObject({ ok: false });
    expect((await ask({ name: "Late comer" })).ok).toBe(true);
    expect(await ask({ name: "One too many" })).toMatchObject({ ok: false });
  });

  it("checks every booking field", async () => {
    const cfg = { ...DEFAULT_BOOKING, from: "12:00", to: "20:00", slotMinutes: 60, daysAhead: 7, maxParty: 6 };
    const now = new Date("2026-06-08T05:00:00Z");
    const ask = (over: object) => bookTable(A, cfg, { date: "2026-06-09", time: "13:00", party: "2", name: "Bilal", email: "b@example.com", phone: "0300 1234567", note: "", ...over }, ip(), { email: null, storeName: "S" }, now);
    for (const bad of [{ name: "B" }, { email: "nope" }, { phone: "1" }, { party: "0" }, { party: "7" }, { party: "1.5" }, { date: "2026-06-07" }, { date: "2026-07-30" }, { date: "tomorrow" }, { time: "13:30" }, { time: "08:00" }, { date: "2026-06-08", time: "10:30" }]) expect(await ask(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    expect((await ask({ date: "2026-06-08", time: "12:00" })).ok).toBe(true); // 2 hours ahead is fine
    expect(await ask({ honeypot: "x", name: "" })).toEqual({ ok: true, id: "" }); // bots are told it worked, nothing stored
  });
});
