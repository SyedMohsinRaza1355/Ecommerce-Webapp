import { randomUUID } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { APP_TIMEZONE } from "@/lib/i18n";
import { DAYS, type Day, type Settings } from "./types";

// Store rules: automatic promotions and flash sales (F-054, F-056), opening hours (F-018),
// delivery zones (F-071). Pure functions where possible so they are easy to test.

// ---------------- promotions ----------------
export type Promo = {
  _id: string;
  instanceId?: string;
  name: string;
  kind: "auto" | "flash" | "bxgy";
  /** buy X get Y free (F-055): the product, how many to buy, how many are free */
  productId?: string | null;
  buyQty?: number;
  getQty?: number;
  percentBps: number;
  /** auto promotions: the basket must reach this subtotal */
  minSubtotalMinor: number;
  /** flash sales may be limited to one category */
  categoryId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  createdAt: Date;
};

export type PromoLine = { productId: string; categoryId: string | null; lineMinor: number; qty?: number; unitMinor?: number };

export type PromoResult = { promo: Pick<Promo, "_id" | "name" | "kind">; discountMinor: number } | null;

const inWindow = (p: Promo, now: Date) => (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt > now);

/** The single best promotion for a basket (promotions never stack with each other). */
export function bestPromo(promos: Promo[], lines: PromoLine[], now: Date, on: { auto: boolean; flash: boolean; bxgy?: boolean }): PromoResult {
  const subtotal = lines.reduce((n, l) => n + l.lineMinor, 0);
  let best: PromoResult = null;
  for (const p of promos) {
    if (!p.active || !inWindow(p, now)) continue;
    let base = 0;
    if (p.kind === "bxgy") {
      if (!on.bxgy || !p.productId || !p.buyQty || !p.getQty) continue;
      const group = p.buyQty + p.getQty;
      const d = Math.min(lines.filter((l) => l.productId === p.productId).reduce((n, l) => n + Math.floor((l.qty ?? 0) / group) * p.getQty! * (l.unitMinor ?? 0), 0), subtotal);
      if (d > 0 && (!best || d > best.discountMinor)) best = { promo: { _id: p._id, name: p.name, kind: p.kind }, discountMinor: d };
      continue;
    }
    if (p.kind === "auto") {
      if (!on.auto || subtotal < p.minSubtotalMinor) continue;
      base = subtotal;
    } else {
      if (!on.flash) continue;
      base = lines.filter((l) => !p.categoryId || l.categoryId === p.categoryId).reduce((n, l) => n + l.lineMinor, 0);
    }
    const d = Math.min(Math.round((base * p.percentBps) / 10000), subtotal);
    if (d > 0 && (!best || d > best.discountMinor)) best = { promo: { _id: p._id, name: p.name, kind: p.kind }, discountMinor: d };
  }
  return best;
}

export async function listPromos(ctx: TenantContext): Promise<Promo[]> {
  return (await (await tenantDb(ctx)).collection<Promo>("promotions").find({ instanceId: ctx.instanceId } as never).sort({ createdAt: -1 }).limit(100).toArray()) as Promo[];
}

export async function savePromo(ctx: TenantContext, i: { name: string; kind: string; percent: string; min: string; categoryId: string; startsAt: string; endsAt: string; productId?: string; buyQty?: string; getQty?: string }, currency: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = i.name.trim();
  if (name.length < 2 || name.length > 60) return { ok: false, error: "Give the promotion a name (2 to 60 characters)." };
  if (i.kind !== "auto" && i.kind !== "flash" && i.kind !== "bxgy") return { ok: false, error: "Choose a promotion type." };
  if (i.kind === "bxgy") {
    const buy = Number(i.buyQty), get = Number(i.getQty);
    if (!Number.isInteger(buy) || buy < 1 || buy > 20 || !Number.isInteger(get) || get < 1 || get > 20) return { ok: false, error: "Buy and free quantities must be whole numbers from 1 to 20." };
    const prod = i.productId ? await (await tenantDb(ctx)).collection("products").findOne({ _id: i.productId as never, instanceId: ctx.instanceId }) : null;
    if (!prod) return { ok: false, error: "Choose the product this offer is for." };
    const bs = i.startsAt ? new Date(i.startsAt) : null, be = i.endsAt ? new Date(i.endsAt) : null;
    if ((bs && Number.isNaN(+bs)) || (be && Number.isNaN(+be)) || (bs && be && be <= bs)) return { ok: false, error: "Enter valid dates; the end must be after the start." };
    await (await tenantDb(ctx)).collection("promotions").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, name, kind: "bxgy", percentBps: 0, minSubtotalMinor: 0, categoryId: null, productId: i.productId, buyQty: buy, getQty: get, startsAt: bs, endsAt: be, active: true, createdAt: new Date() });
    return { ok: true };
  }
  const pct = parseFloat(i.percent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 90) return { ok: false, error: "Percent off must be between 1 and 90." };
  let min = 0;
  if (i.kind === "auto" && i.min.trim()) {
    const { parseMajor } = await import("@/lib/money/money");
    try { min = parseMajor(i.min.trim(), currency).minor; } catch { return { ok: false, error: "Enter the minimum basket like 2000 or 1999.50." }; }
    if (min < 0) return { ok: false, error: "The minimum cannot be negative." };
  }
  const startsAt = i.startsAt ? new Date(i.startsAt) : null;
  const endsAt = i.endsAt ? new Date(i.endsAt) : null;
  if ((startsAt && Number.isNaN(+startsAt)) || (endsAt && Number.isNaN(+endsAt))) return { ok: false, error: "Enter valid dates." };
  if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, error: "The end must be after the start." };
  if (i.kind === "flash" && !endsAt) return { ok: false, error: "A flash sale needs an end date and time." };
  await (await tenantDb(ctx)).collection("promotions").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, name, kind: i.kind, percentBps: Math.round(pct * 100), minSubtotalMinor: min, categoryId: i.kind === "flash" ? i.categoryId || null : null, startsAt, endsAt, active: true, createdAt: new Date() });
  return { ok: true };
}

