import { randomUUID } from "node:crypto";
import { platformDb } from "@/lib/db/client";
import { tenantDb } from "@/lib/tenant/schema";
import { issueTenantContext, type TenantContext } from "@/lib/tenant/context";
import { getStripeKey, getStripeWebhookSecret } from "@/lib/payments/config";
import { createCheckoutSession, retrieveCheckoutSession, verifyStripeSignature } from "@/lib/payments/stripe";
import { orders, capturePayment, originOf, type Actor, type WebhookResult } from "./orders";
import type { Order } from "./types";

// Real-money payment flows: Stripe (the store owner's own account) and manual methods
// (bank, Easypaisa, JazzCash) that staff confirm by hand.
type NameOf = (instanceId: string) => Promise<string>;

/** Creates a Stripe Checkout page for the order and returns the URL to send the customer to. */
export async function startStripePayment(ctx: TenantContext, orderId: string, sub: string, token: string, storeName: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const order = await orders.findById(ctx, orderId);
  const key = await getStripeKey(ctx);
  if (!order || order.payment.provider !== "stripe" || !key) return { ok: false, error: "Card payment is not set up for this order." };
  if (order.payment.state !== "requires_payment") return { ok: false, error: "This order does not need a payment." };
  try {
    const base = `${originOf()}/s/${sub}`;
    const s = await createCheckoutSession(key, {
      orderId, orderNo: order.orderNo, amountMinor: order.totalMinor, currency: order.currency, email: order.customer.email, storeName, instanceId: ctx.instanceId,
      successUrl: `${base}/order/${token}?return=1`, cancelUrl: `${base}/order/${token}`, attempt: order.payment.attempt ?? 0,
    });
    await orders.updateById(ctx, orderId, { "payment.stripe.sessionId": s.id } as never);
    return { ok: true, url: s.url };
  } catch (e) {
    return { ok: false, error: `The card payment page could not be opened (${(e as Error).message}). Please try again or choose another method.` };
  }
}

type SessionLike = { id: string; payment_status: string; status: string; amount_total: number | null; currency: string | null; payment_intent: string | null };

async function applyStripeSession(ctx: TenantContext, order: Order, cs: SessionLike, by: string, nameOf?: NameOf): Promise<"captured" | "amount_mismatch" | "failed" | "open"> {
  const col = await orders.collection(ctx);
  if (cs.payment_status === "paid") {
    if (cs.amount_total !== order.totalMinor || (cs.currency ?? "").toUpperCase() !== order.currency) {
      await col.updateOne({ _id: order._id, instanceId: ctx.instanceId } as never, { $set: { "flags.amountMismatch": true } } as never);
      return "amount_mismatch";
    }
    await capturePayment(ctx, order, by, nameOf, cs.payment_intent ? { "payment.stripe.paymentIntent": cs.payment_intent } : {});
    return "captured";
  }
  if (cs.status === "expired") {
    const now = new Date();
    await col.updateOne(
      { _id: order._id, instanceId: ctx.instanceId, "payment.state": "requires_payment" } as never,
      { $set: { "payment.state": "failed", updatedAt: now }, $push: { history: { at: now, kind: "payment", from: "requires_payment", to: "failed", by: "stripe" } } } as never,
    );
    return "failed";
  }
  return "open";
}

/** Asks Stripe what happened to the order's checkout session. Makes payment work even if the webhook is delayed or missing. */
export async function reconcileStripePayment(ctx: TenantContext, orderId: string, nameOf?: NameOf): Promise<void> {
  const order = await orders.findById(ctx, orderId);
  const sid = order?.payment.stripe?.sessionId;
  if (!order || order.payment.provider !== "stripe" || !sid || !["requires_payment", "failed"].includes(order.payment.state)) return;
  const key = await getStripeKey(ctx);
  if (!key) return;
  const cs = await retrieveCheckoutSession(key, sid).catch(() => null);
  if (cs) await applyStripeSession(ctx, order, cs, "stripe", nameOf);
}

