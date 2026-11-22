import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { rateLimit } from "@/lib/auth/ratelimit";
import { decryptSecret } from "@/lib/crypto/secretbox";
import { enqueueEmail, processOutbox } from "./outbox";
import { orders, originOf } from "./orders";
import { products } from "./store";
import { hasVariantStock } from "./options";
import type { Order, Product } from "./types";

// Growth tools: funnel counts (F-141), quote requests (F-119), returns (F-129), back-in-stock alerts (F-121),
// abandoned-cart emails (F-060), chat alerts (F-103) and draft preview links (F-144).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const db = (ctx: TenantContext) => tenantDb(ctx);
const DAY = 86_400_000;

// ---------------- funnel (F-141) ----------------
export type FunnelKind = "view" | "cart" | "checkout";
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Counts only: no visitor identity is stored. Never blocks or breaks the page. */
export async function recordFunnel(ctx: TenantContext, kind: FunnelKind, now = new Date()): Promise<void> {
  try {
    await (await db(ctx)).collection("funnel").updateOne({ instanceId: ctx.instanceId, day: dayKey(now), kind } as never, { $inc: { n: 1 } }, { upsert: true });
  } catch { /* analytics must never get in the way of a sale */ }
}

export type Funnel = { view: number; cart: number; checkout: number; orders: number; days: number };
export async function funnel(ctx: TenantContext, days = 30, now = new Date()): Promise<Funnel> {
  const since = dayKey(new Date(now.getTime() - (days - 1) * DAY));
  const rows = await (await db(ctx)).collection("funnel").aggregate<{ _id: string; n: number }>([
    { $match: { instanceId: ctx.instanceId, day: { $gte: since } } },
    { $group: { _id: "$kind", n: { $sum: "$n" } } },
  ]).toArray();
  const get = (k: string) => rows.find((r) => r._id === k)?.n ?? 0;
  const placed = await orders.count(ctx, { createdAt: { $gte: new Date(now.getTime() - days * DAY) }, state: { $ne: "cancelled" } } as never);
  return { view: get("view"), cart: get("cart"), checkout: get("checkout"), orders: placed, days };
}

// ---------------- quote requests (F-119) ----------------
export type Quote = { _id: string; productId: string | null; productName: string; name: string; email: string; phone: string; qty: number; message: string; status: "new" | "answered" | "closed"; createdAt: Date };

export async function submitQuote(ctx: TenantContext, i: { productId?: string; name: string; email: string; phone: string; qty: string; message: string; honeypot?: string }, ip: string, notifyTo: string | null, storeName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (i.honeypot) return { ok: true };
  const name = i.name.trim(), email = i.email.trim().toLowerCase(), message = i.message.trim(), phone = i.phone.trim();
  const qty = i.qty.trim() === "" ? 1 : Number(i.qty);
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(email) || email.length > 120) return { ok: false, error: "Enter a valid email address." };
  if (phone.length > 30) return { ok: false, error: "That phone number is too long." };
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return { ok: false, error: "Enter how many you need as a whole number." };
  if (message.length < 5 || message.length > 2000) return { ok: false, error: "Tell us what you need in 5 to 2000 characters." };
  if (!(await rateLimit(`quote:${ctx.instanceId}:${ip}`, 5, 60 * 60_000)).ok) return { ok: false, error: "Too many requests. Please try again later." };
  let productName = "";
  let productId: string | null = null;
  if (i.productId) {
    const p = await products.findById(ctx, i.productId);
    if (p) { productId = p._id; productName = p.name; }
  }
  await (await db(ctx)).collection("quotes").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, productId, productName, name, email, phone, qty, message, status: "new", createdAt: new Date() });
  if (notifyTo) {
    await enqueueEmail(ctx, "contact.message", notifyTo, { storeName, name, email, message: `Quote request${productName ? ` for ${productName}` : ""}, quantity ${qty}${phone ? `, phone ${phone}` : ""}. ${message}` });
    await processOutbox(ctx).catch(() => undefined);
  }
  return { ok: true };
}

