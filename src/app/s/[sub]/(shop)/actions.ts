"use server";
import { recordFunnel } from "@/lib/commerce/growth";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadStore } from "@/lib/commerce/load";
import { newCartId, setCartQty, clearCart, getCartItems } from "@/lib/commerce/cart";
import { placeOrder, findOrderByToken, simulateGatewayOutcome, retryPayment } from "@/lib/commerce/orders";
import { rateLimit } from "@/lib/auth/ratelimit";
import { isLocale } from "@/lib/i18n";
import { currentCustomer } from "@/lib/commerce/customers";
import { startStripePayment, reportManualPayment } from "@/lib/commerce/payflow";

async function okStore(sub: string) {
  const s = await loadStore(sub);
  if (s.status !== "ok") throw new Error("Store unavailable");
  return s;
}

const cartCookie = (id: string) => `cart_${id}`;

export async function setLocaleAction(sub: string, form: FormData) {
  const s = await okStore(sub);
  const l = String(form.get("locale") ?? "");
  if (isLocale(l)) (await cookies()).set(`locale_${s.instance._id}`, l, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath(`/s/${sub}`, "layout");
}

export type CartState = undefined | { error?: string; message?: string };

export async function addToCartAction(sub: string, productId: string, _prev: CartState, form: FormData): Promise<CartState> {
  const s = await okStore(sub);
  const jar = await cookies();
  let cartId = jar.get(cartCookie(s.instance._id))?.value;
  if (!cartId) {
    cartId = newCartId();
    jar.set(cartCookie(s.instance._id), cartId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 });
  }
  const qty = Number(form.get("qty") ?? 1);
  const sel = [...form.entries()].filter(([k]) => k.startsWith("opt_")).map(([, v]) => String(v)).slice(0, 40);
  const r = await setCartQty(s.ctx, cartId, productId, qty, "add", sel);
  revalidatePath(`/s/${sub}`, "layout");
  if (!r.ok) return { error: r.error };
  if (s.eff.get("F-141")?.enabled === true) await recordFunnel(s.ctx, "cart");
  return { message: r.error ?? "Added to your cart." };
}

/** A cart line is identified by product id plus chosen options, written as "productId|choice,choice". */
function splitKey(key: string): { productId: string; sel: string[] } {
  const [productId = "", rest = ""] = key.split("|");
  return { productId, sel: rest ? rest.split(",").slice(0, 40) : [] };
}

export async function updateCartAction(sub: string, key: string, form: FormData) {
  const s = await okStore(sub);
  const cartId = (await cookies()).get(cartCookie(s.instance._id))?.value;
  if (!cartId) return;
  const act = String(form.get("act") ?? "set");
  const { productId, sel } = splitKey(key);
  await setCartQty(s.ctx, cartId, productId, act === "remove" ? 0 : Number(form.get("qty") ?? 1), "set", sel);
  revalidatePath(`/s/${sub}`, "layout");
}

export type CheckoutState = undefined | { error: string; field?: string; values?: Record<string, string> };

export async function placeOrderAction(sub: string, _prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const s = await okStore(sub);
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const values: Record<string, string> = {};
  for (const k of ["name", "email", "phone", "address", "city", "notes", "method", "discountCode", "giftCode"]) values[k] = String(form.get(k) ?? "");
  if (!(await rateLimit(`checkout:${s.instance._id}:${ip}`, 10, 60_000)).ok) return { error: "Too many attempts. Please wait a minute and try again.", values };

  const jar = await cookies();
  const cartId = jar.get(cartCookie(s.instance._id))?.value;
  const items = await getCartItems(s.ctx, cartId);
  const me = s.eff.get("F-045")?.enabled ? await currentCustomer(s) : null;
  const r = await placeOrder(s.ctx, s.settings, s.feat, s.settings.branding.storeName || s.instance.name, {
    items, method: values.method, customerId: me?._id, giftCode: values.giftCode, useCredit: form.get("useCredit") === "on", usePoints: form.get("usePoints") === "on", fulfilment: { type: (["pickup", "dine_in"].includes(String(form.get("ftype"))) ? String(form.get("ftype")) : "delivery") as "delivery", locationId: String(form.get("locationId") ?? "") || undefined, table: String(form.get("table") ?? "") || undefined, scheduledFor: String(form.get("scheduledFor") ?? "") || undefined }, idempotencyKey: String(form.get("idem") ?? ""), discountCode: values.discountCode || undefined,
    customer: { name: values.name, email: values.email, phone: values.phone, address: values.address, city: values.city, notes: values.notes },
  });
  if (!r.ok) return { error: r.error, values, field: r.code };
  await clearCart(s.ctx, cartId);
  revalidatePath(`/s/${sub}`, "layout");
  redirect(r.needsPayment ? `/s/${sub}/pay/${r.trackingToken}` : `/s/${sub}/order/${r.trackingToken}`);
}

