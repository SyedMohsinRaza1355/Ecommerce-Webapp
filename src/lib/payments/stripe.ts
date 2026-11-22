import { createHmac, timingSafeEqual } from "node:crypto";

// Minimal Stripe REST client (no SDK): the store owner's own secret key is used, so money goes
// straight to the owner's Stripe account and never through the platform.
const API = "https://api.stripe.com/v1";

type Params = Record<string, string | number | boolean | undefined | Record<string, string | number | undefined>>;

function encode(params: Params): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (typeof v === "object") for (const [k2, v2] of Object.entries(v)) { if (v2 !== undefined) out.set(`${k}[${k2}]`, String(v2)); }
    else out.set(k, String(v));
  }
  return out.toString();
}

export class StripeError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function stripeCall<T = Record<string, unknown>>(secretKey: string, method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const body = method === "GET" ? undefined : encode(params);
  const res = await fetch(`${API}${path}${method === "GET" && Object.keys(params).length ? `?${encode(params)}` : ""}`, {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      ...(body !== undefined ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & Record<string, unknown>;
  if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe error ${res.status}`, res.status);
  return json as T;
}

/** Same as stripeCall but takes pre-flattened form fields (needed for line_items[0][price_data]...). */
export async function stripePostRaw<T = Record<string, unknown>>(secretKey: string, path: string, fields: Record<string, string>, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & Record<string, unknown>;
  if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe error ${res.status}`, res.status);
  return json as T;
}

export function looksLikeStripeKey(k: string): boolean {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/.test(k.trim());
}

/** Checks the key against Stripe and returns the account it belongs to. */
export async function describeAccount(secretKey: string) {
  const a = await stripeCall<{ id: string; business_profile?: { name?: string }; settings?: { dashboard?: { display_name?: string } }; email?: string }>(secretKey, "GET", "/account");
  return { id: a.id, name: a.settings?.dashboard?.display_name || a.business_profile?.name || a.email || a.id, livemode: secretKey.includes("_live_") };
}

export async function createCheckoutSession(secretKey: string, o: { orderId: string; orderNo: number; amountMinor: number; currency: string; email: string; attempt: number; successUrl: string; cancelUrl: string; storeName: string; instanceId: string }) {
  return stripePostRaw<{ id: string; url: string }>(secretKey, "/checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": o.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(o.amountMinor),
    "line_items[0][price_data][product_data][name]": `${o.storeName} order #${o.orderNo}`,
    customer_email: o.email,
    client_reference_id: o.orderId,
    "metadata[orderId]": o.orderId,
    "metadata[instanceId]": o.instanceId,
    "payment_intent_data[metadata][orderId]": o.orderId,
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
    expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
  }, `cs-${o.orderId}-${o.amountMinor}-${o.attempt}`);
}

export type CheckoutSessionInfo = { id: string; payment_status: "paid" | "unpaid" | "no_payment_required"; status: "open" | "complete" | "expired"; amount_total: number | null; currency: string | null; payment_intent: string | null; metadata?: Record<string, string> };

export const retrieveCheckoutSession = (key: string, id: string) => stripeCall<CheckoutSessionInfo>(key, "GET", `/checkout/sessions/${encodeURIComponent(id)}`);

export const createRefund = (key: string, paymentIntent: string, amountMinor: number, idempotencyKey: string) =>
  stripePostRaw<{ id: string; status: string }>(key, "/refunds", { payment_intent: paymentIntent, amount: String(amountMinor) }, idempotencyKey);

/** Registers our webhook endpoint in the owner's account; returns the signing secret (shown only once by Stripe). */
export const createWebhookEndpoint = (key: string, url: string) =>
  stripePostRaw<{ id: string; secret: string }>(key, "/webhook_endpoints", {
    url, "enabled_events[0]": "checkout.session.completed", "enabled_events[1]": "checkout.session.expired", "enabled_events[2]": "checkout.session.async_payment_failed", "enabled_events[3]": "checkout.session.async_payment_succeeded",
  });

export const deleteWebhookEndpoint = (key: string, id: string) => stripeCall(key, "DELETE", `/webhook_endpoints/${encodeURIComponent(id)}`).catch(() => undefined);

/** Verifies a Stripe-Signature header (t=...,v1=...) against the raw body with a 5 minute replay window. */
export function verifyStripeSignature(rawBody: string, header: string | null | undefined, whsec: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !whsec) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find((p) => p[0] === "t")?.[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]).filter(Boolean);
  if (!t || !/^\d{1,12}$/.test(t) || !sigs.length) return false;
  if (Math.abs(nowSec - Number(t)) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", whsec).update(`${t}.${rawBody}`).digest("hex"), "hex");
  return sigs.some((s) => {
    if (!/^[0-9a-f]{64}$/.test(s)) return false;
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
