import { randomUUID } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { rateLimit } from "@/lib/auth/ratelimit";
import { enqueueEmail, processOutbox } from "./outbox";
import { createProduct, categories, products, ProductInput, slugify } from "./store";
import type { Order } from "./types";

// Catalogue features beyond the core shop: reviews, newsletter, contact form, custom pages,
// low-stock alerts, CSV import/export, reports and the store backup.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const db = (ctx: TenantContext) => tenantDb(ctx);

// ---------------- reviews (F-009) ----------------
export type ReviewRow = { _id: string; productId: string; rating: number; text: string; name: string; verifiedBuyer: boolean; status: "published" | "hidden"; createdAt: Date };

export async function listReviews(ctx: TenantContext, productId: string, limit = 50): Promise<ReviewRow[]> {
  return (await (await db(ctx)).collection<ReviewRow>("reviews").find({ instanceId: ctx.instanceId, productId, status: "published" } as never).sort({ createdAt: -1 }).limit(limit).toArray()) as ReviewRow[];
}

export async function ratingSummary(ctx: TenantContext, productId: string): Promise<{ count: number; average: number }> {
  const r = await (await db(ctx)).collection("reviews").aggregate<{ count: number; avg: number }>([
    { $match: { instanceId: ctx.instanceId, productId, status: "published" } },
    { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]).toArray();
  return r[0] ? { count: r[0].count, average: Math.round(r[0].avg * 10) / 10 } : { count: 0, average: 0 };
}

export async function setReviewStatus(ctx: TenantContext, id: string, status: "published" | "hidden" | "deleted") {
  const c = (await db(ctx)).collection("reviews");
  if (status === "deleted") await c.deleteOne({ _id: id as never, instanceId: ctx.instanceId });
  else await c.updateOne({ _id: id as never, instanceId: ctx.instanceId }, { $set: { status } });
}

// ---------------- newsletter (F-058) ----------------
export async function subscribeNewsletter(ctx: TenantContext, emailRaw: string, ip: string, opts: { storeName: string; welcome: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 120) return { ok: false, error: "Enter a valid email address." };
  if (!(await rateLimit(`news:${ctx.instanceId}:${ip}`, 5, 60 * 60_000)).ok) return { ok: false, error: "Too many attempts. Try again later." };
  try {
    await (await db(ctx)).collection("newsletter").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, email, createdAt: new Date() });
    if (opts.welcome) { await enqueueEmail(ctx, "newsletter.welcome", email, { storeName: opts.storeName }); await processOutbox(ctx).catch(() => undefined); }
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e; // already subscribed: same friendly answer
  }
  return { ok: true };
}

// ---------------- contact form (F-080) ----------------
export async function saveContactMessage(ctx: TenantContext, i: { name: string; email: string; message: string; honeypot?: string }, ip: string, notifyTo: string | null, storeName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (i.honeypot) return { ok: true }; // bots fill hidden fields; they are told it worked
  const name = i.name.trim(), message = i.message.trim(), email = i.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (message.length < 5 || message.length > 2000) return { ok: false, error: "Write a message between 5 and 2000 characters." };
  if (!(await rateLimit(`contact:${ctx.instanceId}:${ip}`, 5, 60 * 60_000)).ok) return { ok: false, error: "Too many messages. Please try again later." };
  await (await db(ctx)).collection("contact_messages").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, name, email, message, read: false, createdAt: new Date() });
  if (notifyTo) { await enqueueEmail(ctx, "contact.message", notifyTo, { storeName, name, email, message }); await processOutbox(ctx).catch(() => undefined); }
  return { ok: true };
}

// ---------------- custom pages (F-078, F-081) ----------------
export type PageDoc = { _id: string; slug: string; title: string; body: string; published: boolean; inFooter: boolean; updatedAt: Date };
const RESERVED = new Set(["admin", "account", "cart", "checkout", "products", "product", "order", "pay", "contact", "p"]);

export async function savePage(ctx: TenantContext, i: { id?: string; title: string; slug?: string; body: string; published: boolean; inFooter: boolean }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = i.title.trim();
  if (title.length < 2 || title.length > 80) return { ok: false, error: "Enter a page title (2 to 80 characters)." };
  if (i.body.length > 20000) return { ok: false, error: "The page text can be at most 20,000 characters." };
  const slug = slugify(i.slug?.trim() || title);
  if (!slug || RESERVED.has(slug)) return { ok: false, error: "Choose a different page address." };
  const c = (await db(ctx)).collection<PageDoc & { instanceId: string }>("pages");
  const id = i.id ?? randomUUID();
  try {
    await c.updateOne({ _id: id, instanceId: ctx.instanceId }, { $set: { slug, title, body: i.body, published: i.published, inFooter: i.inFooter, updatedAt: new Date() } }, { upsert: true });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { ok: false, error: "Another page already uses that address." };
    throw e;
  }
  return { ok: true, id };
}

