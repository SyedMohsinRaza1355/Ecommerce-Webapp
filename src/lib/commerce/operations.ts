import { randomUUID } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { rateLimit } from "@/lib/auth/ratelimit";
import { enqueueEmail, processOutbox } from "./outbox";
import { APP_TIMEZONE } from "@/lib/i18n";
import type { Product } from "./types";

// Back-of-house tools: suppliers and purchase orders (F-025) and table booking (F-118).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const db = (ctx: TenantContext) => tenantDb(ctx);

// ---------------- suppliers and purchase orders ----------------
export type Supplier = { _id: string; name: string; phone: string; email: string; note: string; createdAt: Date };
export type POLine = { productId: string; name: string; sku: string; qty: number; costMinor: number };
export type PurchaseOrder = { _id: string; no: number; supplierId: string; supplierName: string; lines: POLine[]; totalMinor: number; status: "draft" | "ordered" | "received" | "cancelled"; note: string; createdAt: Date; receivedAt?: Date };

export async function saveSupplier(ctx: TenantContext, i: { id?: string; name: string; phone: string; email: string; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = i.name.trim(), email = i.email.trim().toLowerCase(), phone = i.phone.trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the supplier's name." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That email address does not look right." };
  if (phone.length > 30) return { ok: false, error: "That phone number is too long." };
  const c = (await db(ctx)).collection("suppliers");
  if (!i.id && (await c.countDocuments({ instanceId: ctx.instanceId })) >= 200) return { ok: false, error: "That is the most suppliers one store can keep (200)." };
  if (i.id) await c.updateOne({ _id: i.id as never, instanceId: ctx.instanceId }, { $set: { name, phone, email, note: i.note.trim().slice(0, 300) } });
  else await c.insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, name, phone, email, note: i.note.trim().slice(0, 300), createdAt: new Date() });
  return { ok: true };
}
export async function listSuppliers(ctx: TenantContext): Promise<Supplier[]> {
  return (await (await db(ctx)).collection("suppliers").find({ instanceId: ctx.instanceId } as never).sort({ name: 1 }).limit(200).toArray()) as unknown as Supplier[];
}
export async function deleteSupplier(ctx: TenantContext, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await (await db(ctx)).collection("purchase_orders").findOne({ instanceId: ctx.instanceId, supplierId: id, status: { $in: ["draft", "ordered"] } } as never)) return { ok: false, error: "This supplier has open purchase orders. Receive or cancel them first." };
  await (await db(ctx)).collection("suppliers").deleteOne({ _id: id as never, instanceId: ctx.instanceId });
  return { ok: true };
}

