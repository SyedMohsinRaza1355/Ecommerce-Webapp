import { createHash, createHmac, randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { platformDb } from "@/lib/db/client";
import { TenantRepo } from "@/lib/tenant/repo";
import { tenantDb } from "@/lib/tenant/schema";
import { issueTenantContext, type TenantContext } from "@/lib/tenant/context";
import { computeTotals, type Line } from "./pricing";
import { canOrderMove, roleMayMoveOrder, type OrderState } from "./states";
import { signBody, verifySignature, type GatewayEvent } from "./gateway";
import { enqueueEmail, processOutbox } from "./outbox";
import { formatMajor, money } from "@/lib/money/money";
import { notifyLowStock } from "./extras";
import { emitWebhook } from "./integrations";
import { bestPromo, hasHours, isOpenNow, describeHours, listPromos, zoneFor } from "./rules";
import { getPaymentConfig, getStripeKey, getStripeWebhookSecret } from "@/lib/payments/config";
import { createCheckoutSession, createRefund, retrieveCheckoutSession, verifyStripeSignature } from "@/lib/payments/stripe";
import type { Order, Product, Settings } from "./types";

export const orders = new TenantRepo<Order>("orders");
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** Unguessable tracking token derived from a server secret: no sequential id grants access (ADD-015). */
export function trackingTokenFor(instanceId: string, orderId: string): string {
  return createHmac("sha256", env().sessionSecret || "dev").update(`track:${instanceId}:${orderId}`).digest("base64url");
}

export function originOf(): string {
  const base = env().baseDomain;
  return /^(localhost|127\.)/.test(base) ? `http://${base}` : `https://${base}`;
}

/** Absolute link to the store's pages, e.g. https://shop.example/s/demo. */
export async function storeUrlFor(ctx: TenantContext): Promise<string> {
  const inst = await (await platformDb()).collection<{ _id: string; subdomain: string }>("instances").findOne({ _id: ctx.instanceId }, { projection: { subdomain: 1 } });
  return `${originOf()}/s/${inst?.subdomain ?? ""}`;
}

/** Absolute link to the customer's order page, e.g. https://shop.example/s/demo/order/<token>. */
export async function trackUrlFor(ctx: TenantContext, token: string): Promise<string> {
  return `${await storeUrlFor(ctx)}/order/${token}`;
}

export type Features = { shipping: boolean; freeShipping: boolean; tax: boolean; discounts: boolean; cod: boolean; card: boolean; emails: boolean; stockTracking: boolean; manualBank?: boolean; wallet?: boolean; lowStock?: boolean; maintenance?: boolean; autoPromos?: boolean; flashSales?: boolean; couponLimits?: boolean; backorders?: boolean; hours?: boolean; zones?: boolean };

export type PlaceInput = {
  items: { productId: string; qty: number }[];
  customer: Order["customer"];
  /** "card", "cod" or "manual:<methodId>" */
  method: string;
  idempotencyKey: string;
  discountCode?: string;
  customerId?: string;
  /** lets tests pretend it is another time of day */
  now?: Date;
};

export type PlaceResult =
  | { ok: true; orderId: string; orderNo: number; trackingToken: string; needsPayment: boolean; duplicate?: boolean }
  | { ok: false; error: string; code: "validation" | "stock" | "empty" | "method" | "discount" };

const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateCustomer(c: Order["customer"]): string | null {
  if (c.name.trim().length < 2 || c.name.length > 100) return "Enter your full name.";
  if (!EMAIL_RE.test(c.email) || c.email.length > 120) return "Enter a valid email address.";
  if (!PHONE_RE.test(c.phone)) return "Enter a valid phone number.";
  if (c.address.trim().length < 5 || c.address.length > 300) return "Enter your delivery address.";
  if (c.city.trim().length < 2 || c.city.length > 80) return "Enter your city.";
  if ((c.notes ?? "").length > 500) return "Notes can be at most 500 characters.";
  return null;
}

async function nextOrderNo(ctx: TenantContext): Promise<number> {
  const db = await tenantDb(ctx);
  const r = await db.collection<{ _id: string; seq: number }>("counters").findOneAndUpdate(
    { _id: "orderNo" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" },
  );
  return 1000 + (r?.seq ?? 1);
}

async function releaseStock(ctx: TenantContext, items: { productId: string; qty: number }[]) {
  const db = await tenantDb(ctx);
  for (const it of items) {
    await db.collection<Product>("products").updateOne({ _id: it.productId, instanceId: ctx.instanceId, trackStock: true }, { $inc: { stock: it.qty } });
  }
}

/** Atomically reserve stock for every line; roll back everything if any line fails. */
async function reserveStock(ctx: TenantContext, lines: { productId: string; qty: number; tracked: boolean }[]): Promise<string | null> {
  const db = await tenantDb(ctx);
  const done: { productId: string; qty: number }[] = [];
  for (const l of lines) {
    if (!l.tracked) continue;
    const r = await db.collection<Product>("products").updateOne(
      { _id: l.productId, instanceId: ctx.instanceId, status: "published", stock: { $gte: l.qty } },
      { $inc: { stock: -l.qty } },
    );
    if (r.matchedCount !== 1) {
      await releaseStock(ctx, done);
      return l.productId;
    }
    done.push({ productId: l.productId, qty: l.qty });
  }
  return null;
}

export async function placeOrder(ctx: TenantContext, settings: Settings, feat: Features, storeName: string, input: PlaceInput): Promise<PlaceResult> {
  const existing = (await orders.find(ctx, { idempotencyKey: input.idempotencyKey } as never, 1))[0];
  if (existing) {
    return { ok: true, orderId: existing._id, orderNo: existing.orderNo, trackingToken: trackingTokenFor(ctx.instanceId, existing._id), needsPayment: existing.payment.state === "requires_payment", duplicate: true };
  }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.idempotencyKey)) return { ok: false, error: "Invalid request. Please reload the page.", code: "validation" };
  if (feat.maintenance) return { ok: false, error: "The store is temporarily closed for maintenance. Please try again soon.", code: "validation" };
  if (feat.hours && hasHours(settings.hours) && !isOpenNow(settings.hours, input.now)) return { ok: false, error: `We are closed right now and cannot take orders. Opening hours: ${describeHours(settings.hours)}.`, code: "validation" };
  const bad = validateCustomer(input.customer);
  if (bad) return { ok: false, error: bad, code: "validation" };
  const cfg = await getPaymentConfig(ctx);
  let provider: "test" | "stripe" | undefined;
  let manual: NonNullable<Order["payment"]["manual"]> | undefined;
  if (input.method === "card") {
    if (!feat.card || !(cfg.stripe || cfg.testMode)) return { ok: false, error: "Card payment is not available.", code: "method" };
    provider = cfg.stripe ? "stripe" : "test";
  } else if (input.method === "cod") {
    if (!feat.cod) return { ok: false, error: "Cash on delivery is not available.", code: "method" };
  } else if (input.method.startsWith("manual:")) {
    const m = cfg.manual.find((x) => x.id === input.method.slice(7) && x.enabled);
    const allowed = m && (m.kind === "bank" || m.kind === "other" ? feat.manualBank : feat.wallet);
    if (!m || !allowed) return { ok: false, error: "That payment method is not available.", code: "method" };
    manual = { methodId: m.id, label: m.label, kind: m.kind, accountTitle: m.accountTitle, accountNumber: m.accountNumber, instructions: m.instructions };
  } else {
    return { ok: false, error: "Choose a payment method.", code: "method" };
  }
  if (!input.items.length) return { ok: false, error: "Your cart is empty.", code: "empty" };

  // merge duplicate lines, validate quantities
  const qtyBy = new Map<string, number>();
  for (const i of input.items) {
    if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99) return { ok: false, error: "Quantities must be between 1 and 99.", code: "validation" };
    qtyBy.set(i.productId, (qtyBy.get(i.productId) ?? 0) + i.qty);
  }
  const col = await (await tenantDb(ctx)).collection<Product>("products");
  const found = await col.find({ instanceId: ctx.instanceId, _id: { $in: [...qtyBy.keys()] }, status: "published" }).toArray();
  if (found.length !== qtyBy.size) return { ok: false, error: "Some items in your cart are no longer available.", code: "stock" };

  const lines: Line[] = found.map((p) => ({ productId: p._id, name: p.name, unitMinor: p.priceMinor, qty: qtyBy.get(p._id)! }));
  const counts = (p: Product) => feat.stockTracking && p.trackStock && !(feat.backorders && p.backorder);
  for (const p of found) {
    if (counts(p) && p.stock < qtyBy.get(p._id)!) return { ok: false, error: `Only ${p.stock} of "${p.name}" left.`, code: "stock" };
  }

  // discount code (F-053)
  let discountBps = 0;
  let code: string | undefined;
  if (input.discountCode?.trim() && feat.discounts) {
    const c = input.discountCode.trim().toUpperCase();
    const d = await (await tenantDb(ctx)).collection<{ code: string; percentBps: number; active: boolean; maxUses: number | null; used: number; expiresAt: Date | null }>("discounts")
      .findOne({ instanceId: ctx.instanceId, code: c, active: true } as never);
    if (!d || (d.expiresAt && d.expiresAt < new Date()) || (d.maxUses !== null && d.used >= d.maxUses)) {
      return { ok: false, error: "That discount code is not valid.", code: "discount" };
    }
    const per = (d as { perCustomer?: number | null }).perCustomer;
    if (feat.couponLimits && per) {
      if (!input.customerId) return { ok: false, error: "Sign in to your account to use this code.", code: "discount" };
      if ((await orders.count(ctx, { customerId: input.customerId, discountCode: c, state: { $ne: "cancelled" } } as never)) >= per) return { ok: false, error: per === 1 ? "You have already used this code." : `This code can be used ${per} times per customer.`, code: "discount" };
    }
    discountBps = d.percentBps;
    code = c;
  }

  // automatic promotion (F-054, F-056): used only when it beats the code; the code is then not consumed
  const subtotalNow = lines.reduce((n, l) => n + l.unitMinor * l.qty, 0);
  const promo = feat.autoPromos || feat.flashSales
    ? bestPromo(await listPromos(ctx), found.map((p) => ({ productId: p._id, categoryId: p.categoryId ?? null, lineMinor: p.priceMinor * qtyBy.get(p._id)! })), input.now ?? new Date(), { auto: !!feat.autoPromos, flash: !!feat.flashSales })
    : null;
  let fixedDiscount = 0;
  if (promo && promo.discountMinor > Math.round((subtotalNow * discountBps) / 10000)) { fixedDiscount = promo.discountMinor; discountBps = 0; code = undefined; }
  const zone = feat.zones ? zoneFor(settings.zones, input.customer.city) : null;

  const totals = computeTotals(lines, {
    currency: settings.currency, taxBps: settings.taxBps, taxEnabled: feat.tax,
    shippingFlatMinor: feat.shipping ? (zone ? zone.feeMinor : settings.shippingFlatMinor) : 0,
    freeShippingOverMinor: feat.freeShipping ? settings.freeShippingOverMinor : null, discountBps, fixedDiscountMinor: fixedDiscount,
  });

  const tracked = found.map((p) => ({ productId: p._id, qty: qtyBy.get(p._id)!, tracked: counts(p) }));
  const failed = await reserveStock(ctx, tracked);
  if (failed) {
    const name = found.find((p) => p._id === failed)?.name ?? "an item";
    return { ok: false, error: `Sorry, "${name}" just sold out or has too little stock.`, code: "stock" };
  }

  if (feat.lowStock && feat.emails) await notifyLowStock(ctx, tracked.filter((t) => t.tracked), settings.contactEmail || null, storeName).catch(() => undefined);

  // consume the discount atomically (usage limit is race-safe)
  if (code) {
    const r = await (await tenantDb(ctx)).collection("discounts").updateOne(
      { instanceId: ctx.instanceId, code, active: true, $or: [{ maxUses: null }, { $expr: { $lt: ["$used", "$maxUses"] } }] } as never,
      { $inc: { used: 1 } },
    );
    if (r.matchedCount !== 1) {
      await releaseStock(ctx, tracked.filter((t) => t.tracked));
      return { ok: false, error: "That discount code has just been used up.", code: "discount" };
    }
  }

  const id = randomUUID();
  const now = new Date();
  const cod = input.method === "cod";
  const orderNo = await nextOrderNo(ctx);
  const order: Order = {
    _id: id, orderNo, idempotencyKey: input.idempotencyKey, trackingHash: sha(trackingTokenFor(ctx.instanceId, id)),
    items: lines.map((l) => ({ productId: l.productId, name: l.name, unitMinor: l.unitMinor, qty: l.qty, lineMinor: l.unitMinor * l.qty })),
    currency: settings.currency, subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, ...(code ? { discountCode: code } : {}), ...(fixedDiscount && promo ? { promo: { id: promo.promo._id, name: promo.promo.name } } : {}),
    shippingMinor: totals.shippingMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor,
    customer: { ...input.customer, name: input.customer.name.trim(), email: input.customer.email.trim().toLowerCase() },
    state: cod ? "confirmed" : "pending",
    ...(input.customerId ? { customerId: input.customerId } : {}),
    payment: { method: manual ? "manual" : cod ? "cod" : "card", state: cod ? "cod_due" : "requires_payment", ...(provider ? { provider } : {}), ...(manual ? { manual } : {}), refundedMinor: 0, refunds: [] },
    stockReserved: tracked.some((t) => t.tracked),
    history: [{ at: now, kind: "order", to: cod ? "confirmed" : "pending", by: "customer" }],
    createdAt: now, updatedAt: now,
  };

  try {
    await orders.insert(ctx, order as never);
  } catch (e) {
    await releaseStock(ctx, tracked.filter((t) => t.tracked));
    if ((e as { code?: number }).code === 11000) {
      const again = (await orders.find(ctx, { idempotencyKey: input.idempotencyKey } as never, 1))[0];
      if (again) return { ok: true, orderId: again._id, orderNo: again.orderNo, trackingToken: trackingTokenFor(ctx.instanceId, again._id), needsPayment: again.payment.state === "requires_payment", duplicate: true };
    }
    return { ok: false, error: "We could not place your order. Please try again.", code: "validation" };
  }

  const trackingToken = trackingTokenFor(ctx.instanceId, id);
  if (provider === "test") {
    const intentRef = `pi_${randomUUID().replace(/-/g, "")}`;
    await (await platformDb()).collection("payment_intents").insertOne({ _id: intentRef as never, instanceId: ctx.instanceId, orderId: id, amountMinor: totals.totalMinor, currency: settings.currency, createdAt: now });
    await orders.updateById(ctx, id, { "payment.intentRef": intentRef } as never);
  }
  if ((cod || manual) && feat.emails) {
    await enqueueEmail(ctx, "order.placed", order.customer.email, {
      orderNo, storeName, total: `${settings.currency} ${formatMajor(money(totals.totalMinor, settings.currency))}`, trackUrl: await trackUrlFor(ctx, trackingToken),
      ...(manual ? { payTo: `${manual.label}: ${manual.accountTitle}, ${manual.accountNumber}. ${manual.instructions}`.trim() } : {}),
    });
    await processOutbox(ctx).catch(() => undefined);
  }
  await emitWebhook(ctx, "order.created", order);
  return { ok: true, orderId: id, orderNo, trackingToken, needsPayment: input.method !== "cod" };
}

