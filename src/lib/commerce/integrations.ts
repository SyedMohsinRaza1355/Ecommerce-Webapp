import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secretbox";
import { backoffMs } from "./outbox";
import type { Order } from "./types";

// Integrations for store owners: outgoing webhooks with a delivery log (F-099, F-142) and
// read-only API keys (F-100). Everything is scoped to one store.

// ---------------- network safety ----------------
/** True for loopback, private, link-local (cloud metadata), CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(a) === 4) {
    const [p, q] = a.split(".").map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19)) || p >= 224;
  }
  if (isIP(a) === 6) {
    if (a === "::" || a === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe[89ab]|ff)/.test(a) || a.startsWith("2001:db8");
  }
  return true; // not an address at all: refuse
}

export async function checkWebhookUrl(raw: string): Promise<string | null> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return "Enter a full address like https://example.com/hooks/orders"; }
  if (u.protocol !== "https:") return "The address must start with https://";
  if (u.username || u.password) return "Do not put a username or password in the address.";
  if (u.port && u.port !== "443") return "Use the standard https port.";
  if (raw.length > 300) return "The address is too long.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "That address points inside a private network.";
  if (isIP(host)) return isPrivateAddress(host) ? "That address points inside a private network." : null;
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((x) => isPrivateAddress(x.address))) return "That address points inside a private network.";
  } catch {
    return "We could not find that website address.";
  }
  return null;
}

// ---------------- outgoing webhooks ----------------
export const WEBHOOK_EVENTS = ["order.created", "order.paid", "order.status", "order.refunded"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_MAX_ATTEMPTS = 6;

type Endpoint = { _id: string; instanceId?: string; url: string; secretEnc: string; events: WebhookEvent[]; active: boolean; createdAt: Date };
type Delivery = { _id: string; instanceId?: string; endpointId: string; event: WebhookEvent; eventId: string; body: string; status: "pending" | "sent" | "dead"; attempts: number; nextAttemptAt: Date; lastStatus?: number; lastError?: string; createdAt: Date; sentAt?: Date };

const eps = async (ctx: TenantContext) => (await tenantDb(ctx)).collection<Endpoint>("webhook_endpoints");
const dels = async (ctx: TenantContext) => (await tenantDb(ctx)).collection<Delivery>("webhook_deliveries");

export async function addEndpoint(ctx: TenantContext, url: string, events: string[]): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const bad = await checkWebhookUrl(url);
  if (bad) return { ok: false, error: bad };
  const chosen = WEBHOOK_EVENTS.filter((e) => events.includes(e));
  if (!chosen.length) return { ok: false, error: "Choose at least one event." };
  if ((await (await eps(ctx)).countDocuments({ instanceId: ctx.instanceId })) >= 5) return { ok: false, error: "You can add up to 5 webhook addresses." };
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await (await eps(ctx)).insertOne({ _id: randomUUID(), instanceId: ctx.instanceId, url: url.trim(), secretEnc: encryptSecret(secret), events: chosen, active: true, createdAt: new Date() });
  return { ok: true, secret };
}

export async function listEndpoints(ctx: TenantContext) {
  return (await (await eps(ctx)).find({ instanceId: ctx.instanceId }).sort({ createdAt: -1 }).limit(10).toArray()).map((e) => ({ id: e._id, url: e.url, events: e.events, active: e.active }));
}

export async function setEndpoint(ctx: TenantContext, id: string, op: "enable" | "disable" | "delete") {
  const c = await eps(ctx);
  if (op === "delete") { await c.deleteOne({ _id: id, instanceId: ctx.instanceId }); await (await dels(ctx)).deleteMany({ instanceId: ctx.instanceId, endpointId: id, status: { $ne: "sent" } }); }
  else await c.updateOne({ _id: id, instanceId: ctx.instanceId }, { $set: { active: op === "enable" } });
}

export function orderPayload(o: Order) {
  return {
    orderNo: o.orderNo, state: o.state, paymentState: o.payment.state, paymentMethod: o.payment.method, currency: o.currency,
    subtotal: o.subtotalMinor / 100, discount: o.discountMinor / 100, shipping: o.shippingMinor / 100, tax: o.taxMinor / 100, total: o.totalMinor / 100, refunded: o.payment.refundedMinor / 100,
    items: o.items.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty, unitPrice: i.unitMinor / 100 })),
    customer: { name: o.customer.name, email: o.customer.email, phone: o.customer.phone, city: o.customer.city, address: o.customer.address }, createdAt: o.createdAt,
  };
}

/** Queues one delivery per matching endpoint. Cheap when the store has none. Never throws into the order flow. */
export async function emitWebhook(ctx: TenantContext, event: WebhookEvent, order: Order): Promise<void> {
  try {
    const db = await tenantDb(ctx);
    const settings = await db.collection<{ ownerToggles?: Record<string, boolean> }>("settings").findOne({ instanceId: ctx.instanceId }, { projection: { ownerToggles: 1 } });
    if (settings?.ownerToggles?.["F-099"] !== true) return;
    const list = await (await eps(ctx)).find({ instanceId: ctx.instanceId, active: true, events: event }).toArray();
    if (!list.length) return;
    const eventId = `evt_${randomUUID().replace(/-/g, "")}`;
    const body = JSON.stringify({ id: eventId, type: event, createdAt: new Date().toISOString(), data: { order: orderPayload(order) } });
    const now = new Date();
    await (await dels(ctx)).insertMany(list.map((e) => ({ _id: randomUUID(), instanceId: ctx.instanceId, endpointId: e._id, event, eventId, body, status: "pending" as const, attempts: 0, nextAttemptAt: now, createdAt: now })));
    await processWebhooks(ctx, { limit: 5 });
  } catch { /* an integration problem must never break an order */ }
}