export async function listPages(ctx: TenantContext, publishedOnly = false): Promise<PageDoc[]> {
  return (await (await db(ctx)).collection<PageDoc>("pages").find({ instanceId: ctx.instanceId, ...(publishedOnly ? { published: true } : {}) } as never).sort({ title: 1 }).limit(100).toArray()) as PageDoc[];
}

export async function getPageBySlug(ctx: TenantContext, slug: string): Promise<PageDoc | null> {
  return (await (await db(ctx)).collection<PageDoc>("pages").findOne({ instanceId: ctx.instanceId, slug, published: true } as never)) as PageDoc | null;
}

export async function deletePage(ctx: TenantContext, id: string) {
  await (await db(ctx)).collection("pages").deleteOne({ _id: id as never, instanceId: ctx.instanceId });
}

// ---------------- low stock (F-020) ----------------
export const LOW_STOCK_THRESHOLD = 5;

export async function lowStockItems(ctx: TenantContext, threshold = LOW_STOCK_THRESHOLD) {
  return products.find(ctx, { trackStock: true, status: "published", stock: { $lte: threshold } } as never, 50).then((r) => r.sort((a, b) => a.stock - b.stock));
}

/** Called after stock is taken: tells the owner once when an item first drops to the threshold. */
export async function notifyLowStock(ctx: TenantContext, taken: { productId: string; qty: number }[], to: string | null, storeName: string, threshold = LOW_STOCK_THRESHOLD) {
  if (!to) return;
  const out: string[] = [];
  for (const t of taken) {
    const p = await products.findById(ctx, t.productId);
    if (p?.trackStock && p.stock <= threshold && p.stock + t.qty > threshold) out.push(`${p.name}: ${p.stock} left`);
  }
  if (!out.length) return;
  await enqueueEmail(ctx, "stock.low", to, { storeName, summary: `Running low: ${out.join("; ")}.` });
  await processOutbox(ctx).catch(() => undefined);
}

// ---------------- CSV (F-011, F-096) ----------------
/** Cells starting with = + - @ are prefixed so spreadsheets never run them as formulas (CSV injection). */
export function csvCell(v: unknown): string {
  let s = v instanceof Date ? v.toISOString() : String(v ?? "");
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export async function exportCsv(ctx: TenantContext, kind: "orders" | "products" | "customers" | "newsletter"): Promise<string> {
  const d = await db(ctx);
  const f = { instanceId: ctx.instanceId };
  if (kind === "products") {
    const rows = await products.find(ctx, {}, 5000);
    const cats = new Map((await categories.find(ctx, {}, 500)).map((c) => [c._id, c.name]));
    return toCsv([["name", "price", "stock", "category", "description", "status", "image"], ...rows.map((p) => [p.name, (p.priceMinor / 100).toFixed(2), p.stock, cats.get(p.categoryId ?? "") ?? "", p.description, p.status, p.imageUrl ?? ""])]);
  }
  if (kind === "orders") {
    const rows = await d.collection<Order>("orders").find(f as never).sort({ createdAt: -1 }).limit(5000).toArray();
    return toCsv([["order", "date", "status", "payment_method", "payment_status", "customer", "email", "phone", "city", "items", "subtotal", "discount", "shipping", "tax", "total", "currency"],
      ...rows.map((o) => [o.orderNo, o.createdAt, o.state, o.payment.method, o.payment.state, o.customer.name, o.customer.email, o.customer.phone, o.customer.city, o.items.map((i) => `${i.qty}x ${i.name}`).join("; "), (o.subtotalMinor / 100).toFixed(2), (o.discountMinor / 100).toFixed(2), (o.shippingMinor / 100).toFixed(2), (o.taxMinor / 100).toFixed(2), (o.totalMinor / 100).toFixed(2), o.currency])]);
  }
  if (kind === "customers") {
    const rows = await d.collection("customers").find(f).limit(5000).toArray();
    return toCsv([["name", "email", "phone", "verified", "joined"], ...rows.map((c) => [c.name, c.email, c.phone ?? "", c.emailVerified ? "yes" : "no", c.createdAt])]);
  }
  const rows = await d.collection("newsletter").find(f).limit(20000).toArray();
  return toCsv([["email", "subscribed"], ...rows.map((r) => [r.email, r.createdAt])]);
}

export type ImportResult = { created: number; errors: { row: number; message: string }[] };

/** Imports products from CSV. Bad rows are reported by line number and skipped; good rows are still created. */
export async function importProductsCsv(ctx: TenantContext, text: string, currency: string): Promise<ImportResult> {
  if (text.length > 1_000_000) return { created: 0, errors: [{ row: 0, message: "The file is too large (1 MB maximum)." }] };
  const rows = parseCsv(text);
  if (rows.length < 2) return { created: 0, errors: [{ row: 0, message: "The file needs a header row and at least one product." }] };
  if (rows.length > 501) return { created: 0, errors: [{ row: 0, message: "Import at most 500 products at a time." }] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  if (col("name") < 0 || col("price") < 0) return { created: 0, errors: [{ row: 1, message: 'The header row must contain "name" and "price" columns.' }] };
  const cats = new Map((await categories.find(ctx, {}, 500)).map((c) => [c.name.toLowerCase(), c._id]));
  const result: ImportResult = { created: 0, errors: [] };
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    try {
      let categoryId = "";
      const catName = get("category");
      if (catName) {
        categoryId = cats.get(catName.toLowerCase()) ?? "";
        if (!categoryId) {
          categoryId = randomUUID();
          await categories.insert(ctx, { _id: categoryId, name: catName.slice(0, 60), slug: slugify(catName) || categoryId.slice(0, 8), sortOrder: 99 } as never);
          cats.set(catName.toLowerCase(), categoryId);
        }
      }
      const parsed = ProductInput.safeParse({ name: get("name"), price: get("price"), stock: get("stock") || "0", description: get("description"), categoryId, imageUrl: get("image"), status: get("status") === "published" ? "published" : "draft", trackStock: get("stock") !== "" });
      if (!parsed.success) { result.errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? "Invalid row" }); continue; }
      const res = await createProduct(ctx, parsed.data, currency);
      if (res.ok) result.created++; else result.errors.push({ row: i + 1, message: res.error });
    } catch (e) {
      result.errors.push({ row: i + 1, message: (e as Error).message.slice(0, 120) });
    }
  }
  return result;
}

