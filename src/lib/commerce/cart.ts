import { randomBytes } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import type { Product } from "./types";
import { computeTotals, type PricingConfig, type Totals } from "./pricing";

type CartDoc = { _id: string; instanceId: string; items: { productId: string; qty: number }[]; updatedAt: Date };

export const MAX_LINE_QTY = 99;
export const MAX_LINES = 50;
export const newCartId = () => randomBytes(18).toString("base64url");
const CART_ID_RE = /^[A-Za-z0-9_-]{20,40}$/;

async function col(ctx: TenantContext) {
  return (await tenantDb(ctx)).collection<CartDoc>("carts");
}

export async function getCartItems(ctx: TenantContext, cartId: string | undefined) {
  if (!cartId || !CART_ID_RE.test(cartId)) return [];
  return (await (await col(ctx)).findOne({ _id: cartId, instanceId: ctx.instanceId }))?.items ?? [];
}

export async function setCartQty(ctx: TenantContext, cartId: string, productId: string, qty: number, mode: "add" | "set" = "set"): Promise<{ ok: boolean; error?: string }> {
  if (!CART_ID_RE.test(cartId)) return { ok: false, error: "Invalid cart" };
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_LINE_QTY) return { ok: false, error: "Choose a quantity between 1 and 99." };
  const db = await tenantDb(ctx);
  const p = await db.collection<Product>("products").findOne({ _id: productId, instanceId: ctx.instanceId, status: "published" });
  if (!p) return { ok: false, error: "That product is not available." };
  const c = await col(ctx);
  const cur = (await c.findOne({ _id: cartId, instanceId: ctx.instanceId }))?.items ?? [];
  const items = cur.filter((i) => i.productId !== productId);
  const existing = cur.find((i) => i.productId === productId)?.qty ?? 0;
  let next = mode === "add" ? existing + qty : qty;
  if (next > MAX_LINE_QTY) next = MAX_LINE_QTY;
  if (p.trackStock && next > p.stock) {
    if (p.stock <= 0) return { ok: false, error: "This item is out of stock." };
    next = p.stock; // clamp and tell the buyer
  }
  if (next > 0) items.push({ productId, qty: next });
  if (items.length > MAX_LINES) return { ok: false, error: "Your cart is full." };
  await c.updateOne({ _id: cartId, instanceId: ctx.instanceId }, { $set: { items, updatedAt: new Date() } }, { upsert: true });
  return { ok: true, ...(p.trackStock && next < (mode === "add" ? existing + qty : qty) ? { error: `Only ${p.stock} available. We adjusted your quantity.` } : {}) };
}

export async function clearCart(ctx: TenantContext, cartId: string | undefined) {
  if (!cartId || !CART_ID_RE.test(cartId)) return;
  await (await col(ctx)).deleteOne({ _id: cartId, instanceId: ctx.instanceId });
}

export type CartLine = { product: Product; qty: number; lineMinor: number; problem?: string };

/** Joins live product data; unpublished or sold-out items are flagged, prices always come from the database. */
export async function cartView(ctx: TenantContext, cartId: string | undefined, cfg: PricingConfig, trackStock: boolean) {
  const items = await getCartItems(ctx, cartId);
  const db = await tenantDb(ctx);
  const ids = items.map((i) => i.productId);
  const prods = ids.length ? await db.collection<Product>("products").find({ instanceId: ctx.instanceId, _id: { $in: ids } }).toArray() : [];
  const byId = new Map(prods.map((p) => [p._id, p]));
  const lines: CartLine[] = [];
  for (const i of items) {
    const p = byId.get(i.productId);
    if (!p) continue;
    let problem: string | undefined;
    if (p.status !== "published") problem = "unavailable";
    else if (trackStock && p.trackStock && p.stock < i.qty) problem = p.stock <= 0 ? "soldout" : "lowstock";
    lines.push({ product: p, qty: i.qty, lineMinor: p.priceMinor * i.qty, problem });
  }
  const good = lines.filter((l) => !l.problem);
  const totals: Totals = computeTotals(good.map((l) => ({ productId: l.product._id, name: l.product.name, unitMinor: l.product.priceMinor, qty: l.qty })), cfg);
  return { lines, totals, count: lines.reduce((n, l) => n + l.qty, 0), hasProblems: lines.some((l) => l.problem) };
}
