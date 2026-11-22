import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { availableNow, describeAvailability, hasVariantStock, resolveSelection, variantLimit } from "./options";
import type { Category, OrderItem, Product } from "./types";

// Shared by the online shop and the till: turns what a shopper picked into priced order lines and the exact
// stock to take (product stock, per-variant stock, or the parts of a bundle), and puts it back on cancel.
export type ReserveLine = { productId: string; qty: number; mode: "product" | "choices"; choiceIds?: string[]; name?: string };
export type Prepared = { key: string; productId: string; name: string; unitMinor: number; qty: number; sel: string[]; label: string; categoryId: string | null; reserve: ReserveLine[]; parts?: { productId: string; qty: number }[] };
export type PrepFeat = { stockTracking: boolean; backorders?: boolean; timeWindows?: boolean };

export const lineKey = (productId: string, sel: string[] = []) => `${productId}|${[...sel].sort().join(",")}`;

export async function prepareLines(ctx: TenantContext, items: { productId: string; qty: number; sel?: string[] }[], feat: PrepFeat, now = new Date()):
  Promise<{ ok: true; lines: Prepared[]; products: Product[] } | { ok: false; error: string }> {
  const merged = new Map<string, { productId: string; sel: string[]; qty: number }>();
  for (const i of items) {
    if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99) return { ok: false, error: "Quantities must be between 1 and 99." };
    const sel = [...new Set(i.sel ?? [])].sort();
    const k = lineKey(i.productId, sel);
    const cur = merged.get(k);
    merged.set(k, { productId: i.productId, sel, qty: (cur?.qty ?? 0) + i.qty });
  }
  const db = await tenantDb(ctx);
  const ids = [...new Set([...merged.values()].map((m) => m.productId))];
  const found = await db.collection<Product>("products").find({ instanceId: ctx.instanceId, _id: { $in: ids }, status: "published" }).toArray();
  if (found.length !== ids.length) return { ok: false, error: "Some items are no longer available." };
  const byId = new Map(found.map((p) => [p._id, p]));
  const partIds = [...new Set(found.flatMap((p) => (p.bundle ?? []).map((b) => b.productId)))].filter((x) => !byId.has(x));
  const partDocs = partIds.length ? await db.collection<Product>("products").find({ instanceId: ctx.instanceId, _id: { $in: partIds } }).toArray() : [];
  const all = new Map([...byId, ...partDocs.map((p) => [p._id, p] as const)]);
  const catIds = [...new Set(found.map((p) => p.categoryId).filter(Boolean))] as string[];
  const cats = new Map((catIds.length ? await db.collection<Category>("categories").find({ instanceId: ctx.instanceId, _id: { $in: catIds } as never }).toArray() : []).map((c) => [c._id, c]));
  const counts = (p: Product) => feat.stockTracking && p.trackStock && !(feat.backorders && p.backorder);

  // stock already promised to other lines of this same order (the same product in two sizes, or inside a bundle)
  const out: Prepared[] = [];
  const wantProduct = new Map<string, number>();
  for (const m of merged.values()) {
    const p = byId.get(m.productId)!;
    const window = p.availability ?? (p.categoryId ? cats.get(p.categoryId)?.availability : undefined);
    if (feat.timeWindows !== false && !availableNow(window, now)) return { ok: false, error: `"${p.name}" can only be ordered ${describeAvailability(window).toLowerCase()}.` };
    const r = resolveSelection(p, m.sel);
    if (!r.ok) return { ok: false, error: r.error };
    const name = r.label ? `${p.name} (${r.label})` : p.name;
    const line: Prepared = { key: lineKey(p._id, r.sel), productId: p._id, name, unitMinor: r.unitMinor, qty: m.qty, sel: r.sel, label: r.label, categoryId: p.categoryId ?? null, reserve: [] };
    if (p.bundle?.length) {
      line.parts = p.bundle.map((b) => ({ productId: b.productId, qty: b.qty * m.qty }));
      for (const part of line.parts) {
        const c = all.get(part.productId);
        if (!c || c.status !== "published") return { ok: false, error: `"${p.name}" is not available right now.` };
        if (counts(c)) {
          wantProduct.set(c._id, (wantProduct.get(c._id) ?? 0) + part.qty);
          if (c.stock < (wantProduct.get(c._id) ?? 0)) return { ok: false, error: `Not enough "${c.name}" left for "${p.name}".` };
          line.reserve.push({ productId: c._id, qty: part.qty, mode: "product", name: c.name });
        }
      }
    } else if (hasVariantStock(p) && r.sel.length) {
      const lim = variantLimit(p, r.sel);
      if (lim !== null && lim < m.qty && !(feat.backorders && p.backorder)) return { ok: false, error: `Only ${lim} of "${name}" left.` };
      const stocked = p.options!.flatMap((g) => g.choices).filter((c) => r.sel.includes(c.id) && c.stock != null).map((c) => c.id);
      if (stocked.length && !(feat.backorders && p.backorder)) line.reserve.push({ productId: p._id, qty: m.qty, mode: "choices", choiceIds: stocked, name });
    } else if (counts(p)) {
      wantProduct.set(p._id, (wantProduct.get(p._id) ?? 0) + m.qty);
      if (p.stock < (wantProduct.get(p._id) ?? 0)) return { ok: false, error: `Only ${p.stock} of "${p.name}" left.` };
      line.reserve.push({ productId: p._id, qty: m.qty, mode: "product", name: p.name });
    }
    out.push(line);
  }
  return { ok: true, lines: out, products: found };
}