// ---------------- reports (F-094, F-095, F-098) ----------------
const live = { state: { $ne: "cancelled" }, "payment.state": { $in: ["captured", "cod_due", "partially_refunded", "refunded"] } };

export async function productReport(ctx: TenantContext, from: Date, to: Date) {
  return (await db(ctx)).collection("orders").aggregate<{ _id: string; name: string; qty: number; revenueMinor: number }>([
    { $match: { instanceId: ctx.instanceId, createdAt: { $gte: from, $lt: to }, ...live } },
    { $unwind: "$items" },
    { $group: { _id: "$items.productId", name: { $last: "$items.name" }, qty: { $sum: "$items.qty" }, revenueMinor: { $sum: "$items.lineMinor" } } },
    { $sort: { revenueMinor: -1 } }, { $limit: 100 },
  ]).toArray();
}

export async function customerReport(ctx: TenantContext, from: Date, to: Date) {
  return (await db(ctx)).collection("orders").aggregate<{ _id: string; name: string; orders: number; spentMinor: number; last: Date }>([
    { $match: { instanceId: ctx.instanceId, createdAt: { $gte: from, $lt: to }, ...live, "customer.email": { $ne: "[deleted]" } } },
    { $group: { _id: "$customer.email", name: { $last: "$customer.name" }, orders: { $sum: 1 }, spentMinor: { $sum: "$totalMinor" }, last: { $max: "$createdAt" } } },
    { $sort: { spentMinor: -1 } }, { $limit: 100 },
  ]).toArray();
}

export async function taxReport(ctx: TenantContext, from: Date, to: Date) {
  return (await db(ctx)).collection("orders").aggregate<{ _id: string; orders: number; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number }>([
    { $match: { instanceId: ctx.instanceId, createdAt: { $gte: from, $lt: to }, ...live } },
    { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, orders: { $sum: 1 }, subtotalMinor: { $sum: "$subtotalMinor" }, discountMinor: { $sum: "$discountMinor" }, shippingMinor: { $sum: "$shippingMinor" }, taxMinor: { $sum: "$taxMinor" }, totalMinor: { $sum: "$totalMinor" } } },
    { $sort: { _id: 1 } },
  ]).toArray();
}

// ---------------- backup (F-111) ----------------
const BACKUP_COLLECTIONS = ["settings", "categories", "products", "orders", "discounts", "customers", "reviews", "pages", "newsletter", "contact_messages", "activity"];

/** Everything the owner needs to keep a copy of the store. Passwords, login secrets and payment keys are never included. */
export async function buildBackup(ctx: TenantContext) {
  const d = await db(ctx);
  const out: Record<string, unknown[]> = {};
  for (const name of BACKUP_COLLECTIONS) {
    const rows = await d.collection(name).find({ instanceId: ctx.instanceId }).limit(50000).toArray();
    out[name] = rows.map((r) => { const { passwordHash: _p, totp: _t, ...rest } = r as Record<string, unknown>; void _p; void _t; return rest; });
  }
  return { format: "storeforge-backup-v1", createdAt: new Date().toISOString(), counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), data: out };
}