export async function setPromoActive(ctx: TenantContext, id: string, active: boolean | "delete") {
  const c = (await tenantDb(ctx)).collection("promotions");
  if (active === "delete") await c.deleteOne({ _id: id as never, instanceId: ctx.instanceId });
  else await c.updateOne({ _id: id as never, instanceId: ctx.instanceId }, { $set: { active } });
}

// ---------------- opening hours ----------------
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function validateHours(h: NonNullable<Settings["hours"]>): string | null {
  for (const d of DAYS) {
    const v = h[d];
    if (!v) continue;
    if (!TIME_RE.test(v.open) || !TIME_RE.test(v.close)) return "Use times like 09:00 and 22:30.";
    if (v.open === v.close) return "Opening and closing time cannot be the same.";
  }
  return null;
}

function localParts(now: Date, tz: string): { day: Day; minutes: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { day: get("weekday").slice(0, 3).toLowerCase() as Day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Hours only apply once at least one day is set; days left empty then count as closed. */
export function hasHours(h: Settings["hours"]): boolean {
  return !!h && DAYS.some((d) => h[d]);
}

export function isOpenNow(h: Settings["hours"], now = new Date(), tz = APP_TIMEZONE): boolean {
  if (!hasHours(h)) return true;
  const { day, minutes } = localParts(now, tz);
  const today = h![day];
  if (today) {
    const o = toMin(today.open), c = toMin(today.close);
    if (c > o ? minutes >= o && minutes < c : minutes >= o) return true; // overnight: open until midnight here
  }
  const prev = h![DAYS[(DAYS.indexOf(day) + 6) % 7]];
  if (prev && toMin(prev.close) <= toMin(prev.open) && minutes < toMin(prev.close)) return true; // spill-over after midnight
  return false;
}

export function describeHours(h: Settings["hours"]): string {
  if (!hasHours(h)) return "";
  const names: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  return DAYS.map((d) => `${names[d]} ${h![d] ? `${h![d]!.open}-${h![d]!.close}` : "closed"}`).join(", ");
}

// ---------------- delivery zones ----------------
export function zoneFor(zones: Settings["zones"], city: string) {
  const c = city.trim().toLowerCase();
  return c ? (zones ?? []).find((z) => z.cities.some((x) => x.trim().toLowerCase() === c)) ?? null : null;
}

export function validateZones(zones: { name: string; cities: string[]; feeMinor: number }[]): string | null {
  if (zones.length > 20) return "At most 20 zones.";
  const seen = new Set<string>();
  for (const z of zones) {
    if (z.name.trim().length < 1 || z.name.length > 40) return "Give every zone a name.";
    if (!z.cities.length) return `Zone "${z.name}" needs at least one city.`;
    if (!Number.isSafeInteger(z.feeMinor) || z.feeMinor < 0) return "Fees cannot be negative.";
    for (const c of z.cities) {
      const k = c.trim().toLowerCase();
      if (!k || k.length > 60) return "City names must be 1 to 60 characters.";
      if (seen.has(k)) return `"${c}" is in more than one zone.`;
      seen.add(k);
    }
  }
  return null;
}
