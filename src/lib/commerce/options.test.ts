import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { createProduct, getSettings, ProductInput, products, updateProduct, categories } from "./store";
import { placeOrder, orders, transitionOrder, type Features } from "./orders";
import { cartView, setCartQty, newCartId } from "./cart";
import { parseOptions, serializeOptions, resolveSelection, variantLimit, parseAttributes, parseBundle, availableNow, validateAvailability, describeAvailability, hasRequiredOptions } from "./options";
import type { Actor } from "@/lib/auth/rbac";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const FEAT: Features = { shipping: false, freeShipping: false, tax: false, discounts: false, cod: true, card: false, emails: false, stockTracking: true };
const PLATFORM = `test_opt_${Math.random().toString(36).slice(2, 8)}`;
const cust = { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
let n = 0;
const key = () => `opt-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;

const parsed = (t: string) => { const r = parseOptions(t, 2); if (!r.ok) throw new Error(r.error); return r.groups; };

describe("option text format", () => {
  it("reads variants, modifiers, flags, prices and stock", () => {
    const g = parsed("variant Size! : Small stock 10; Large +50 stock 3\nmodifier Extras* max 2 : Cheese +30; Bacon +60.5; Plain");
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ kind: "variant", name: "Size", required: true, multi: false });
    expect(g[0].choices.map((c) => [c.label, c.priceDeltaMinor, c.stock])).toEqual([["Small", 0, 10], ["Large", 5000, 3]]);
    expect(g[1]).toMatchObject({ kind: "modifier", multi: true, max: 2, required: false });
    expect(g[1].choices.map((c) => c.priceDeltaMinor)).toEqual([3000, 6050, 0]);
    expect(g[1].choices.every((c) => c.stock === undefined)).toBe(true); // extras do not carry stock
  });
  it("gives clear errors and enforces limits", () => {
    for (const bad of ["Size : Small", "variant : Small", "variant Size : ", "variant Size* : A; B", "modifier X max 99 : A", "variant " + "N".repeat(41) + " : A", "variant A : " + Array.from({ length: 31 }, (_, i) => "C" + i).join(";"), Array.from({ length: 7 }, (_, i) => `modifier G${i} : A`).join("\n"), "modifier X : A +99999999999"]) {
      expect(parseOptions(bad, 2), bad).toMatchObject({ ok: false });
    }
    expect(parseOptions("", 2)).toEqual({ ok: true, groups: [] });
  });
  it("gives every group and choice a unique id even when names repeat", () => {
    const g = parsed("modifier Extra : A; A\nmodifier Extra : A");
    const ids = [...g.map((x) => x.id), ...g.flatMap((x) => x.choices.map((c) => c.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("round-trips through the editor text", () => {
    const src = "variant Size! : Small stock 10; Large +50 stock 3\nmodifier Extras!* max 2 : Cheese +30; Bacon +60.5";
    const g = parsed(src);
    expect(parsed(serializeOptions(g, 2)).map((x) => x.choices.map((c) => [c.label, c.priceDeltaMinor, c.stock]))).toEqual(g.map((x) => x.choices.map((c) => [c.label, c.priceDeltaMinor, c.stock])));
  });
});

describe("choosing options", () => {
  const p = { name: "Burger", priceMinor: 50000, options: parsed("variant Size! : Small; Large +100\nmodifier Drink! : Cola; Water\nmodifier Extras* max 2 : Cheese +30; Bacon +60; Egg +20") };
  const id = (g: string, label: string) => p.options.find((x) => x.name === g)!.choices.find((c) => c.label === label)!.id;
  it("prices the choice and requires required groups", () => {
    const r = resolveSelection(p, [id("Size", "Large"), id("Drink", "Cola"), id("Extras", "Cheese")]);
    expect(r).toMatchObject({ ok: true, unitMinor: 50000 + 10000 + 3000 });
    if (r.ok) expect(r.label).toBe("Large, Cola, Cheese");
    expect(resolveSelection(p, [id("Size", "Small")])).toMatchObject({ ok: false, error: expect.stringContaining("Drink") });
    expect(resolveSelection(p, [])).toMatchObject({ ok: false });
  });
  it("one choice for single groups, a cap for multi groups, no strangers, no duplicates", () => {
    const base = [id("Size", "Small"), id("Drink", "Water")];
    expect(resolveSelection(p, [...base, id("Size", "Large")])).toMatchObject({ ok: false, error: expect.stringContaining("only one") });
    expect(resolveSelection(p, [...base, id("Extras", "Cheese"), id("Extras", "Bacon"), id("Extras", "Egg")])).toMatchObject({ ok: false, error: expect.stringContaining("at most 2") });
    expect(resolveSelection(p, [...base, "size-hacked"])).toMatchObject({ ok: false });
    const dup = resolveSelection(p, [...base, id("Extras", "Egg"), id("Extras", "Egg")]);
    expect(dup).toMatchObject({ ok: true, unitMinor: 50000 + 2000 }); // counted once
    expect(hasRequiredOptions(p)).toBe(true);
    expect(hasRequiredOptions({ options: parsed("modifier X : A") })).toBe(false);
  });
  it("a price can never go below zero and variant stock limits the quantity", () => {
    const cheap = { name: "X", priceMinor: 100, options: parsed("modifier Off! : Big -5") };
    expect(resolveSelection(cheap, [cheap.options[0].choices[0].id])).toMatchObject({ ok: false });
    const v = { options: parsed("variant Size! : S stock 4; L stock 2") };
    expect(variantLimit(v, [v.options[0].choices[1].id])).toBe(2);
    expect(variantLimit(v, [])).toBeNull();
  });
});

describe("details, bundles and time windows", () => {
  it("parses details and bundle lines strictly", () => {
    expect(parseAttributes("Material: Cotton\nOrigin: Pakistan: Lahore")).toEqual({ ok: true, attrs: [{ name: "Material", value: "Cotton" }, { name: "Origin", value: "Pakistan: Lahore" }] });
    for (const bad of ["no colon", ": value", "Name:", "N".repeat(41) + ": v", Array.from({ length: 21 }, (_, i) => `K${i}: v`).join("\n")]) expect(parseAttributes(bad), bad).toMatchObject({ ok: false });
    expect(parseBundle("2 x abc12345\n1x def67890")).toEqual({ ok: true, parts: [{ productId: "abc12345", qty: 2 }, { productId: "def67890", qty: 1 }] });
    for (const bad of ["x abc", "0 x ../../etc", "2 x ab", "2 of abc12345"]) expect(parseBundle(bad), bad).toMatchObject({ ok: false });
  });
  it("opening windows work in the store's timezone, overnight, and for chosen days", () => {
    const lunch = { days: ["mon" as const, "tue" as const], from: "11:00", to: "15:00" };
    expect(availableNow(lunch, new Date("2026-06-08T07:00:00Z"), "Asia/Karachi")).toBe(true); // Monday 12:00
    expect(availableNow(lunch, new Date("2026-06-08T11:00:00Z"), "Asia/Karachi")).toBe(false); // 16:00
    expect(availableNow(lunch, new Date("2026-06-10T07:00:00Z"), "Asia/Karachi")).toBe(false); // Wednesday
    expect(availableNow({ from: "22:00", to: "02:00" }, new Date("2026-06-08T18:30:00Z"), "Asia/Karachi")).toBe(true); // 23:30
    expect(availableNow({ from: "22:00", to: "02:00" }, new Date("2026-06-08T07:00:00Z"), "Asia/Karachi")).toBe(false);
    expect(availableNow(undefined)).toBe(true);
    expect(availableNow({}, new Date())).toBe(true);
    expect(validateAvailability({ from: "11:00" })).toMatch(/both/);
    expect(validateAvailability({ from: "25:00", to: "26:00" })).toMatch(/times/);
    expect(describeAvailability(lunch)).toBe("Mon, Tue, 11:00 to 15:00");
  });
});

describe.skipIf(!HAS_DB)("variants, extras, combos and windows in real orders (Atlas, synthetic tenants)", () => {
  const created: string[] = [];
  let A: TenantContext, B: TenantContext;
  const make = async (sub: string) => {
    const r = await provisionInstance(sa, { name: `Store ${sub}`, subdomain: sub, packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId);
    return issueTenantContext(r.instanceId);
  };
  const mk = async (ctx: TenantContext, name: string, price: string, stock: number, extra: Record<string, unknown> = {}) => {
    const r = await createProduct(ctx, ProductInput.parse({ name, price, stock, status: "published", trackStock: true, ...extra }), "PKR");
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };
  const choice = async (pid: string, label: string) => (await products.findById(A, pid))!.options!.flatMap((g) => g.choices).find((c) => c.label === label)!.id;
  const place = async (items: { productId: string; qty: number; sel?: string[] }[], over: object = {}, ctx = A) =>
    placeOrder(ctx, await getSettings(ctx), FEAT, "S", { items, customer: cust, method: "cod", idempotencyKey: key(), ...over });
  const stockOfChoice = async (pid: string, label: string) => (await products.findById(A, pid))!.options!.flatMap((g) => g.choices).find((c) => c.label === label)!.stock;

  beforeAll(async () => { process.env.PLATFORM_DB_NAME = PLATFORM; A = await make("opt-a"); B = await make("opt-b"); });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  it("saves options on a product and refuses bad ones with a message", async () => {
    const bad = await createProduct(A, ProductInput.parse({ name: "Bad", price: "10", stock: 1, status: "draft", optionsText: "nonsense" }), "PKR");
    expect(bad).toMatchObject({ ok: false });
    const bad2 = await createProduct(A, ProductInput.parse({ name: "Bad2", price: "10", stock: 1, status: "draft", galleryText: "javascript:alert(1)" }), "PKR");
    expect(bad2).toMatchObject({ ok: false });
    const bad3 = await createProduct(A, ProductInput.parse({ name: "Bad3", price: "10", stock: 1, status: "draft", availFrom: "10:00" }), "PKR");
    expect(bad3).toMatchObject({ ok: false });
    const id = await mk(A, "Tee", "1000", 0, { optionsText: "variant Size! : S stock 5; L +100 stock 2", attributesText: "Material: Cotton", galleryText: "https://img.example/a.jpg", sku: "TEE-1" });
    const p = (await products.findById(A, id))!;
    expect(p.options![0].choices).toHaveLength(2);
    expect(p.attributes).toEqual([{ name: "Material", value: "Cotton" }]);
    expect(p.gallery).toEqual(["https://img.example/a.jpg"]);
    expect(p.sku).toBe("TEE-1");
    expect(await updateProduct(A, id, ProductInput.parse({ name: "Tee", price: "1000", stock: 0, status: "published", optionsText: "variant Size! : S stock 5" }), "PKR")).toEqual({ ok: true });
    expect((await products.findById(A, id))!.options![0].choices).toHaveLength(1);
  });

  it("each size has its own stock and price; extras change the total; names show the choices", async () => {
    const id = await mk(A, "Shirt", "1000", 0, { optionsText: "variant Size! : S stock 5; L +100 stock 2\nmodifier Gift wrap : Yes +50" });
    const L = await choice(id, "L"), wrap = await choice(id, "Yes");
    const r = await place([{ productId: id, qty: 2, sel: [L, wrap] }]);
    if (!r.ok) throw new Error(r.error);
    const o = (await orders.findById(A, r.orderId))!;
    expect(o.items[0]).toMatchObject({ name: "Shirt (L, Yes)", unitMinor: 115000 / 1 - 0 === 115000 ? 115000 : 0, qty: 2 });
    expect(o.totalMinor).toBe(2 * 115000);
    expect(await stockOfChoice(id, "L")).toBe(0);
    expect(await stockOfChoice(id, "S")).toBe(5); // other sizes untouched
    expect(await place([{ productId: id, qty: 1, sel: [L] }])).toMatchObject({ ok: false, error: expect.stringContaining("left") });
    expect(await place([{ productId: id, qty: 1 }])).toMatchObject({ ok: false, error: expect.stringContaining("Size") }); // size is required
  });

  it("CONCURRENCY: 12 buyers fight for 3 of one size: exactly 3 win and stock never goes negative", async () => {
    const id = await mk(A, "Hoodie", "2000", 0, { optionsText: "variant Size! : M stock 3" });
    const M = await choice(id, "M");
    const rs = await Promise.all(Array.from({ length: 12 }, () => place([{ productId: id, qty: 1, sel: [M] }])));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);
    expect(await stockOfChoice(id, "M")).toBe(0);
  });

  it("cancelling gives back exactly the right size, once", async () => {
    const id = await mk(A, "Cap", "500", 0, { optionsText: "variant Colour! : Red stock 4; Blue stock 4" });
    const red = await choice(id, "Red");
    const r = await place([{ productId: id, qty: 3, sel: [red] }]);
    if (!r.ok) throw new Error(r.error);
    expect(await stockOfChoice(id, "Red")).toBe(1);
    const owner = { userId: "u", role: "store_owner" };
    expect(await transitionOrder(A, r.orderId, "cancelled", owner, { emails: false, storeName: "S" })).toEqual({ ok: true });
    expect(await stockOfChoice(id, "Red")).toBe(4);
    expect(await stockOfChoice(id, "Blue")).toBe(4);
    await transitionOrder(A, r.orderId, "cancelled", owner, { emails: false, storeName: "S" });
    expect(await stockOfChoice(id, "Red")).toBe(4); // not twice
  });

  it("a combo takes stock from its parts, sells only as many as the parts allow, and returns them on cancel", async () => {
    const burger = await mk(A, "Combo burger", "400", 5), fries = await mk(A, "Combo fries", "150", 3), drink = await mk(A, "Combo drink", "100", 100);
    const combo = await mk(A, "Meal deal", "600", 0, { bundleText: `1 x ${burger}\n1 x ${fries}\n2 x ${drink}`, trackStock: false });
    const cartId = newCartId();
    expect(await setCartQty(A, cartId, combo, 9, "set")).toMatchObject({ ok: true, error: expect.stringContaining("Only 3") }); // fries limit it
    const r = await place([{ productId: combo, qty: 2 }]);
    if (!r.ok) throw new Error(r.error);
    expect((await products.findById(A, burger))!.stock).toBe(3);
    expect((await products.findById(A, fries))!.stock).toBe(1);
    expect((await products.findById(A, drink))!.stock).toBe(96);
    expect(await place([{ productId: combo, qty: 2 }])).toMatchObject({ ok: false, error: expect.stringContaining("Not enough") });
    await transitionOrder(A, r.orderId, "cancelled", { userId: "u", role: "store_owner" }, { emails: false, storeName: "S" });
    expect((await products.findById(A, burger))!.stock).toBe(5);
    expect((await products.findById(A, fries))!.stock).toBe(3);
    expect((await products.findById(A, drink))!.stock).toBe(100);
  });

  it("a combo cannot use another store's product", async () => {
    const other = await createProduct(B, ProductInput.parse({ name: "B thing", price: "10", stock: 9, status: "published", trackStock: true }), "PKR");
    if (!other.ok) throw new Error(other.error);
    const combo = await mk(A, "Sneaky", "100", 0, { bundleText: `1 x ${other.id}` });
    expect(await place([{ productId: combo, qty: 1 }])).toMatchObject({ ok: false });
    expect((await products.findById(B, other.id))!.stock).toBe(9);
  });

  it("time windows block the order and the cart outside the hours, and a category window applies to its products", async () => {
    const id = await mk(A, "Breakfast", "300", 50, { availDays: "mon", availFrom: "08:00", availTo: "11:00" });
    const monday9 = new Date("2026-06-08T04:00:00Z"); // 09:00 Karachi
    expect((await place([{ productId: id, qty: 1 }], { now: monday9 })).ok).toBe(true);
    expect(await place([{ productId: id, qty: 1 }], { now: new Date("2026-06-08T10:00:00Z") })).toMatchObject({ ok: false, error: expect.stringContaining("can only be ordered") });
    expect(await place([{ productId: id, qty: 1 }], { now: new Date("2026-06-09T04:00:00Z") })).toMatchObject({ ok: false });
    const cat = "cat-night";
    await categories.insert(A, { _id: cat, name: "Night menu", slug: "night", availability: { from: "20:00", to: "23:00" } } as never);
    const night = await mk(A, "Night snack", "100", 10, { categoryId: cat });
    expect(await place([{ productId: night, qty: 1 }], { now: new Date("2026-06-08T07:00:00Z") })).toMatchObject({ ok: false });
    expect((await place([{ productId: night, qty: 1 }], { now: new Date("2026-06-08T16:00:00Z") })).ok).toBe(true); // 21:00 Karachi
  });

  it("the cart keeps choices apart, clamps to the chosen size's stock, and prices lines with extras", async () => {
    const id = await mk(A, "Jacket", "3000", 0, { optionsText: "variant Size! : S stock 2; M stock 9\nmodifier Patch : Logo +200" });
    const S = await choice(id, "S"), M = await choice(id, "M"), logo = await choice(id, "Logo");
    const cartId = newCartId();
    expect(await setCartQty(A, cartId, id, 1, "add")).toMatchObject({ ok: false }); // needs a size
    expect(await setCartQty(A, cartId, id, 5, "add", [S])).toMatchObject({ ok: true, error: expect.stringContaining("Only 2") });
    expect(await setCartQty(A, cartId, id, 1, "add", [M, logo])).toMatchObject({ ok: true });
    expect(await setCartQty(A, cartId, id, 1, "add", [M])).toMatchObject({ ok: true });
    const v = await cartView(A, cartId, { currency: "PKR", taxBps: 0, taxEnabled: false, shippingFlatMinor: 0, freeShippingOverMinor: null }, true);
    expect(v.lines).toHaveLength(3); // S, M+logo, M are separate lines
    expect(v.lines.find((l) => l.label === "M, Logo")!.unitMinor).toBe(320000);
    expect(v.totals.subtotalMinor).toBe(2 * 300000 + 320000 + 300000);
    expect(v.hasProblems).toBe(false);
    await setCartQty(A, cartId, id, 0, "set", [S]);
    expect((await cartView(A, cartId, { currency: "PKR", taxBps: 0, taxEnabled: false, shippingFlatMinor: 0, freeShippingOverMinor: null }, true)).lines).toHaveLength(2);
  });

  it("choices forged in a request (price tricks, other products' options) are rejected", async () => {
    const a = await mk(A, "Forge A", "1000", 5, { optionsText: "modifier Extra : Cheap -999; Real +10" });
    const b = await mk(A, "Forge B", "1000", 5, { optionsText: "modifier Extra : Free -1000" });
    const free = await choice(b, "Free");
    expect(await place([{ productId: a, qty: 1, sel: [free] }])).toMatchObject({ ok: false });
    expect(await place([{ productId: a, qty: 1, sel: ["extra-cheap", "nope"] }])).toMatchObject({ ok: false });
  });
});
