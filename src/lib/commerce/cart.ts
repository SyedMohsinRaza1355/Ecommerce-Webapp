import { randomBytes } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import type { Category, Product } from "./types";
import { computeTotals, type PricingConfig, type Totals } from "./pricing";
import { bestPromo, listPromos, type PromoResult } from "./rules";
import { availableNow, describeAvailability, hasVariantStock, resolveSelection, variantLimit } from "./options";
import { lineKey } from "./lines";

type CartItem = { productId: string; qty: number; sel?: string[] };
type CartDoc = { _id: string; instanceId: string; items: CartItem[]; updatedAt: Date };

export const MAX_LINE_QTY = 99;
export const MAX_LINES = 50;
export const newCartId = () => randomBytes(18).toString("base64url");
const CART_ID_RE = /^[A-Za-z0-9_-]{20,40}$/;
export { lineKey };

async function col(ctx: TenantContext) {
  return (await tenantDb(ctx)).collection<CartDoc>("carts");
}

export async function getCartItems(ctx: TenantContext, cartId: string | undefined): Promise<CartItem[]> {
  if (!cartId || !CART_ID_RE.test(cartId)) return [];
  return (await (await col(ctx)).findOne({ _id: cartId, instanceId: ctx.instanceId }))?.items ?? [];
}

/** How many of a bundle can be made from what the parts have in stock. */
async function bundleLimit(ctx: TenantContext, p: Product): Promise<number | null> {
  if (!p.bundle?.length) return null;
  const parts = await (await tenantDb(ctx)).collection<Product>("products").find({ instanceId: ctx.instanceId, _id: { $in: p.bundle.map((b) => b.productId) } }).toArray();
  const by = new Map(parts.map((x) => [x._id, x]));
  let lim = Infinity;
  for (const b of p.bundle) {
    const c = by.get(b.productId);
    if (!c) return 0;
    if (c.trackStock) lim = Math.min(lim, Math.floor(c.stock / b.qty));
  }
  return Number.isFinite(lim) ? lim : null;
}

export async function setCartQty(ctx: TenantContext, cartId: string, productId: string, qty: number, mode: "add" | "set" = "set", selIn: string[] = []): Promise<{ ok: boolean; error?: string }> {
  if (!CART_ID_RE.test(cartId)) return { ok: false, error: "Invalid cart" };
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_LINE_QTY) return { ok: false, error: "Choose a quantity between 1 and 99." };
  const db = await tenantDb(ctx);
  const p = await db.collection<Product>("products").findOne({ _id: productId, instanceId: ctx.instanceId, status: "published" });
  if (!p) return { ok: false, error: "That product is not available." };
  const r = resolveSelection(p, selIn);
  if (!r.ok) return qty === 0 ? { ok: true } : { ok: false, error: r.error };
  const cat = p.categoryId ? await db.collection<Category>("categories").findOne({ _id: p.categoryId, instanceId: ctx.instanceId } as never) : null;
  const window = p.availability ?? cat?.availability;
  if (qty > 0 && !availableNow(window)) return { ok: false, error: `This can only be ordered ${describeAvailability(window).toLowerCase()}.` };
  const key = lineKey(p._id, r.sel);
  const c = await col(ctx);
  const cur = (await c.findOne({ _id: cartId, instanceId: ctx.instanceId }))?.items ?? [];
  const items = cur.filter((i) => lineKey(i.productId, i.sel) !== key);
  const existing = cur.find((i) => lineKey(i.productId, i.sel) === key)?.qty ?? 0;
  const wanted = mode === "add" ? existing + qty : qty;
  let next = Math.min(wanted, MAX_LINE_QTY);
  const lim = hasVariantStock(p) ? variantLimit(p, r.sel) : p.trackStock && !p.backorder ? p.stock : null;
  const bl = await bundleLimit(ctx, p);
  const cap = [lim, bl].filter((x): x is number => x !== null).reduce((a, b) => Math.min(a, b), Infinity);
  if (Number.isFinite(cap) && !p.backorder && next > cap) {
    if (cap <= 0) return { ok: false, error: "This item is out of stock." };
    next = cap; // clamp and tell the buyer
  }
  if (next > 0) items.push({ productId, qty: next, ...(r.sel.length ? { sel: r.sel } : {}) });
  if (items.length > MAX_LINES) return { ok: false, error: "Your cart is full." };
  await c.updateOne({ _id: cartId, instanceId: ctx.instanceId }, { $set: { items, updatedAt: new Date() } }, { upsert: true });
  return { ok: true, ...(next < wanted && Number.isFinite(cap) ? { error: `Only ${cap} available. We adjusted your quantity.` } : {}) };
}

export async function clearCart(ctx: TenantContext, cartId: string | undefined) {
  if (!cartId || !CART_ID_RE.test(cartId)) return;
  await (await col(ctx)).deleteOne({ _id: cartId, instanceId: ctx.instanceId });
}

export type CartLine = { key: string; product: Product; qty: number; sel: string[]; label: string; unitMinor: number; lineMinor: number; problem?: string };

/** Joins live product data; unpublished, unavailable or sold-out items are flagged, prices always come from the database. */
export async function cartView(ctx: TenantContext, cartId: string | undefined, cfg: PricingConfig, trackStock: boolean, opts: { autoPromos?: boolean; flashSales?: boolean; backorders?: boolean; now?: Date } = {}) {
  const items = await getCartItems(ctx, cartId);
  const db = await tenantDb(ctx);
  const ids = [...new Set(items.map((i) => i.productId))];
  const prods = ids.length ? await db.collection<Product>("products").find({ instanceId: ctx.instanceId, _id: { $in: ids } }).toArray() : [];
  const byId = new Map(prods.map((p) => [p._id, p]));
  const lines: CartLine[] = [];
  for (const i of items) {
    const p = byId.get(i.productId);
    if (!p) continue;
    const r = resolveSelection(p, i.sel ?? []);
    let problem: string | undefined;
    const unit = r.ok ? r.unitMinor : p.priceMinor;
    if (p.status !== "published" || !r.ok) problem = "unavailable";
    else if (!availableNow(p.availability)) problem = "notnow";
    else if (trackStock && !(opts.backorders && p.backorder)) {
      const lim = hasVariantStock(p) ? variantLimit(p, r.sel) : p.trackStock ? p.stock : null;
      if (lim !== null && lim < i.qty) problem = lim <= 0 ? "soldout" : "lowstock";
    }
    lines.push({ key: lineKey(p._id, r.ok ? r.sel : []), product: p, qty: i.qty, sel: r.ok ? r.sel : [], label: r.ok ? r.label : "", unitMinor: unit, lineMinor: unit * i.qty, problem });
  }
  const good = lines.filter((l) => !l.problem);
  const promo: PromoResult = opts.autoPromos || opts.flashSales
    ? bestPromo(await listPromos(ctx), good.map((l) => ({ productId: l.product._id, categoryId: l.product.categoryId ?? null, lineMinor: l.lineMinor })), opts.now ?? new Date(), { auto: !!opts.autoPromos, flash: !!opts.flashSales })
    : null;
  const totals: Totals = computeTotals(good.map((l) => ({ productId: l.product._id, name: l.product.name, unitMinor: l.unitMinor, qty: l.qty })), { ...cfg, fixedDiscountMinor: promo?.discountMinor ?? 0 });
  return { lines, totals, promo, count: lines.reduce((n, l) => n + l.qty, 0), hasProblems: lines.some((l) => l.problem) };
}