// ---------------- in-store sale (cashier till) ----------------
export type PosInput = {
  items: { productId: string; qty: number }[];
  tender: "cash" | "card" | "wallet";
  receivedMinor?: number;
  customerName?: string;
  idempotencyKey: string;
  discountPercent?: number;
};

export type PosResult = { ok: true; orderId: string; orderNo: number; totalMinor: number; changeMinor: number; duplicate?: boolean } | { ok: false; error: string };

/**
 * A sale at the counter: paid on the spot, so the order is created already completed and captured.
 * It uses the same price, tax, promotion and stock rules as the online shop (no shipping).
 */
export async function placeStaffOrder(ctx: TenantContext, settings: Settings, feat: Features, actor: Actor, input: PosInput): Promise<PosResult> {
  if (!["store_owner", "manager", "cashier", "super_admin"].includes(actor.role)) return { ok: false, error: "Your role cannot make sales." };
  const dup = (await orders.find(ctx, { idempotencyKey: input.idempotencyKey } as never, 1))[0];
  if (dup) return { ok: true, orderId: dup._id, orderNo: dup.orderNo, totalMinor: dup.totalMinor, changeMinor: dup.payment.pos?.changeMinor ?? 0, duplicate: true };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.idempotencyKey)) return { ok: false, error: "Invalid request. Reload the page." };
  if (!["cash", "card", "wallet"].includes(input.tender)) return { ok: false, error: "Choose how the customer paid." };
  if (!input.items.length) return { ok: false, error: "Add something to the sale first." };
  const qtyBy = new Map<string, number>();
  for (const i of input.items) {
    if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99) return { ok: false, error: "Quantities must be between 1 and 99." };
    qtyBy.set(i.productId, (qtyBy.get(i.productId) ?? 0) + i.qty);
  }
  if (input.discountPercent !== undefined && (!Number.isFinite(input.discountPercent) || input.discountPercent < 0 || input.discountPercent > 100)) return { ok: false, error: "A discount must be between 0 and 100 percent." };
  if (input.discountPercent && !["store_owner", "manager", "super_admin"].includes(actor.role)) return { ok: false, error: "Only a manager or the owner can give a discount at the till." };
  const name = (input.customerName ?? "").trim().slice(0, 100) || "Walk-in customer";

  const found = await (await tenantDb(ctx)).collection<Product>("products").find({ instanceId: ctx.instanceId, _id: { $in: [...qtyBy.keys()] }, status: "published" }).toArray();
  if (found.length !== qtyBy.size) return { ok: false, error: "Some items are no longer available. Refresh the till." };
  const counts = (p: Product) => feat.stockTracking && p.trackStock && !(feat.backorders && p.backorder);
  for (const p of found) if (counts(p) && p.stock < qtyBy.get(p._id)!) return { ok: false, error: `Only ${p.stock} of "${p.name}" left.` };

  const lines: Line[] = found.map((p) => ({ productId: p._id, name: p.name, unitMinor: p.priceMinor, qty: qtyBy.get(p._id)! }));
  const promo = feat.autoPromos || feat.flashSales
    ? bestPromo(await listPromos(ctx), found.map((p) => ({ productId: p._id, categoryId: p.categoryId ?? null, lineMinor: p.priceMinor * qtyBy.get(p._id)! })), new Date(), { auto: !!feat.autoPromos, flash: !!feat.flashSales })
    : null;
  const subtotal = lines.reduce((n, l) => n + l.unitMinor * l.qty, 0);
  const manualBps = Math.round((input.discountPercent ?? 0) * 100);
  const useManual = manualBps > 0 && Math.round((subtotal * manualBps) / 10000) >= (promo?.discountMinor ?? 0);
  const totals = computeTotals(lines, {
    currency: settings.currency, taxBps: settings.taxBps, taxEnabled: feat.tax, shippingFlatMinor: 0, freeShippingOverMinor: null,
    discountBps: useManual ? manualBps : 0, fixedDiscountMinor: useManual ? 0 : promo?.discountMinor ?? 0,
  });
  let received = input.receivedMinor ?? totals.totalMinor;
  if (input.tender === "cash") {
    if (!Number.isSafeInteger(received) || received < totals.totalMinor) return { ok: false, error: "The cash received is less than the total." };
  } else received = totals.totalMinor;
  const change = input.tender === "cash" ? received - totals.totalMinor : 0;

  const tracked = found.map((p) => ({ productId: p._id, qty: qtyBy.get(p._id)!, tracked: counts(p) }));
  const failed = await reserveStock(ctx, tracked);
  if (failed) return { ok: false, error: `"${found.find((p) => p._id === failed)?.name ?? "An item"}" just ran out of stock.` };

  const id = randomUUID();
  const now = new Date();
  const orderNo = await nextOrderNo(ctx);
  const order: Order = {
    _id: id, orderNo, idempotencyKey: input.idempotencyKey, trackingHash: sha(trackingTokenFor(ctx.instanceId, id)),
    items: lines.map((l) => ({ productId: l.productId, name: l.name, unitMinor: l.unitMinor, qty: l.qty, lineMinor: l.unitMinor * l.qty })),
    currency: settings.currency, subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor,
    ...(!useManual && promo && totals.discountMinor > 0 ? { promo: { id: promo.promo._id, name: promo.promo.name } } : {}),
    shippingMinor: 0, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor,
    customer: { name, email: "", phone: "", address: "In store", city: "In store" },
    state: "completed", source: "pos", cashierId: actor.userId,
    payment: { method: "pos", state: "captured", pos: { tender: input.tender, ...(input.tender === "cash" ? { receivedMinor: received, changeMinor: change } : {}) }, refundedMinor: 0, refunds: [] },
    stockReserved: false,
    history: [{ at: now, kind: "order", to: "completed", by: actor.userId, note: "in-store sale" }, { at: now, kind: "payment", to: "captured", by: actor.userId, note: `paid by ${input.tender}` }],
    createdAt: now, updatedAt: now,
  };
  try {
    await orders.insert(ctx, order as never);
  } catch (e) {
    await releaseStock(ctx, tracked.filter((t) => t.tracked));
    if ((e as { code?: number }).code === 11000) {
      const again = (await orders.find(ctx, { idempotencyKey: input.idempotencyKey } as never, 1))[0];
      if (again) return { ok: true, orderId: again._id, orderNo: again.orderNo, totalMinor: again.totalMinor, changeMinor: again.payment.pos?.changeMinor ?? 0, duplicate: true };
    }
    return { ok: false, error: "The sale could not be saved. Please try again." };
  }
  await emitWebhook(ctx, "order.created", order);
  await emitWebhook(ctx, "order.paid", order);
  return { ok: true, orderId: id, orderNo, totalMinor: totals.totalMinor, changeMinor: change };
}