export async function payAction(sub: string, token: string, outcome: "succeeded" | "failed") {
  const s = await okStore(sub);
  const o = await findOrderByToken(s.ctx, token);
  if (!o) redirect(`/s/${sub}`);
  const name = s.settings.branding.storeName || s.instance.name;
  await simulateGatewayOutcome(s.ctx, o._id, outcome, async () => name);
  redirect(`/s/${sub}/order/${token}`);
}

export async function retryPaymentAction(sub: string, token: string) {
  const s = await okStore(sub);
  const o = await findOrderByToken(s.ctx, token);
  if (o && (await retryPayment(s.ctx, o._id))) redirect(`/s/${sub}/pay/${token}`);
  redirect(`/s/${sub}/order/${token}`);
}

export async function stripePayAction(sub: string, token: string) {
  const s = await okStore(sub);
  const o = await findOrderByToken(s.ctx, token);
  if (!o) redirect(`/s/${sub}`);
  if (!(await rateLimit(`stripe-pay:${s.instance._id}:${o._id}`, 10, 10 * 60_000)).ok) redirect(`/s/${sub}/order/${token}`);
  const r = await startStripePayment(s.ctx, o._id, sub, token, s.settings.branding.storeName || s.instance.name);
  if (!r.ok) redirect(`/s/${sub}/pay/${token}?error=${encodeURIComponent(r.error.slice(0, 160))}`);
  redirect(r.url);
}

export async function reportPaymentAction(sub: string, token: string, _p: CartState, form: FormData): Promise<CartState> {
  const s = await okStore(sub);
  const o = await findOrderByToken(s.ctx, token);
  if (!o) return { error: "Order not found." };
  if (!(await rateLimit(`report-pay:${s.instance._id}:${o._id}`, 10, 10 * 60_000)).ok) return { error: "Too many attempts. Please wait a few minutes." };
  const r = await reportManualPayment(s.ctx, o._id, String(form.get("reference") ?? ""));
  revalidatePath(`/s/${sub}/pay/${token}`);
  return r.ok ? { message: "Thank you! We will confirm your payment shortly and email you." } : { error: r.error };
}

// ---------------- newsletter and contact form ----------------
import { subscribeNewsletter, saveContactMessage } from "@/lib/commerce/extras";
import type { AcctState } from "./account/actions";

export async function newsletterAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  if (s.eff.get("F-058")?.enabled !== true) return { error: "Newsletter signup is not available." };
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const r = await subscribeNewsletter(s.ctx, String(form.get("email") ?? ""), ip, { storeName: s.settings.branding.storeName || s.instance.name, welcome: s.feat.emails });
  return r.ok ? { message: "Thanks! You are subscribed." } : { error: r.error };
}

export async function contactAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  if (s.eff.get("F-080")?.enabled === false) return { error: "The contact form is not available." };
  const values = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), message: String(form.get("message") ?? "") };
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const r = await saveContactMessage(s.ctx, { ...values, honeypot: String(form.get("website") ?? "") }, ip, s.settings.contactEmail || null, s.settings.branding.storeName || s.instance.name);
  return r.ok ? { message: "Thank you! Your message was sent. We will reply by email." } : { error: r.error, values };
}

export async function unsubscribeAction(sub: string, email: string, token: string) {
  const s = await okStore(sub);
  const { unsubscribe } = await import("@/lib/commerce/extras");
  const ok = await unsubscribe(s.ctx, email, token);
  redirect(`/s/${sub}/unsubscribe?${ok ? "done=1" : "bad=1"}`);
}

// ---------------- find an order without the link ----------------
import { lookupOrderToken } from "@/lib/commerce/orders";

export async function trackAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const token = await lookupOrderToken(s.ctx, String(form.get("orderNo") ?? ""), String(form.get("email") ?? ""), ip);
  if (!token) return { error: "We could not find an order with that number and email. Check both and try again.", values: { orderNo: String(form.get("orderNo") ?? ""), email: String(form.get("email") ?? "") } };
  redirect(`/s/${sub}/order/${token}`);
}

export async function setQtyAction(sub: string, key: string, qty: number): Promise<void> {
  const { productId, sel } = splitKey(key);
  const s = await okStore(sub);
  const cartId = (await cookies()).get(cartCookie(s.instance._id))?.value;
  if (!cartId || !Number.isInteger(qty)) return;
  await setCartQty(s.ctx, cartId, productId, qty, "set", sel);
  revalidatePath(`/s/${sub}`, "layout");
}

