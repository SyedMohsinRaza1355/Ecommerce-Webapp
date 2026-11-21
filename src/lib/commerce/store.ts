import { z } from "zod";
import { randomUUID } from "node:crypto";
import { TenantRepo } from "@/lib/tenant/repo";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { isHex } from "@/lib/color";
import { CURRENCY_EXPONENT, parseMajor } from "@/lib/money/money";
import { DEFAULT_SETTINGS, type Category, type Product, type Settings } from "./types";

export const products = new TenantRepo<Product>("products");
export const categories = new TenantRepo<Category>("categories");

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
}

// ---------------- settings ----------------
export async function getSettings(ctx: TenantContext): Promise<Settings> {
  const db = await tenantDb(ctx);
  const doc = await db.collection<Settings>("settings").findOne({ instanceId: ctx.instanceId });
  return {
    ...DEFAULT_SETTINGS,
    ...(doc ?? {}),
    instanceId: ctx.instanceId,
    branding: { ...DEFAULT_SETTINGS.branding, ...(doc?.branding ?? {}) },
  } as Settings;
}

const httpsUrl = z.string().trim().max(500).refine((u) => u === "" || /^https:\/\/[^\s"'<>]+$/i.test(u), "Use an https:// link");

export const BrandingInput = z.object({
  storeName: z.string().trim().min(2, "Enter at least 2 characters").max(60),
  tagline: z.string().trim().max(120).default(""),
  primary: z.string().trim().refine(isHex, "Use a colour like #4f46e5"),
  logoUrl: httpsUrl.default(""),
  contactEmail: z.string().trim().max(120).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email").default(""),
  locale: z.enum(["en", "ur"]),
});

export const CommerceInput = z.object({
  currency: z.string().refine((c) => c in CURRENCY_EXPONENT, "Unsupported currency"),
  taxPercent: z.string().trim().regex(/^\d{1,2}(\.\d{1,2})?$/, "Use a number like 17 or 7.5"),
  shipping: z.string().trim(),
  freeOver: z.string().trim(),
});

export async function saveBranding(ctx: TenantContext, input: z.infer<typeof BrandingInput>): Promise<void> {
  const db = await tenantDb(ctx);
  await db.collection("settings").updateOne(
    { instanceId: ctx.instanceId },
    {
      $set: {
        "branding.storeName": input.storeName, "branding.tagline": input.tagline, "branding.primary": input.primary,
        "branding.logoUrl": input.logoUrl, contactEmail: input.contactEmail, locale: input.locale,
      },
      $inc: { configVersion: 1 },
    },
    { upsert: true },
  );
}

export async function saveCommerce(ctx: TenantContext, input: z.infer<typeof CommerceInput>): Promise<string | null> {
  const cur = input.currency;
  let shipping: number, freeOver: number | null;
  try {
    shipping = input.shipping === "" ? 0 : parseMajor(input.shipping, cur).minor;
    freeOver = input.freeOver === "" ? null : parseMajor(input.freeOver, cur).minor;
  } catch {
    return "Enter shipping amounts like 150 or 99.50";
  }
  if (shipping < 0 || (freeOver !== null && freeOver < 0)) return "Amounts cannot be negative";
  const taxBps = Math.round(parseFloat(input.taxPercent) * 100);
  const db = await tenantDb(ctx);
  await db.collection("settings").updateOne(
    { instanceId: ctx.instanceId },
    { $set: { currency: cur, taxBps, shippingFlatMinor: shipping, freeShippingOverMinor: freeOver }, $inc: { configVersion: 1 } },
    { upsert: true },
  );
  return null;
}

// ---------------- products ----------------
export const ProductInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  description: z.string().trim().max(4000).default(""),
  price: z.string().trim().min(1, "Enter a price"),
  compareAt: z.string().trim().default(""),
  categoryId: z.string().trim().default(""),
  imageUrl: httpsUrl.default(""),
  stock: z.coerce.number().int("Stock must be a whole number").min(0).max(1_000_000),
  trackStock: z.boolean().default(true),
  status: z.enum(["draft", "published"]),
});

export type ProductForm = z.infer<typeof ProductInput>;

async function uniqueSlug(ctx: TenantContext, base: string, exceptId?: string): Promise<string> {
  let slug = base, n = 1;
  while (true) {
    const hit = await products.find(ctx, { slug } as never, 1);
    if (hit.length === 0 || hit[0]._id === exceptId) return slug;
    slug = `${base}-${++n}`;
  }
}

export async function createProduct(ctx: TenantContext, input: ProductForm, currency: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let priceMinor: number, compare: number | null = null;
  try {
    priceMinor = parseMajor(input.price, currency).minor;
    if (input.compareAt) compare = parseMajor(input.compareAt, currency).minor;
  } catch {
    return { ok: false, error: "Enter prices like 499 or 499.50" };
  }
  if (priceMinor < 0) return { ok: false, error: "Price cannot be negative" };
  if (compare !== null && compare <= priceMinor) return { ok: false, error: "The compare-at price must be higher than the price" };
  if (input.categoryId && !(await categories.findById(ctx, input.categoryId))) return { ok: false, error: "Choose a valid category" };
  const now = new Date();
  const id = randomUUID();
  await products.insert(ctx, {
    _id: id, name: input.name, slug: await uniqueSlug(ctx, slugify(input.name)), description: input.description,
    priceMinor, compareAtMinor: compare, categoryId: input.categoryId || null, imageUrl: input.imageUrl,
    stock: input.stock, trackStock: input.trackStock, status: input.status, createdAt: now, updatedAt: now,
  });
  return { ok: true, id };
}

export async function updateProduct(ctx: TenantContext, id: string, input: ProductForm, currency: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cur = await products.findById(ctx, id);
  if (!cur) return { ok: false, error: "Product not found" };
  let priceMinor: number, compare: number | null = null;
  try {
    priceMinor = parseMajor(input.price, currency).minor;
    if (input.compareAt) compare = parseMajor(input.compareAt, currency).minor;
  } catch {
    return { ok: false, error: "Enter prices like 499 or 499.50" };
  }
  if (priceMinor < 0) return { ok: false, error: "Price cannot be negative" };
  if (compare !== null && compare <= priceMinor) return { ok: false, error: "The compare-at price must be higher than the price" };
  if (input.categoryId && !(await categories.findById(ctx, input.categoryId))) return { ok: false, error: "Choose a valid category" };
  await products.updateById(ctx, id, {
    name: input.name, description: input.description, priceMinor, compareAtMinor: compare, categoryId: input.categoryId || null,
    imageUrl: input.imageUrl, stock: input.stock, trackStock: input.trackStock, status: input.status, updatedAt: new Date(),
    slug: cur.name === input.name ? cur.slug : await uniqueSlug(ctx, slugify(input.name), id),
  });
  return { ok: true };
}

export async function listPublished(ctx: TenantContext, opts: { q?: string; categoryId?: string; page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(opts.pageSize ?? 24, 60);
  const page = Math.max(opts.page ?? 1, 1);
  const col = await products.collection(ctx);
  const filter: Record<string, unknown> = { status: "published" };
  if (opts.categoryId) filter.categoryId = opts.categoryId;
  if (opts.q) {
    const safe = opts.q.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.name = { $regex: safe, $options: "i" };
  }
  const f = products.scope(ctx, filter as never);
  const [items, total] = await Promise.all([
    col.find(f).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    col.countDocuments(f),
  ]);
  return { items, total, page, pageSize };
}