// ---------------- gateway webhook ----------------
export type WebhookResult = { status: number; body: { ok: boolean; reason?: string; duplicate?: boolean } };

export async function handleGatewayWebhook(rawBody: string, signature: string | null, storeNameOf?: (instanceId: string) => Promise<string>): Promise<WebhookResult> {
  if (!verifySignature(rawBody, signature)) return { status: 400, body: { ok: false, reason: "bad_signature" } };
  let ev: GatewayEvent;
  try {
    ev = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, reason: "bad_json" } };
  }
  if (!ev || typeof ev.id !== "string" || typeof ev.intentRef !== "string" || !["payment.succeeded", "payment.failed"].includes(ev.type) || !Number.isSafeInteger(ev.amountMinor)) {
    return { status: 400, body: { ok: false, reason: "bad_event" } };
  }
  const intent = await (await platformDb()).collection<{ _id: string; instanceId: string; orderId: string; amountMinor: number; currency: string }>("payment_intents").findOne({ _id: ev.intentRef });
  if (!intent) return { status: 404, body: { ok: false, reason: "unknown_intent" } };
  const ctx = issueTenantContext(intent.instanceId);
  const db = await tenantDb(ctx);

  // dedupe first: replays and retries are safe (NFR-09)
  try {
    await db.collection("payment_events").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, eventId: ev.id, type: ev.type, at: new Date() });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { status: 200, body: { ok: true, duplicate: true } };
    throw e;
  }

  const order = await orders.findById(ctx, intent.orderId);
  if (!order) return { status: 404, body: { ok: false, reason: "unknown_order" } };
  if (ev.amountMinor !== order.totalMinor || ev.currency !== order.currency) {
    await orders.updateById(ctx, order._id, { flags: { ...(order.flags ?? {}), amountMismatch: true } } as never);
    return { status: 422, body: { ok: false, reason: "amount_mismatch" } };
  }

  if (ev.type === "payment.succeeded") {
    await capturePayment(ctx, order, "gateway", storeNameOf);
    return { status: 200, body: { ok: true } };
  }
  const col = await orders.collection(ctx);
  const now = new Date();
  // payment.failed: only meaningful while still waiting for payment (late/out-of-order failures are ignored)
  await col.updateOne(
    { _id: order._id, instanceId: ctx.instanceId, "payment.state": "requires_payment" } as never,
    { $set: { "payment.state": "failed", updatedAt: now }, $push: { history: { at: now, kind: "payment", from: "requires_payment", to: "failed", by: "gateway" } } } as never,
  );
  return { status: 200, body: { ok: true } };
}

