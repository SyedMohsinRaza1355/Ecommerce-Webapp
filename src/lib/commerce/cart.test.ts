import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { newCartId, setCartQty, getCartItems, cartView, clearCart, MAX_LINES } from "./cart";
import { createProduct, updateProduct, products, categories, ProductInput, BrandingInput, CommerceInput, saveBranding, saveCommerce, getSettings, slugify } from "./store";
import { pricingConfig } from "./features";
import { featuresFrom } from "./features";
import { evaluateToggles } from "@/lib/toggles/evaluate";
import type { Actor } from "@/lib/auth/rbac";

const sa: Actor = { userId: "sa", role: "super_admin", instanceId: null };
const HAS_DB = Boolean(process.env.MONGODB_URI);
const PLATFORM = `test_cart_${Math.random().toString(36).slice(2, 8)}`;
const created: string[] = [];
let A: TenantContext, B: TenantContext;
const P: Record<string, string> = {};

const mk = async (ctx: TenantContext, name: string, price: string, stock: number, extra: Record<string, unknown> = {}) => {
  const r = await createProduct(ctx, ProductInput.parse({ name, price, stock, status: "published", trackStock: true, ...extra }), "PKR");
  if (!r.ok) throw new Error(r.error);
  return r.id;
};

describe("slugs and settings validation (pure)", () => {
  it("slugify is safe and stable", () => {
    expect(slugify("Zinger Burger!")).toBe("zinger-burger");
    expect(slugify("  --Crème Brûlée--  ")).toBe("creme-brulee");
    expect(slugify("اردو")).toBe("item");
    expect(slugify("<script>")).toBe("script");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
  it("branding input enforces names, colours, https links and emails", () => {
    const ok = { storeName: "Shop", primary: "#4f46e5", locale: "en", logoUrl: "", contactEmail: "", tagline: "" };
    expect(BrandingInput.safeParse(ok).success).toBe(true);
    for (const bad of [{ storeName: "x" }, { primary: "red" }, { primary: "#12345" }, { logoUrl: "http://x.com/a.png" }, { logoUrl: "javascript:alert(1)" }, { contactEmail: "nope" }, { locale: "fr" }]) {
      expect(BrandingInput.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("commerce input enforces currencies and tax format", () => {
    const ok = { currency: "PKR", taxPercent: "17", shipping: "150", freeOver: "" };
    expect(CommerceInput.safeParse(ok).success).toBe(true);
    expect(CommerceInput.safeParse({ ...ok, currency: "XXX" }).success).toBe(false);
    for (const t of ["-1", "abc", "100.123", "1e2", "", "999"]) expect(CommerceInput.safeParse({ ...ok, taxPercent: t }).success, t).toBe(false);
  });
  it("pricing config follows feature toggles", () => {
    const off = featuresFrom(evaluateToggles({ locks: { "F-063": false, "F-042": false } }));
    const cfg = pricingConfig({ currency: "PKR", taxBps: 1700, shippingFlatMinor: 15000, freeShippingOverMinor: 1000 } as never, off);
    expect(cfg.shippingFlatMinor).toBe(0);
    expect(cfg.taxEnabled).toBe(false);
    const on = pricingConfig({ currency: "PKR", taxBps: 1700, shippingFlatMinor: 15000, freeShippingOverMinor: 1000 } as never, featuresFrom(evaluateToggles()));
    expect(on.shippingFlatMinor).toBe(15000);
    expect(on.taxEnabled).toBe(true);
  });
});

describe.skipIf(!HAS_DB)("cart, catalogue and settings (Atlas, synthetic data)", () => {
  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    for (const sub of ["cart-a", "cart-b"]) {
      const r = await provisionInstance(sa, { name: sub, subdomain: sub, packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
      if (!r.ok) throw new Error(r.message);
      created.push(r.instanceId);
    }
    A = issueTenantContext(created[0]);
    B = issueTenantContext(created[1]);
    P.burger = await mk(A, "Burger", "450", 10);
    P.fries = await mk(A, "Fries", "150", 3);
    P.gone = await mk(A, "Sold Out", "10", 0);
    P.draft = await mk(A, "Draft", "10", 5, { status: "draft" });
    P.free = await mk(A, "Gift", "100", 0, { trackStock: false });
    P.b = await mk(B, "B Item", "10", 5);
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  const cfg = { currency: "PKR", taxBps: 0, taxEnabled: false, shippingFlatMinor: 0, freeShippingOverMinor: null };

  it("adds, merges, sets and removes lines; reads back what was stored", async () => {
    const id = newCartId();
    expect(await setCartQty(A, id, P.burger, 2, "add")).toEqual({ ok: true });
    expect(await setCartQty(A, id, P.burger, 3, "add")).toEqual({ ok: true });
    expect(await getCartItems(A, id)).toEqual([{ productId: P.burger, qty: 5 }]);
    expect(await setCartQty(A, id, P.burger, 1, "set")).toEqual({ ok: true });
    expect((await getCartItems(A, id))[0].qty).toBe(1);
    await setCartQty(A, id, P.burger, 0, "set");
    expect(await getCartItems(A, id)).toEqual([]);
  });
  it("clamps to available stock and says so; refuses sold-out, draft and unknown items", async () => {
    const id = newCartId();
    const r = await setCartQty(A, id, P.fries, 9, "add");
    expect(r).toMatchObject({ ok: true, error: expect.stringContaining("Only 3") });
    expect((await getCartItems(A, id))[0].qty).toBe(3);
    expect(await setCartQty(A, id, P.gone, 1, "add")).toMatchObject({ ok: false });
    expect(await setCartQty(A, id, P.draft, 1, "add")).toMatchObject({ ok: false });
    expect(await setCartQty(A, id, "nope", 1, "add")).toMatchObject({ ok: false });
    expect(await setCartQty(A, id, P.burger, 100, "add")).toMatchObject({ ok: false });
    expect(await setCartQty(A, id, P.burger, -1, "add")).toMatchObject({ ok: false });
    expect(await setCartQty(A, id, P.burger, 1.5, "add")).toMatchObject({ ok: false });
  });
  it("untracked products can be added in any quantity up to the limit", async () => {
    const id = newCartId();
    expect(await setCartQty(A, id, P.free, 99, "add")).toEqual({ ok: true });
  });
  it("rejects malformed cart ids and never reads another store's cart", async () => {
    for (const bad of ["", "short", "../../etc/passwd", "a".repeat(100), "id with spaces 0123456789"]) {
      expect(await setCartQty(A, bad, P.burger, 1, "add")).toMatchObject({ ok: false });
      expect(await getCartItems(A, bad)).toEqual([]);
    }
    const id = newCartId();
    await setCartQty(A, id, P.burger, 1, "add");
    expect(await getCartItems(B, id)).toEqual([]);
    expect(await setCartQty(B, id, P.burger, 1, "add")).toMatchObject({ ok: false }); // A's product is unknown in B
  });
  it("a cart is limited in size", async () => {
    const id = newCartId();
    const many: string[] = [];
    for (let i = 0; i < MAX_LINES + 1; i++) many.push(await mk(A, `Bulk ${i}`, "1", 0, { trackStock: false }));
    let last = { ok: true } as { ok: boolean };
    for (const m of many) last = await setCartQty(A, id, m, 1, "add");
    expect(last.ok).toBe(false);
    expect((await getCartItems(A, id)).length).toBeLessThanOrEqual(MAX_LINES);
  });
  it("the cart view takes prices from the database and flags problems", async () => {
    const id = newCartId();
    await setCartQty(A, id, P.burger, 2, "add");
    await setCartQty(A, id, P.fries, 3, "add");
    let v = await cartView(A, id, cfg, true);
    expect(v.totals.subtotalMinor).toBe(2 * 45000 + 3 * 15000);
    expect(v.count).toBe(5);
    expect(v.hasProblems).toBe(false);
    await products.updateById(A, P.burger, { priceMinor: 50000 });
    await products.updateById(A, P.fries, { stock: 1 });
    v = await cartView(A, id, cfg, true);
    expect(v.lines.find((l) => l.product._id === P.fries)?.problem).toBe("lowstock");
    expect(v.hasProblems).toBe(true);
    expect(v.totals.subtotalMinor).toBe(2 * 50000); // problem lines are excluded from payable totals
    await products.updateById(A, P.fries, { stock: 0 });
    expect((await cartView(A, id, cfg, true)).lines.find((l) => l.product._id === P.fries)?.problem).toBe("soldout");
    await products.updateById(A, P.burger, { status: "draft" });
    expect((await cartView(A, id, cfg, true)).lines.find((l) => l.product._id === P.burger)?.problem).toBe("unavailable");
    await products.updateById(A, P.burger, { status: "published", priceMinor: 45000 });
    await products.updateById(A, P.fries, { stock: 3 });
  });
  it("clearing a cart empties it and is safe to repeat", async () => {
    const id = newCartId();
    await setCartQty(A, id, P.burger, 1, "add");
    await clearCart(A, id);
    await clearCart(A, id);
    await clearCart(A, undefined);
    expect(await getCartItems(A, id)).toEqual([]);
  });

  it("editing a product keeps its slug unless the name changes, and validates prices and categories", async () => {
    const before = await products.findById(A, P.burger);
    const base = ProductInput.parse({ name: "Burger", price: "460", stock: 10, status: "published", trackStock: true });
    expect(await updateProduct(A, P.burger, base, "PKR")).toEqual({ ok: true });
    expect((await products.findById(A, P.burger))!.slug).toBe(before!.slug);
    expect((await products.findById(A, P.burger))!.priceMinor).toBe(46000);
    await updateProduct(A, P.burger, { ...base, name: "Mega Burger" }, "PKR");
    expect((await products.findById(A, P.burger))!.slug).toBe("mega-burger");
    expect(await updateProduct(A, P.burger, { ...base, price: "x" }, "PKR")).toMatchObject({ ok: false });
    expect(await updateProduct(A, P.burger, { ...base, categoryId: "no-such-category" }, "PKR")).toMatchObject({ ok: false });
    expect(await updateProduct(A, "missing", base, "PKR")).toMatchObject({ ok: false });
    expect(await updateProduct(B, P.burger, base, "PKR")).toMatchObject({ ok: false }); // another store
    const cats = await categories.find(A, {}, 10);
    expect(await updateProduct(A, P.burger, { ...base, categoryId: cats[0]._id }, "PKR")).toEqual({ ok: true });
  });
  it("branding and commerce settings save and bump the version; bad shipping text is refused", async () => {
    const v0 = (await getSettings(A)).configVersion;
    await saveBranding(A, BrandingInput.parse({ storeName: "New Name", primary: "#c2410c", locale: "ur", logoUrl: "", contactEmail: "a@b.co", tagline: "Hi" }));
    const s = await getSettings(A);
    expect(s).toMatchObject({ locale: "ur", contactEmail: "a@b.co" });
    expect(s.branding).toMatchObject({ storeName: "New Name", primary: "#c2410c", tagline: "Hi" });
    expect(s.configVersion).toBeGreaterThan(v0);
    expect(await saveCommerce(A, CommerceInput.parse({ currency: "PKR", taxPercent: "7.5", shipping: "99.50", freeOver: "1000" }))).toBeNull();
    expect(await getSettings(A)).toMatchObject({ taxBps: 750, shippingFlatMinor: 9950, freeShippingOverMinor: 100000 });
    expect(await saveCommerce(A, CommerceInput.parse({ currency: "PKR", taxPercent: "0", shipping: "abc", freeOver: "" }))).toContain("Enter shipping");
    expect((await getSettings(B)).branding.storeName).not.toBe("New Name"); // other store untouched
  });
});