export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Sends due deliveries with backoff. After 6 failed attempts a delivery is parked as "dead" until the owner replays it. */
export async function processWebhooks(ctx: TenantContext, opts: { limit?: number; now?: Date; send?: (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ status: number }> } = {}) {
  const c = await dels(ctx);
  const now = opts.now ?? new Date();
  const due = await c.find({ instanceId: ctx.instanceId, status: "pending", nextAttemptAt: { $lte: now } }).limit(opts.limit ?? 25).toArray();
  let sent = 0, failed = 0, dead = 0;
  for (const d of due) {
    const claim = await c.findOneAndUpdate({ _id: d._id, instanceId: ctx.instanceId, status: "pending", attempts: d.attempts }, { $inc: { attempts: 1 } }, { returnDocument: "after" });
    if (!claim) continue;
    const ep = await (await eps(ctx)).findOne({ _id: d.endpointId, instanceId: ctx.instanceId });
    let status = 0, error = "";
    try {
      if (!ep || !ep.active) throw new Error("endpoint removed or switched off");
      const bad = await checkWebhookUrl(ep.url); // checked again at send time, not only when it was saved
      if (bad) throw new Error(bad);
      const headers = { "content-type": "application/json", "user-agent": "Storeforge-Webhooks/1", "x-storeforge-event": d.event, "x-storeforge-delivery": d._id, "x-storeforge-signature": signWebhook(decryptSecret(ep.secretEnc), d.body) };
      const res = opts.send ? await opts.send(ep.url, { headers, body: d.body }) : await fetch(ep.url, { method: "POST", headers, body: d.body, redirect: "manual", signal: AbortSignal.timeout(8000) });
      status = res.status;
      if (status < 200 || status >= 300) throw new Error(`the receiver answered ${status}`);
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    if (!error) {
      await c.updateOne({ _id: d._id, instanceId: ctx.instanceId }, { $set: { status: "sent", sentAt: new Date(), lastStatus: status }, $unset: { lastError: "" } });
      sent++;
    } else {
      const isDead = claim.attempts >= WEBHOOK_MAX_ATTEMPTS;
      await c.updateOne({ _id: d._id, instanceId: ctx.instanceId }, { $set: { status: isDead ? "dead" : "pending", nextAttemptAt: new Date(now.getTime() + backoffMs(claim.attempts)), lastError: error, lastStatus: status } });
      isDead ? dead++ : failed++;
    }
  }
  return { sent, failed, dead };
}

export async function recentDeliveries(ctx: TenantContext, limit = 30) {
  return (await (await dels(ctx)).find({ instanceId: ctx.instanceId }).sort({ createdAt: -1 }).limit(limit).toArray()).map((d) => ({ id: d._id, event: d.event, status: d.status, attempts: d.attempts, lastError: d.lastError, lastStatus: d.lastStatus, createdAt: d.createdAt }));
}

/** One-click replay (F-142): the same event body is sent again from scratch. */
export async function replayDelivery(ctx: TenantContext, id: string): Promise<boolean> {
  const r = await (await dels(ctx)).updateOne({ _id: id, instanceId: ctx.instanceId, status: { $in: ["dead", "sent", "pending"] } }, { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date() }, $unset: { lastError: "" } });
  if (r.matchedCount === 1) await processWebhooks(ctx, { limit: 3 });
  return r.matchedCount === 1;
}

// ---------------- API keys (read-only) ----------------
type ApiKey = { _id: string; instanceId?: string; name: string; prefix: string; hash: string; createdAt: Date; lastUsedAt?: Date; revokedAt?: Date | null };
const keys = async (ctx: TenantContext) => (await tenantDb(ctx)).collection<ApiKey>("api_keys");
const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

export async function createApiKey(ctx: TenantContext, name: string): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const n = name.trim();
  if (n.length < 2 || n.length > 40) return { ok: false, error: "Give the key a name (2 to 40 characters), for example Accounting sheet." };
  if ((await (await keys(ctx)).countDocuments({ instanceId: ctx.instanceId, revokedAt: null })) >= 10) return { ok: false, error: "You can have up to 10 active keys." };
  const key = `sfk_${ctx.instanceId}_${randomBytes(30).toString("base64url")}`;
  await (await keys(ctx)).insertOne({ _id: randomUUID(), instanceId: ctx.instanceId, name: n, prefix: key.slice(0, 12), hash: hashKey(key), createdAt: new Date(), revokedAt: null });
  return { ok: true, key };
}

export async function listApiKeys(ctx: TenantContext) {
  return (await (await keys(ctx)).find({ instanceId: ctx.instanceId }).sort({ createdAt: -1 }).limit(20).toArray()).map((k) => ({ id: k._id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revoked: Boolean(k.revokedAt) }));
}

export async function revokeApiKey(ctx: TenantContext, id: string) {
  await (await keys(ctx)).updateOne({ _id: id, instanceId: ctx.instanceId }, { $set: { revokedAt: new Date() } });
}

/** The instance id inside a key only tells us where to look; the secret part must match a stored hash. */
export function instanceIdFromKey(key: string): string | null {
  const m = /^sfk_([A-Za-z0-9-]{6,40})_[A-Za-z0-9_-]{30,60}$/.exec(key);
  return m ? m[1] : null;
}

export async function verifyApiKey(ctx: TenantContext, key: string): Promise<boolean> {
  const k = await (await keys(ctx)).findOneAndUpdate({ instanceId: ctx.instanceId, hash: hashKey(key), revokedAt: null }, { $set: { lastUsedAt: new Date() } });
  return Boolean(k);
}