/** Marks an order paid exactly once (webhooks, polling and manual confirmation all end up here). */
export async function capturePayment(ctx: TenantContext, order: Order, by: string, storeNameOf?: (instanceId: string) => Promise<string>, extra: Record<string, unknown> = {}): Promise<boolean> {
  const col = await orders.collection(ctx);
  const now = new Date();
  const r = await col.findOneAndUpdate(
    { _id: order._id, instanceId: ctx.instanceId, "payment.state": { $in: ["requires_payment", "failed"] } } as never,
    {
      $set: { "payment.state": "captured", updatedAt: now, ...extra, ...(order.state === "pending" ? { state: "confirmed" } : {}), ...(order.state === "cancelled" ? { "flags.refundRequired": true } : {}) },
      $push: { history: { $each: [{ at: now, kind: "payment", from: order.payment.state, to: "captured", by }, ...(order.state === "pending" ? [{ at: now, kind: "order", from: "pending", to: "confirmed", by }] : [])] } },
    } as never,
    { returnDocument: "after" },
  );
  if (!r) return false;
  const store = storeNameOf ? await storeNameOf(ctx.instanceId) : "Our store";
  await enqueueEmail(ctx, "order.paid", order.customer.email, { orderNo: order.orderNo, storeName: store, trackUrl: await trackUrlFor(ctx, trackingTokenFor(ctx.instanceId, order._id)) });
  await processOutbox(ctx).catch(() => undefined);
  await emitWebhook(ctx, "order.paid", r as unknown as Order);
  return true;
}