export async function listQuotes(ctx: TenantContext): Promise<Quote[]> {
  return (await (await db(ctx)).collection("quotes").find({ instanceId: ctx.instanceId } as never).sort({ createdAt: -1 }).limit(200).toArray()) as unknown as Quote[];
}
export async function setQuoteStatus(ctx: TenantContext, id: string, status: Quote["status"]): Promise<void> {
  if (!["new", "answered", "closed"].includes(status)) return;
  await (await db(ctx)).collection("quotes").updateOne({ _id: id as never, instanceId: ctx.instanceId }, { $set: { status } });
}

// ---------------- returns (F-129) ----------------
export const RETURN_WINDOW_DAYS = 30;
export const RETURN_STATES = ["requested", "approved", "rejected", "received", "refunded"] as const;
export type ReturnState = (typeof RETURN_STATES)[number];
export type ReturnReq = { _id: string; orderId: string; orderNo: number; email: string; kind: "return" | "exchange"; reason: string; state: ReturnState; note: string; createdAt: Date };

export async function requestReturn(ctx: TenantContext, order: Order, kind: string, reasonRaw: string, ip: string, notifyTo: string | null, storeName: string, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = reasonRaw.trim();
  if (kind !== "return" && kind !== "exchange") return { ok: false, error: "Choose return or exchange." };
  if (!["fulfilled", "completed"].includes(order.state)) return { ok: false, error: "You can ask for a return after the order has been delivered." };
  if (now.getTime() - new Date(order.createdAt).getTime() > RETURN_WINDOW_DAYS * DAY) return { ok: false, error: `Returns can be requested within ${RETURN_WINDOW_DAYS} days of the order.` };
  if (reason.length < 5 || reason.length > 1000) return { ok: false, error: "Tell us the reason in 5 to 1000 characters." };
  if (!(await rateLimit(`rma:${ctx.instanceId}:${ip}`, 6, 60 * 60_000)).ok) return { ok: false, error: "Too many requests. Please try again later." };
  const c = (await db(ctx)).collection("returns");
  if (await c.findOne({ instanceId: ctx.instanceId, orderId: order._id, state: { $in: ["requested", "approved", "received"] } } as never)) return { ok: false, error: "A request for this order is already open." };
  await c.insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, orderId: order._id, orderNo: order.orderNo, email: order.customer.email, kind, reason, state: "requested", note: "", createdAt: now });
  if (notifyTo) { await enqueueEmail(ctx, "contact.message", notifyTo, { storeName, name: order.customer.name, email: order.customer.email, message: `${kind === "exchange" ? "Exchange" : "Return"} request for order #${order.orderNo}: ${reason}` }); await processOutbox(ctx).catch(() => undefined); }
  return { ok: true };
}

export async function listReturns(ctx: TenantContext): Promise<ReturnReq[]> {
  return (await (await db(ctx)).collection("returns").find({ instanceId: ctx.instanceId } as never).sort({ createdAt: -1 }).limit(200).toArray()) as unknown as ReturnReq[];
}
export async function returnForOrder(ctx: TenantContext, orderId: string): Promise<ReturnReq | null> {
  return (await (await db(ctx)).collection("returns").find({ instanceId: ctx.instanceId, orderId } as never).sort({ createdAt: -1 }).limit(1).toArray())[0] as unknown as ReturnReq ?? null;
}
export async function setReturnState(ctx: TenantContext, id: string, state: string, note: string, storeName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(RETURN_STATES as readonly string[]).includes(state)) return { ok: false, error: "Unknown status." };
  const r = await (await db(ctx)).collection("returns").findOneAndUpdate({ _id: id as never, instanceId: ctx.instanceId }, { $set: { state, note: note.trim().slice(0, 500) } }, { returnDocument: "after" });
  if (!r) return { ok: false, error: "Request not found." };
  const req = r as unknown as ReturnReq;
  await enqueueEmail(ctx, "return.update", req.email, { storeName, orderNo: req.orderNo, status: state, note: note.trim().slice(0, 500) });
  await processOutbox(ctx).catch(() => undefined);
  return { ok: true };
}

// ---------------- back in stock (F-121) ----------------
export async function subscribeStockAlert(ctx: TenantContext, productId: string, emailRaw: string, ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 120) return { ok: false, error: "Enter a valid email address." };
  if (!(await rateLimit(`bis:${ctx.instanceId}:${ip}`, 10, 60 * 60_000)).ok) return { ok: false, error: "Too many attempts. Try again later." };
  const p = await products.findById(ctx, productId);
  if (!p || p.status !== "published") return { ok: false, error: "That product is not available." };
  const c = (await db(ctx)).collection("stock_alerts");
  if (!(await c.findOne({ instanceId: ctx.instanceId, productId, email, notified: false } as never))) {
    await c.insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, productId, email, notified: false, createdAt: new Date() });
  }
  return { ok: true };
}

