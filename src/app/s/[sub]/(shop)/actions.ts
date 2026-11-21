"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadStore } from "@/lib/commerce/load";
import { newCartId, setCartQty, clearCart, getCartItems } from "@/lib/commerce/cart";
import { placeOrder, findOrderByToken, simulateGatewayOutcome, retryPayment } from "@/lib/commerce/orders";
import { rateLimit } from "@/lib/auth/ratelimit";
import { isLocale } from "@/lib/i18n";

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
  const r = await setCartQty(s.ctx, cartId, productId, qty, "add");
  revalidatePath(`/s/${sub}`, "layout");
  if (!r.ok) return { error: r.error };
  return { message: r.error ?? "Added to your cart." };
}

export async function updateCartAction(sub: string, productId: string, form: FormData) {
  const s = await okStore(sub);
  const cartId = (await cookies()).get(cartCookie(s.instance._id))?.value;
  if (!cartId) return;
  const act = String(form.get("act") ?? "set");
  await setCartQty(s.ctx, cartId, productId, act === "remove" ? 0 : Number(form.get("qty") ?? 1), "set");
  revalidatePath(`/s/${sub}`, "layout");
}

export type CheckoutState = undefined | { error: string; field?: string; values?: Record<string, string> };

export async function placeOrderAction(sub: string, _prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const s = await okStore(sub);
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const values: Record<string, string> = {};
  for (const k of ["name", "email", "phone", "address", "city", "notes", "method", "discountCode"]) values[k] = String(form.get(k) ?? "");
  if (!rateLimit(`checkout:${s.instance._id}:${ip}`, 10, 60_000).ok) return { error: "Too many attempts. Please wait a minute and try again.", values };

  const jar = await cookies();
  const cartId = jar.get(cartCookie(s.instance._id))?.value;
  const items = await getCartItems(s.ctx, cartId);
  const method = values.method === "cod" ? "cod" : "card";
  const r = await placeOrder(s.ctx, s.settings, s.feat, s.settings.branding.storeName || s.instance.name, {
    items, method, idempotencyKey: String(form.get("idem") ?? ""), discountCode: values.discountCode || undefined,
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