/** The mock hosted payment page reports its outcome through the same signed webhook path. */
export async function simulateGatewayOutcome(ctx: TenantContext, orderId: string, outcome: "succeeded" | "failed", storeNameOf?: (id: string) => Promise<string>): Promise<WebhookResult> {
  const order = await orders.findById(ctx, orderId);
  if (!order?.payment.intentRef) return { status: 404, body: { ok: false, reason: "no_intent" } };
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: outcome === "succeeded" ? "payment.succeeded" : "payment.failed", intentRef: order.payment.intentRef, amountMinor: order.totalMinor, currency: order.currency });
  return handleGatewayWebhook(body, signBody(body, Math.floor(Date.now() / 1000)), storeNameOf);
}

/** Customer retries after a failed payment: same order, fresh attempt (no duplicate order or charge). */
export async function retryPayment(ctx: TenantContext, orderId: string): Promise<boolean> {
  const col = await orders.collection(ctx);
  const now = new Date();
  const r = await col.updateOne(
    { _id: orderId, instanceId: ctx.instanceId, state: "pending", "payment.state": "failed" } as never,
    { $set: { "payment.state": "requires_payment", updatedAt: now }, $inc: { "payment.attempt": 1 }, $push: { history: { at: now, kind: "payment", from: "failed", to: "requires_payment", by: "customer" } } } as never,
  );
  return r.matchedCount === 1;
}