/** Takes every line's stock atomically; if anything is short it puts back what it took and names the culprit. */
export async function reserveLines(ctx: TenantContext, lines: ReserveLine[]): Promise<string | null> {
  const db = await tenantDb(ctx);
  const col = db.collection<Product>("products");
  const done: ReserveLine[] = [];
  for (const l of lines) {
    if (l.mode === "product") {
      const r = await col.updateOne({ _id: l.productId, instanceId: ctx.instanceId, status: "published", stock: { $gte: l.qty } }, { $inc: { stock: -l.qty } });
      if (r.matchedCount !== 1) { await releaseLines(ctx, done); return l.name ?? l.productId; }
      done.push(l);
    } else {
      const taken: string[] = [];
      for (const cid of l.choiceIds ?? []) {
        const r = await col.updateOne(
          { _id: l.productId, instanceId: ctx.instanceId, status: "published" },
          { $inc: { "options.$[g].choices.$[c].stock": -l.qty } },
          { arrayFilters: [{ "g.id": { $exists: true } }, { "c.id": cid, "c.stock": { $gte: l.qty } }] },
        );
        if (r.modifiedCount !== 1) { await releaseLines(ctx, [...done, { ...l, choiceIds: taken }]); return l.name ?? l.productId; }
        taken.push(cid);
      }
      done.push(l);
    }
  }
  return null;
}

export async function releaseLines(ctx: TenantContext, lines: ReserveLine[]) {
  const col = (await tenantDb(ctx)).collection<Product>("products");
  for (const l of lines) {
    if (l.mode === "product") await col.updateOne({ _id: l.productId, instanceId: ctx.instanceId, trackStock: true }, { $inc: { stock: l.qty } });
    else for (const cid of l.choiceIds ?? []) {
      await col.updateOne({ _id: l.productId, instanceId: ctx.instanceId }, { $inc: { "options.$[g].choices.$[c].stock": l.qty } }, { arrayFilters: [{ "g.id": { $exists: true } }, { "c.id": cid, "c.stock": { $type: "number" } }] });
    }
  }
}

/** Gives back the stock of a cancelled or expired order, exactly as it was taken. */
export async function releaseOrderItems(ctx: TenantContext, items: OrderItem[]) {
  const col = (await tenantDb(ctx)).collection<Product>("products");
  const ids = [...new Set(items.map((i) => i.productId))];
  const docs = new Map((await col.find({ instanceId: ctx.instanceId, _id: { $in: ids } }).toArray()).map((p) => [p._id, p]));
  const back: ReserveLine[] = [];
  for (const i of items) {
    if (i.parts?.length) { for (const part of i.parts) back.push({ productId: part.productId, qty: part.qty, mode: "product" }); continue; }
    const p = docs.get(i.productId);
    if (p && hasVariantStock(p) && i.sel?.length) {
      const stocked = p.options!.flatMap((g) => g.choices).filter((c) => i.sel!.includes(c.id) && c.stock != null).map((c) => c.id);
      back.push({ productId: i.productId, qty: i.qty, mode: "choices", choiceIds: stocked });
    } else back.push({ productId: i.productId, qty: i.qty, mode: "product" });
  }
  await releaseLines(ctx, back);
}