export function inStockNow(p: Pick<Product, "trackStock" | "stock" | "options">): boolean {
  const variants = (p.options ?? []).filter((g) => g.kind === "variant");
  if (variants.some((g) => g.choices.some((c) => c.stock != null))) return variants.every((g) => g.choices.some((c) => c.stock == null || c.stock > 0));
  return !p.trackStock || p.stock > 0;
}

/** Emails everyone waiting for a product that is available again. Run by the 15-minute housekeeping job. */
export async function sweepStockAlerts(ctx: TenantContext, base: string, storeName: string): Promise<number> {
  const c = (await db(ctx)).collection("stock_alerts");
  const waiting = await c.find({ instanceId: ctx.instanceId, notified: false } as never).limit(200).toArray();
  if (!waiting.length) return 0;
  const ids = [...new Set(waiting.map((w) => String(w.productId)))];
  const prods = await (await db(ctx)).collection<Product>("products").find({ instanceId: ctx.instanceId, _id: { $in: ids }, status: "published" } as never).toArray();
  const ready = new Map(prods.filter(inStockNow).map((p) => [p._id, p]));
  let n = 0;
  for (const w of waiting) {
    const p = ready.get(String(w.productId));
    if (!p) continue;
    const claim = await c.updateOne({ _id: w._id, notified: false } as never, { $set: { notified: true, notifiedAt: new Date() } });
    if (!claim.modifiedCount) continue;
    await enqueueEmail(ctx, "stock.back", String(w.email), { storeName, product: p.name, url: `${base}/product/${p.slug}` });
    n++;
  }
  if (n) await processOutbox(ctx).catch(() => undefined);
  return n;
}

// ---------------- abandoned carts (F-060) ----------------
/** Remember a signed-in customer's cart so a reminder can be sent if they do not finish. */
export async function saveCartSnapshot(ctx: TenantContext, email: string, cartId: string, now = new Date()): Promise<void> {
  if (!EMAIL_RE.test(email)) return;
  try {
    const c = (await db(ctx)).collection("cart_snapshots");
    const cur = await c.findOne({ instanceId: ctx.instanceId, email } as never);
    const fresh = !cur || cur.cartId !== cartId;
    await c.updateOne({ instanceId: ctx.instanceId, email } as never, { $set: { cartId, updatedAt: now, ...(fresh ? { reminded: false, token: randomBytes(18).toString("base64url") } : {}) }, $setOnInsert: { _id: randomUUID() as never, createdAt: now } } as never, { upsert: true });
  } catch { /* best effort */ }
}

export async function sweepAbandoned(ctx: TenantContext, base: string, storeName: string, now = new Date()): Promise<number> {
  const c = (await db(ctx)).collection("cart_snapshots");
  const due = await c.find({ instanceId: ctx.instanceId, reminded: false, updatedAt: { $lt: new Date(now.getTime() - 60 * 60_000), $gt: new Date(now.getTime() - 3 * DAY) } } as never).limit(50).toArray();
  let n = 0;
  for (const s of due) {
    const claim = await c.updateOne({ _id: s._id, reminded: false } as never, { $set: { reminded: true, remindedAt: now } });
    if (!claim.modifiedCount) continue;
    const since = new Date(s.updatedAt as Date);
    if ((await orders.count(ctx, { "customer.email": s.email, createdAt: { $gte: since } } as never)) > 0) continue; // they already bought
    const items = await (await db(ctx)).collection("carts").findOne({ _id: s.cartId as never, instanceId: ctx.instanceId });
    if (!items || !(items.items as unknown[] | undefined)?.length) continue;
    await enqueueEmail(ctx, "cart.reminder", String(s.email), { storeName, url: `${base}/cart/restore/${s.token}` });
    n++;
  }
  if (n) await processOutbox(ctx).catch(() => undefined);
  return n;
}