/** Lines are written "SKU x quantity @ unit cost", one per line, for example "BRG-CLS x 20 @ 300". */
export async function createPurchaseOrder(ctx: TenantContext, i: { supplierId: string; text: string; note: string }, toMinor: (s: string) => number): Promise<{ ok: true; no: number } | { ok: false; error: string }> {
  const sup = await (await db(ctx)).collection("suppliers").findOne({ _id: i.supplierId as never, instanceId: ctx.instanceId }) as unknown as Supplier | null;
  if (!sup) return { ok: false, error: "Choose a supplier." };
  const rows = i.text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return { ok: false, error: "Add at least one line, like  BRG-CLS x 20 @ 300." };
  if (rows.length > 40) return { ok: false, error: "At most 40 lines per purchase order." };
  const lines: POLine[] = [];
  for (const row of rows) {
    const m = /^(.+?)\s*x\s*(\d{1,6})\s*@\s*([\d.,]+)$/i.exec(row);
    if (!m) return { ok: false, error: `Line "${row.slice(0, 40)}": write it as  SKU x quantity @ unit cost.` };
    let cost = NaN;
    try { cost = toMinor(m[3].replace(/,/g, "")); } catch { /* handled below */ }
    const qty = Number(m[2]);
    if (!Number.isInteger(cost) || cost < 0 || qty < 1) return { ok: false, error: `Line "${row.slice(0, 40)}": check the quantity and cost.` };
    const esc = m[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = await (await db(ctx)).collection<Product>("products").find({ instanceId: ctx.instanceId, sku: { $regex: `^${esc}$`, $options: "i" } } as never).limit(2).toArray();
    if (found.length !== 1) return { ok: false, error: found.length ? `More than one product has the code "${m[1].trim().slice(0, 30)}".` : `No product has the code "${m[1].trim().slice(0, 30)}".` };
    lines.push({ productId: found[0]._id, name: found[0].name, sku: found[0].sku ?? "", qty, costMinor: cost });
  }
  const no = ((await (await db(ctx)).collection<{ _id: string; seq: number }>("counters").findOneAndUpdate({ _id: "poNo" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }))?.seq) ?? 1;
  await (await db(ctx)).collection("purchase_orders").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, no, supplierId: sup._id, supplierName: sup.name, lines, totalMinor: lines.reduce((n, l) => n + l.qty * l.costMinor, 0), status: "draft", note: i.note.trim().slice(0, 300), createdAt: new Date() });
  return { ok: true, no };
}
export async function listPurchaseOrders(ctx: TenantContext): Promise<PurchaseOrder[]> {
  return (await (await db(ctx)).collection("purchase_orders").find({ instanceId: ctx.instanceId } as never).sort({ no: -1 }).limit(100).toArray()) as unknown as PurchaseOrder[];
}
/** draft -> ordered, draft/ordered -> cancelled. Receiving has its own function because it moves stock. */
export async function setPurchaseOrderStatus(ctx: TenantContext, id: string, to: "ordered" | "cancelled"): Promise<{ ok: true } | { ok: false; error: string }> {
  const from = to === "ordered" ? ["draft"] : ["draft", "ordered"];
  const r = await (await db(ctx)).collection("purchase_orders").updateOne({ _id: id as never, instanceId: ctx.instanceId, status: { $in: from } } as never, { $set: { status: to } });
  return r.matchedCount ? { ok: true } : { ok: false, error: "That purchase order cannot change like that." };
}
/** Adds the delivered quantities to stock, exactly once (the status flip is the lock). */
export async function receivePurchaseOrder(ctx: TenantContext, id: string): Promise<{ ok: true; units: number } | { ok: false; error: string }> {
  const po = await (await db(ctx)).collection("purchase_orders").findOneAndUpdate({ _id: id as never, instanceId: ctx.instanceId, status: "ordered" } as never, { $set: { status: "received", receivedAt: new Date() } }, { returnDocument: "before" }) as unknown as PurchaseOrder | null;
  if (!po) return { ok: false, error: "Only an ordered purchase order can be received." };
  let units = 0;
  for (const l of po.lines) {
    await (await db(ctx)).collection("products").updateOne({ _id: l.productId as never, instanceId: ctx.instanceId }, { $inc: { stock: l.qty }, $set: { trackStock: true } });
    units += l.qty;
  }
  return { ok: true, units };
}

// ---------------- table booking ----------------
export type BookingConfig = { capacity: number; maxParty: number; from: string; to: string; slotMinutes: number; daysAhead: number };
export const DEFAULT_BOOKING: BookingConfig = { capacity: 6, maxParty: 10, from: "12:00", to: "22:00", slotMinutes: 60, daysAhead: 14 };
export type Booking = { _id: string; date: string; time: string; party: number; name: string; email: string; phone: string; note: string; status: "confirmed" | "cancelled" | "seated" | "no_show"; createdAt: Date };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function validateBookingConfig(c: BookingConfig): string | null {
  if (!Number.isInteger(c.capacity) || c.capacity < 1 || c.capacity > 200) return "Tables per time slot must be 1 to 200.";
  if (!Number.isInteger(c.maxParty) || c.maxParty < 1 || c.maxParty > 50) return "Largest group must be 1 to 50.";
  if (![30, 45, 60, 90, 120].includes(c.slotMinutes)) return "Slot length must be 30, 45, 60, 90 or 120 minutes.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.to)) return "Use times like 12:00.";
  if (toMin(c.to) <= toMin(c.from)) return "The last booking time must be after the first.";
  if (!Number.isInteger(c.daysAhead) || c.daysAhead < 1 || c.daysAhead > 60) return "Days ahead must be 1 to 60.";
  return null;
}

export const slotTimes = (c: BookingConfig): string[] => { const out: string[] = []; for (let m = toMin(c.from); m <= toMin(c.to); m += c.slotMinutes) out.push(hhmm(m)); return out; };

