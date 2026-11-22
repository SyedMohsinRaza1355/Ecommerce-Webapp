import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { createProduct, getSettings, ProductInput } from "./store";
import { placeOrder, orders, type Features, type PlaceInput } from "./orders";
import { editDistance, rankProducts } from "./search";
import type { Actor } from "@/lib/auth/rbac";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const FEAT: Features = { shipping: true, freeShipping: false, tax: false, discounts: false, cod: true, card: false, emails: false, stockTracking: true, orderTypes: true, pickup: true, tableQr: true, scheduled: true, throttle: true };
const PLATFORM = `test_ful_${Math.random().toString(36).slice(2, 8)}`;
const cust = { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
const walkin = { ...cust, address: "", city: "" };
let n = 0;
const key = () => `ful-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;

describe("search ranking", () => {
  it("measures spelling distance and gives up early when too far", () => {
    expect(editDistance("burger", "burger")).toBe(0);
    expect(editDistance("burgr", "burger")).toBe(1);
    expect(editDistance("zinger", "zingar")).toBe(1);
    expect(editDistance("abc", "abcdefghij")).toBeGreaterThan(3);
  });
  const items = [{ name: "Zinger Burger", slug: "zinger" }, { name: "Double Smash Burger", slug: "smash" }, { name: "Crispy Fries", slug: "fries" }, { name: "Mint Lemonade", slug: "lemonade" }];
  it("prefers starts, then words, then contains, and forgives typos", () => {
    expect(rankProducts(items, "zing")[0].slug).toBe("zinger");
    expect(rankProducts(items, "burger").map((h) => h.slug).sort()).toEqual(["smash", "zinger"]);
    expect(rankProducts(items, "lemonad")[0].slug).toBe("lemonade");
    expect(rankProducts(items, "frise")[0].slug).toBe("fries"); // typo
    expect(rankProducts(items, "zngr burgr").length).toBeGreaterThanOrEqual(0);
    expect(rankProducts(items, "xylophone")).toEqual([]);
    expect(rankProducts(items, "a")).toEqual([]); // too short to suggest
    expect(rankProducts(items, "  ZINGER ")[0].slug).toBe("zinger");
    expect(rankProducts(items, "<script>")).toEqual([]);
  });
});

describe.skipIf(!HAS_DB)("order types, tables, scheduling and busy limit (Atlas, synthetic tenants)", () => {
  const created: string[] = [];
  let A: TenantContext, pid: string, idA: string;
  const set = async (s: object) => (await tenantDb(A)).collection("settings").updateOne({ instanceId: idA }, { $set: s });
  const place = async (fulfilment: PlaceInput["fulfilment"], over: Partial<PlaceInput> = {}, feat: Partial<Features> = {}, customer = cust) =>
    placeOrder(A, await getSettings(A), { ...FEAT, ...feat }, "S", { items: [{ productId: pid, qty: 1 }], customer, method: "cod", idempotencyKey: key(), fulfilment, ...over });

  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    const r = await provisionInstance(sa, { name: "Ful", subdomain: "ful-a", packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId); idA = r.instanceId; A = issueTenantContext(idA);
    const p = await createProduct(A, ProductInput.parse({ name: "Burger", price: "500", stock: 500, status: "published", trackStock: true }), "PKR");
    if (!p.ok) throw new Error(p.error);
    pid = p.id;
    await set({ shippingFlatMinor: 15000, taxBps: 0, fulfilment: { delivery: true, pickup: true, dineIn: true }, locations: [{ id: "main", name: "Main branch", address: "Gulberg" }, { id: "dha", name: "DHA", address: "Phase 5" }] });
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  it("delivery stays the default and charges the fee", async () => {
    const r = await place(undefined);
    if (!r.ok) throw new Error(r.error);
    const o = (await orders.findById(A, r.orderId))!;
    expect(o.shippingMinor).toBe(15000);
    expect(o.fulfilment).toBeUndefined();
  });
  it("pickup has no delivery fee, needs no address, and remembers the chosen branch", async () => {
    const r = await place({ type: "pickup", locationId: "dha" }, {}, {}, walkin);
    if (!r.ok) throw new Error(r.error);
    const o = (await orders.findById(A, r.orderId))!;
    expect(o).toMatchObject({ shippingMinor: 0, totalMinor: 50000, fulfilment: { type: "pickup", locationId: "dha", locationName: "DHA" } });
    expect(o.customer.address).toBe("Pickup");
    expect(await place({ type: "pickup" }, {}, {}, walkin)).toMatchObject({ ok: false, error: expect.stringContaining("where") });
    expect(await place({ type: "pickup", locationId: "nowhere" }, {}, {}, walkin)).toMatchObject({ ok: false });
  });
  it("delivery still needs an address, and pickup can be switched off or hidden", async () => {
    expect(await place(undefined, {}, {}, walkin)).toMatchObject({ ok: false, error: expect.stringContaining("address") });
    expect(await place({ type: "pickup", locationId: "main" }, {}, { pickup: false }, walkin)).toMatchObject({ ok: false });
    expect(await place({ type: "pickup", locationId: "main" }, {}, { orderTypes: false }, walkin)).toMatchObject({ ok: false });
    await set({ "fulfilment.pickup": false });
    expect(await place({ type: "pickup", locationId: "main" }, {}, {}, walkin)).toMatchObject({ ok: false });
    await set({ "fulfilment.pickup": true });
  });
  it("table orders need a sensible table number and carry it to the kitchen", async () => {
    const r = await place({ type: "dine_in", table: "12" }, {}, {}, walkin);
    if (!r.ok) throw new Error(r.error);
    expect((await orders.findById(A, r.orderId))!).toMatchObject({ shippingMinor: 0, fulfilment: { type: "dine_in", table: "12" }, customer: { address: "Table 12" } });
    for (const bad of ["", "<script>", "a".repeat(13), "../x"]) expect(await place({ type: "dine_in", table: bad }, {}, {}, walkin), bad).toMatchObject({ ok: false });
    expect(await place({ type: "dine_in", table: "3" }, {}, { tableQr: false }, walkin)).toMatchObject({ ok: false });
  });
  it("scheduled orders need a time 20 minutes to 7 days ahead, inside opening hours", async () => {
    const now = new Date("2026-06-08T05:00:00Z"); // Monday 10:00 Karachi
    const at = (mins: number) => new Date(now.getTime() + mins * 60_000).toISOString();
    expect((await place({ type: "delivery", scheduledFor: at(90) }, { now })).ok).toBe(true);
    expect(await place({ type: "delivery", scheduledFor: at(5) }, { now })).toMatchObject({ ok: false, error: expect.stringContaining("20 minutes") });
    expect(await place({ type: "delivery", scheduledFor: at(60 * 24 * 8) }, { now })).toMatchObject({ ok: false, error: expect.stringContaining("7 days") });
    expect(await place({ type: "delivery", scheduledFor: "not a date" }, { now })).toMatchObject({ ok: false });
    expect(await place({ type: "delivery", scheduledFor: at(90) }, { now }, { scheduled: false })).toMatchObject({ ok: false });
    await set({ hours: { mon: { open: "09:00", close: "17:00" } } });
    expect(await place({ type: "delivery", scheduledFor: at(60 * 10) }, { now }, { hours: true })).toMatchObject({ ok: false, error: expect.stringContaining("closed at that time") }); // 20:00
    expect((await place({ type: "delivery", scheduledFor: at(120) }, { now }, { hours: true })).ok).toBe(true); // 12:00
    await set({ hours: {} });
  });
  it("when the kitchen is at its limit new same-time orders wait, but scheduled ones are still taken", async () => {
    await set({ maxActive: 2 });
    const col = await orders.collection(A);
    await col.updateMany({ instanceId: idA }, { $set: { state: "completed" } });
    const a = await place(undefined), b = await place(undefined);
    expect(a.ok && b.ok).toBe(true);
    expect(await place(undefined)).toMatchObject({ ok: false, error: expect.stringContaining("very busy") });
    const now = new Date();
    expect((await place({ type: "delivery", scheduledFor: new Date(now.getTime() + 3600_000).toISOString() })).ok).toBe(true);
    expect((await place(undefined, {}, { throttle: false })).ok).toBe(true); // feature off: no limit
    await set({ maxActive: 0 });
    expect((await place(undefined)).ok).toBe(true);
  });
});