type StripeEvent = { id?: string; type?: string; data?: { object?: { id?: string; payment_status?: string; status?: string; amount_total?: number | null; currency?: string | null; payment_intent?: string | null; metadata?: Record<string, string> } } };

/** Stripe webhook for one store: verified with that store's own signing secret, deduplicated, amount-checked. */
export async function handleStripeWebhook(instanceId: string, rawBody: string, signature: string | null, nameOf?: NameOf): Promise<WebhookResult> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(instanceId)) return { status: 404, body: { ok: false, reason: "unknown_store" } };
  const inst = await (await platformDb()).collection<{ _id: string }>("instances").findOne({ _id: instanceId }, { projection: { _id: 1 } });
  if (!inst) return { status: 404, body: { ok: false, reason: "unknown_store" } };
  const ctx = issueTenantContext(instanceId);
  const secret = await getStripeWebhookSecret(ctx);
  if (!secret || !verifyStripeSignature(rawBody, signature, secret)) return { status: 400, body: { ok: false, reason: "bad_signature" } };
  let ev: StripeEvent;
  try { ev = JSON.parse(rawBody); } catch { return { status: 400, body: { ok: false, reason: "bad_json" } }; }
  const obj = ev.data?.object;
  if (!ev.id || !ev.type || !obj?.id) return { status: 400, body: { ok: false, reason: "bad_event" } };
  if (!ev.type.startsWith("checkout.session.")) return { status: 200, body: { ok: true } }; // events we did not ask for are acknowledged and ignored
  const db = await tenantDb(ctx);
  try {
    await db.collection("payment_events").insertOne({ _id: randomUUID() as never, instanceId, eventId: ev.id, type: ev.type, at: new Date() });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { status: 200, body: { ok: true, duplicate: true } };
    throw e;
  }
  const order = obj.metadata?.orderId ? await orders.findById(ctx, obj.metadata.orderId) : null;
  if (!order || order.payment.stripe?.sessionId !== obj.id) return { status: 200, body: { ok: true } }; // not one of ours
  const failed = ev.type === "checkout.session.expired" || ev.type === "checkout.session.async_payment_failed";
  const r = await applyStripeSession(ctx, order, {
    id: obj.id, payment_status: failed ? "unpaid" : obj.payment_status ?? "unpaid", status: failed ? "expired" : obj.status ?? "complete",
    amount_total: obj.amount_total ?? null, currency: obj.currency ?? null, payment_intent: obj.payment_intent ?? null,
  }, "stripe", nameOf);
  return r === "amount_mismatch" ? { status: 422, body: { ok: false, reason: "amount_mismatch" } } : { status: 200, body: { ok: true } };
}

// ---------------- manual methods ----------------
/** The customer reports the reference of their transfer; staff then confirm the money arrived. */
export async function reportManualPayment(ctx: TenantContext, orderId: string, reference: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ref = reference.trim();
  if (ref.length < 3 || ref.length > 60 || !/^[A-Za-z0-9 _\-/#.]+$/.test(ref)) return { ok: false, error: "Enter the transaction or reference number from your payment receipt." };
  const r = await (await orders.collection(ctx)).updateOne(
    { _id: orderId, instanceId: ctx.instanceId, "payment.method": "manual", "payment.state": "requires_payment" } as never,
    { $set: { "payment.manual.reference": ref, "payment.manual.reportedAt": new Date(), updatedAt: new Date() } } as never,
  );
  return r.matchedCount === 1 ? { ok: true } : { ok: false, error: "This order is not waiting for a manual payment." };
}

export async function confirmManualPayment(ctx: TenantContext, orderId: string, actor: Actor, nameOf?: NameOf): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!["store_owner", "manager", "super_admin", "cashier"].includes(actor.role)) return { ok: false, error: "Your role cannot confirm payments." };
  const order = await orders.findById(ctx, orderId);
  if (!order || order.payment.method !== "manual") return { ok: false, error: "This is not a manual payment order." };
  if (order.state === "cancelled") return { ok: false, error: "This order was cancelled." };
  const done = await capturePayment(ctx, order, actor.userId, nameOf);
  return done ? { ok: true } : { ok: false, error: "This order is already paid." };
}