/** The cart id behind a reminder link, if the link is still fresh (7 days). */
export async function cartForRestore(ctx: TenantContext, token: string, now = new Date()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const s = await (await db(ctx)).collection("cart_snapshots").findOne({ instanceId: ctx.instanceId, token } as never);
  if (!s || now.getTime() - new Date(s.updatedAt as Date).getTime() > 7 * DAY) return null;
  return String(s.cartId);
}

// ---------------- chat alerts (F-103) ----------------
export async function sendTelegram(tokenEnc: string, chatId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const token = decryptSecret(tokenEnc);
    const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500) }), signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { description?: string };
    return { ok: false, error: j.description ?? `Telegram answered ${r.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "TimeoutError" ? "Telegram did not answer in time." : "Could not reach Telegram." };
  }
}

/** Tell the owner's chat about a new order. Failure is swallowed: an alert must never fail an order. */
export async function notifyOrderChat(ctx: TenantContext, o: Order, storeName: string): Promise<void> {
  try {
    const s = await (await db(ctx)).collection<{ telegram?: { tokenEnc: string; chatId: string }; currency?: string }>("settings").findOne({ instanceId: ctx.instanceId });
    if (!s?.telegram) return;
    const total = `${(o.totalMinor / 100).toFixed(2)} ${o.currency}`;
    const items = o.items.slice(0, 8).map((i) => `${i.qty} x ${i.name}`).join(", ");
    await sendTelegram(s.telegram.tokenEnc, s.telegram.chatId, `New order #${o.orderNo} at ${storeName}\n${total}, ${o.payment.method.toUpperCase()}\n${items}\n${o.customer.name}`);
  } catch { /* ignore */ }
}

// ---------------- draft preview links (F-144) ----------------
export const previewToken = (instanceId: string, productId: string) =>
  createHmac("sha256", process.env.SESSION_SECRET || "dev").update(`preview:${instanceId}:${productId}`).digest("base64url").slice(0, 24);
export function previewOk(instanceId: string, productId: string, given: string | undefined): boolean {
  if (!given) return false;
  const want = Buffer.from(previewToken(instanceId, productId)), got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---------------- receive stock (F-127) ----------------
export async function receiveStock(ctx: TenantContext, codeRaw: string, qtyRaw: string): Promise<{ ok: true; name: string; stock: number } | { ok: false; error: string }> {
  const code = codeRaw.trim();
  const qty = Number(qtyRaw);
  if (!code || code.length > 80) return { ok: false, error: "Scan or type a product code (SKU)." };
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return { ok: false, error: "Enter how many arrived as a whole number." };
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const col = (await db(ctx)).collection<Product>("products");
  const matches = await col.find({ instanceId: ctx.instanceId, sku: { $regex: `^${esc}$`, $options: "i" } } as never).limit(2).toArray();
  if (matches.length === 0) return { ok: false, error: `No product has the code "${code.slice(0, 40)}". Add the code in the product's More section.` };
  if (matches.length > 1) return { ok: false, error: "More than one product has that code. Make each code unique." };
  const p = matches[0];
  if (hasVariantStock(p)) return { ok: false, error: `${p.name} keeps stock per size or colour. Edit it on the product page.` };
  const r = await col.findOneAndUpdate({ _id: p._id, instanceId: ctx.instanceId } as never, { $inc: { stock: qty }, $set: { trackStock: true } }, { returnDocument: "after" });
  return r ? { ok: true, name: r.name, stock: r.stock } : { ok: false, error: "Product not found." };
}

// ---------------- domain health (F-088) ----------------
export type Health = { url: string; ok: boolean; status: number | null; ms: number | null; https: boolean; hsts: boolean; note: string };
export async function checkAddress(url: string): Promise<Health> {
  const https = url.startsWith("https://");
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "Storeforge-health/1.0" } });
    const ms = Date.now() - t0;
    const hsts = Boolean(r.headers.get("strict-transport-security"));
    const ok = r.status < 400;
    return { url, ok, status: r.status, ms, https, hsts, note: ok ? (https ? (hsts ? "Reachable, secure and forces HTTPS." : "Reachable and secure.") : "Reachable, but not using HTTPS.") : `The address answered with an error (${r.status}).` };
  } catch (e) {
    return { url, ok: false, status: null, ms: null, https, hsts: false, note: (e as Error).name === "TimeoutError" ? "No answer within 8 seconds." : "Could not reach the address." };
  }
}