// ---------------- staff operations ----------------
export type Actor = { userId: string; role: string };

export async function transitionOrder(ctx: TenantContext, orderId: string, to: OrderState, actor: Actor, notify: { emails: boolean; storeName: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const order = await orders.findById(ctx, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!roleMayMoveOrder(actor.role, to)) return { ok: false, error: "Your role cannot make this change." };
  if (!canOrderMove(order.state, to)) return { ok: false, error: `An order that is "${order.state}" cannot move to "${to}".` };
  if (to === "confirmed" && (order.payment.method === "card" || order.payment.method === "manual") && order.payment.state !== "captured") return { ok: false, error: order.payment.method === "manual" ? "Confirm the payment first (Mark as paid), then the order is confirmed." : "A card order is confirmed automatically once payment arrives." };

  const col = await orders.collection(ctx);
  const now = new Date();
  const set: Record<string, unknown> = { state: to, updatedAt: now };
  if (to === "completed" && order.payment.state === "cod_due") set["payment.state"] = "captured";
  if (to === "cancelled" && ["captured", "partially_refunded"].includes(order.payment.state)) set["flags.refundRequired"] = true;
  const r = await col.updateOne(
    { _id: orderId, instanceId: ctx.instanceId, state: order.state } as never, // stale writes lose
    { $set: set, $push: { history: { at: now, kind: "order", from: order.state, to, by: actor.userId } } } as never,
  );
  if (r.matchedCount !== 1) return { ok: false, error: "This order was just changed by someone else. Reload and try again." };

  if (to === "cancelled") {
    // release stock exactly once, even if two staff cancel at the same time
    const flipped = await col.findOneAndUpdate({ _id: orderId, instanceId: ctx.instanceId, stockReserved: true } as never, { $set: { stockReserved: false } } as never);
    if (flipped) await releaseStock(ctx, order.items.map((i) => ({ productId: i.productId, qty: i.qty })));
    if (notify.emails) await enqueueEmail(ctx, "order.cancelled", order.customer.email, { orderNo: order.orderNo, storeName: notify.storeName });
  } else if (notify.emails && to !== "confirmed") {
    await enqueueEmail(ctx, "order.status", order.customer.email, { orderNo: order.orderNo, storeName: notify.storeName, status: to, trackUrl: await trackUrlFor(ctx, trackingTokenFor(ctx.instanceId, orderId)) });
  }
  await processOutbox(ctx).catch(() => undefined);
  const fresh = await orders.findById(ctx, orderId);
  if (fresh) await emitWebhook(ctx, "order.status", fresh);
  return { ok: true };
}

export async function refundOrder(ctx: TenantContext, orderId: string, amountMinor: number, actor: Actor, key: string, notify: { emails: boolean; storeName: string }): Promise<{ ok: true; duplicate?: boolean } | { ok: false; error: string }> {
  if (!["store_owner", "manager", "super_admin", "cashier"].includes(actor.role)) return { ok: false, error: "Your role cannot issue refunds." };
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { ok: false, error: "Enter a refund amount greater than zero." };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return { ok: false, error: "Invalid request. Reload the page." };
  const order = await orders.findById(ctx, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.payment.refunds.some((r) => r.id === key)) return { ok: true, duplicate: true };
  if (!["captured", "partially_refunded"].includes(order.payment.state)) return { ok: false, error: "Only paid orders can be refunded." };
  const col = await orders.collection(ctx);
  const now = new Date();
  // the filter keeps total refunds <= total paid even with concurrent requests
  const after = await col.findOneAndUpdate(
    { _id: orderId, instanceId: ctx.instanceId, "payment.state": { $in: ["captured", "partially_refunded"] }, "payment.refunds.id": { $ne: key }, "payment.refundedMinor": { $lte: order.totalMinor - amountMinor } } as never,
    { $inc: { "payment.refundedMinor": amountMinor }, $push: { "payment.refunds": { id: key, amountMinor, at: now } } } as never,
    { returnDocument: "after" },
  );
  if (!after) return { ok: false, error: "That amount is more than what is left to refund." };
  if (order.payment.provider === "stripe") {
    // the money really moves: ask Stripe first, undo our record if it refuses
    const pi = order.payment.stripe?.paymentIntent;
    const skey = await getStripeKey(ctx);
    let failure: string | null = null;
    if (!pi || !skey) failure = "This payment is not linked to Stripe, so it cannot be refunded here. Refund it in your Stripe dashboard.";
    else {
      try { await createRefund(skey, pi, amountMinor, `rf-${orderId}-${key}`); } catch (e) { failure = `Stripe could not refund: ${(e as Error).message}`; }
    }
    if (failure) {
      await col.updateOne({ _id: orderId, instanceId: ctx.instanceId } as never, { $inc: { "payment.refundedMinor": -amountMinor }, $pull: { "payment.refunds": { id: key } } } as never);
      return { ok: false, error: failure };
    }
  }
  const full = after.payment.refundedMinor >= after.totalMinor;
  await col.updateOne(
    { _id: orderId, instanceId: ctx.instanceId } as never,
    { $set: { "payment.state": full ? "refunded" : "partially_refunded", updatedAt: now, ...(full ? { "flags.refundRequired": false } : {}) }, $push: { history: { at: now, kind: "payment", from: order.payment.state, to: full ? "refunded" : "partially_refunded", by: actor.userId, note: `refund of ${order.currency} ${formatMajor(money(amountMinor, order.currency))}` } } } as never,
  );
  if (notify.emails) {
    await enqueueEmail(ctx, "order.refunded", order.customer.email, { orderNo: order.orderNo, storeName: notify.storeName, amount: `${order.currency} ${formatMajor(money(amountMinor, order.currency))}` });
    await processOutbox(ctx).catch(() => undefined);
  }
  const fresh = await orders.findById(ctx, orderId);
  if (fresh) await emitWebhook(ctx, "order.refunded", fresh);
  return { ok: true };
}

/** Compensation for abandoned card orders: cancel and give the stock back (DEC-06). */
export const MANUAL_PAYMENT_WINDOW_MS = 3 * 24 * 60 * 60_000;

export async function expireUnpaidOrders(ctx: TenantContext, olderThanMs = 30 * 60_000, now = new Date()): Promise<number> {
  const col = await orders.collection(ctx);
  const cutoff = new Date(now.getTime() - olderThanMs);
  const manualCutoff = new Date(now.getTime() - MANUAL_PAYMENT_WINDOW_MS);
  const stale = await col.find({ instanceId: ctx.instanceId, state: "pending", "payment.state": { $in: ["requires_payment", "failed"] }, $or: [{ "payment.method": { $ne: "manual" }, createdAt: { $lt: cutoff } }, { "payment.method": "manual", createdAt: { $lt: manualCutoff } }] } as never).limit(100).toArray();
  let n = 0;
  for (const o of stale) {
    const r = await col.updateOne(
      { _id: o._id, instanceId: ctx.instanceId, state: "pending", "payment.state": { $in: ["requires_payment", "failed"] } } as never,
      { $set: { state: "cancelled", updatedAt: now }, $push: { history: { at: now, kind: "order", from: "pending", to: "cancelled", by: "system", note: "payment not completed in time" } } } as never,
    );
    if (r.matchedCount !== 1) continue;
    const flipped = await col.findOneAndUpdate({ _id: o._id, instanceId: ctx.instanceId, stockReserved: true } as never, { $set: { stockReserved: false } } as never);
    if (flipped) await releaseStock(ctx, o.items.map((i: { productId: string; qty: number }) => ({ productId: i.productId, qty: i.qty })));
    n++;
  }
  return n;
}

export async function findOrderByToken(ctx: TenantContext, token: string): Promise<Order | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return (await orders.find(ctx, { trackingHash: sha(token) } as never, 1))[0] ?? null;
}

/** Privacy right: remove personal details from a customer's orders while keeping the financial record. */
export async function anonymizeCustomer(ctx: TenantContext, email: string): Promise<number> {
  const col = await orders.collection(ctx);
  const r = await col.updateMany(
    { instanceId: ctx.instanceId, "customer.email": email.trim().toLowerCase() } as never,
    { $set: { customer: { name: "[deleted]", email: "[deleted]", phone: "[deleted]", address: "[deleted]", city: "[deleted]" }, updatedAt: new Date() } } as never,
  );
  return r.modifiedCount;
}