/** Puts the items of an earlier order back in the cart (only items that are still on sale). */
export async function reorderAction(sub: string, orderId: string) {
  const s = await okStore(sub);
  const { currentCustomer } = await import("@/lib/commerce/customers");
  const c = await currentCustomer(s);
  if (!c) redirect(`/s/${sub}/account/login`);
  const { orders } = await import("@/lib/commerce/orders");
  const o = await orders.findById(s.ctx, orderId);
  if (!o || o.customerId !== c._id) redirect(`/s/${sub}/account`);
  const jar = await cookies();
  let cartId = jar.get(cartCookie(s.instance._id))?.value;
  if (!cartId) {
    cartId = newCartId();
    jar.set(cartCookie(s.instance._id), cartId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 });
  }
  for (const i of o.items) await setCartQty(s.ctx, cartId, i.productId, i.qty, "add", i.sel ?? []);
  revalidatePath(`/s/${sub}`, "layout");
  redirect(`/s/${sub}/cart`);
}

// ---------------- compare products (F-122) ----------------
export async function toggleCompareAction(sub: string, productId: string, back: string) {
  const s = await okStore(sub);
  if (s.eff.get("F-122")?.enabled !== true) return;
  const jar = await cookies();
  const name = `cmp_${s.instance._id}`;
  const cur = (jar.get(name)?.value ?? "").split(",").filter((x) => /^[A-Za-z0-9-]{8,60}$/.test(x));
  const next = cur.includes(productId) ? cur.filter((x) => x !== productId) : [...cur, productId].slice(-4);
  jar.set(name, next.join(","), { path: "/", maxAge: 60 * 60 * 24 * 7, sameSite: "lax" });
  redirect(back.startsWith(`/s/${sub}/`) ? back : `/s/${sub}/compare`);
}

// ---------------- growth: stock alerts, quotes, returns ----------------
import { subscribeStockAlert, submitQuote, requestReturn } from "@/lib/commerce/growth";

const ipNow = async () => ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();

export async function stockAlertAction(sub: string, productId: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  if (s.eff.get("F-121")?.enabled !== true) return { error: "Alerts are not available." };
  const r = await subscribeStockAlert(s.ctx, productId, String(form.get("email") ?? ""), await ipNow());
  return r.ok ? { message: "Done. We will email you when it is back." } : { error: r.error, values: { email: String(form.get("email") ?? "") } };
}

export async function quoteAction(sub: string, productId: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  if (s.eff.get("F-119")?.enabled !== true) return { error: "Quote requests are not available." };
  const v = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), phone: String(form.get("phone") ?? ""), qty: String(form.get("qty") ?? ""), message: String(form.get("message") ?? "") };
  const r = await submitQuote(s.ctx, { ...v, productId: productId || undefined, honeypot: String(form.get("website") ?? "") }, await ipNow(), s.settings.contactEmail || null, s.settings.branding.storeName || s.instance.name);
  return r.ok ? { message: "Thank you! We will send you a price by email." } : { error: r.error, values: v };
}

export async function returnAction(sub: string, token: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  if (s.eff.get("F-129")?.enabled !== true) return { error: "Return requests are not available." };
  const o = await findOrderByToken(s.ctx, token);
  if (!o) return { error: "Order not found." };
  const r = await requestReturn(s.ctx, o, String(form.get("kind") ?? ""), String(form.get("reason") ?? ""), await ipNow(), s.settings.contactEmail || null, s.settings.branding.storeName || s.instance.name);
  if (r.ok) revalidatePath(`/s/${sub}/order/${token}`);
  return r.ok ? { message: "Request sent. We will email you with the decision." } : { error: r.error, values: { reason: String(form.get("reason") ?? "") } };
}

import { bookTable, DEFAULT_BOOKING } from "@/lib/commerce/operations";

export async function bookTableAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  if (s.eff.get("F-118")?.enabled !== true) return { error: "Booking is not available." };
  const v = { date: String(form.get("date") ?? ""), time: String(form.get("time") ?? ""), party: String(form.get("party") ?? ""), name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), phone: String(form.get("phone") ?? ""), note: String(form.get("note") ?? "") };
  const r = await bookTable(s.ctx, { ...DEFAULT_BOOKING, ...(s.settings.booking ?? {}) }, v, await ipNow(), { email: s.settings.contactEmail || null, storeName: s.settings.branding.storeName || s.instance.name });
  return r.ok ? { message: "Your table is booked. We sent a confirmation to your email." } : { error: r.error, values: v };
}