/** The shop's local date (YYYY-MM-DD) and minutes since midnight. */
export function localNow(now: Date): { date: string; minutes: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}
export function bookableDates(c: BookingConfig, now: Date): string[] {
  const { date } = localNow(now);
  const base = new Date(`${date}T12:00:00Z`);
  return Array.from({ length: c.daysAhead + 1 }, (_, i) => new Date(base.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

export async function bookTable(ctx: TenantContext, c: BookingConfig, i: { date: string; time: string; party: string; name: string; email: string; phone: string; note: string; honeypot?: string }, ip: string, owner: { email: string | null; storeName: string }, now = new Date()): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (i.honeypot) return { ok: true, id: "" };
  const name = i.name.trim(), email = i.email.trim().toLowerCase(), phone = i.phone.trim(), party = Number(i.party);
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(email) || email.length > 120) return { ok: false, error: "Enter a valid email so we can confirm." };
  if (phone.length < 6 || phone.length > 30) return { ok: false, error: "Enter a phone number we can reach you on." };
  if (!Number.isInteger(party) || party < 1 || party > c.maxParty) return { ok: false, error: `We seat groups of 1 to ${c.maxParty}. For larger groups please call us.` };
  if (!bookableDates(c, now).includes(i.date)) return { ok: false, error: `Choose a date in the next ${c.daysAhead} days.` };
  if (!slotTimes(c).includes(i.time)) return { ok: false, error: "Choose one of the listed times." };
  const here = localNow(now);
  if (i.date === here.date && toMin(i.time) < here.minutes + 30) return { ok: false, error: "That time is too soon. Please choose a later one or call us." };
  if (!(await rateLimit(`book:${ctx.instanceId}:${ip}`, 6, 60 * 60_000)).ok) return { ok: false, error: "Too many requests. Please try again later." };
  // one counter per time slot: "only if a table is still free" is a single atomic step, so two people cannot take the last table
  const slot = `${ctx.instanceId}|${i.date}|${i.time}`;
  const slots = (await db(ctx)).collection<{ _id: string; n: number }>("booking_slots");
  try {
    const took = await slots.findOneAndUpdate({ _id: slot, n: { $lt: c.capacity } }, { $inc: { n: 1 } }, { upsert: true, returnDocument: "after" });
    if (!took) return { ok: false, error: "That time is fully booked. Please try another." };
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { ok: false, error: "That time is fully booked. Please try another." };
    throw e;
  }
  const id = randomUUID();
  await (await db(ctx)).collection("bookings").insertOne({ _id: id as never, instanceId: ctx.instanceId, date: i.date, time: i.time, party, name, email, phone, note: i.note.trim().slice(0, 300), status: "confirmed", createdAt: now });
  await enqueueEmail(ctx, "booking.confirmed", email, { storeName: owner.storeName, name, date: i.date, time: i.time, party });
  if (owner.email) await enqueueEmail(ctx, "contact.message", owner.email, { storeName: owner.storeName, name, email, message: `Table booking: ${party} people on ${i.date} at ${i.time}. Phone ${phone}. ${i.note.trim().slice(0, 300)}` });
  await processOutbox(ctx).catch(() => undefined);
  return { ok: true, id };
}

export async function listBookings(ctx: TenantContext, fromDate: string): Promise<Booking[]> {
  return (await (await db(ctx)).collection("bookings").find({ instanceId: ctx.instanceId, date: { $gte: fromDate } } as never).sort({ date: 1, time: 1 }).limit(300).toArray()) as unknown as Booking[];
}
export async function setBookingStatus(ctx: TenantContext, id: string, to: Booking["status"], storeName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!["cancelled", "seated", "no_show"].includes(to)) return { ok: false, error: "Unknown status." };
  const c = (await db(ctx)).collection("bookings");
  const b = await c.findOneAndUpdate({ _id: id as never, instanceId: ctx.instanceId, status: "confirmed" } as never, { $set: { status: to } }, { returnDocument: "before" }) as unknown as Booking | null;
  if (!b) return { ok: false, error: "Only a confirmed booking can change." };
  if (to === "cancelled") {
    await (await db(ctx)).collection("booking_slots").updateOne({ _id: `${ctx.instanceId}|${b.date}|${b.time}` as never, n: { $gt: 0 } } as never, { $inc: { n: -1 } });
    await enqueueEmail(ctx, "booking.cancelled", b.email, { storeName, name: b.name, date: b.date, time: b.time });
    await processOutbox(ctx).catch(() => undefined);
  }
  return { ok: true };
}
