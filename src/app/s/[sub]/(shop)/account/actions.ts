"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadStore } from "@/lib/commerce/load";
import {
  addAddress, authenticateCustomer, clearCustomerCookie, consumeCustomerLink, currentCustomer, deleteCustomerAccount, registerCustomer,
  removeAddress, resetPassword, sendCustomerLink, setCustomerCookie, toggleWishlist, updateProfile,
} from "@/lib/commerce/customers";
import { enqueueEmail, processOutbox } from "@/lib/commerce/outbox";
import { storeUrlFor } from "@/lib/commerce/orders";
import { tenantDb } from "@/lib/tenant/schema";
import { rateLimit } from "@/lib/auth/ratelimit";
import { applyReferral } from "@/lib/commerce/rewards";
import { randomUUID } from "node:crypto";

export type AcctState = undefined | { error?: string; message?: string; values?: Record<string, string> };
const fd = (f: FormData, k: string) => String(f.get(k) ?? "");

async function okStore(sub: string) {
  const s = await loadStore(sub);
  if (s.status !== "ok") throw new Error("Store unavailable");
  if (s.eff.get("F-045")?.enabled === false) throw new Error("Accounts are turned off");
  return s;
}
const ipOf = async () => ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
const storeName = (s: Awaited<ReturnType<typeof okStore>>) => s.settings.branding.storeName || s.instance.name;
/** Only same-store relative paths are allowed as a return address, so a link cannot bounce a shopper to another site. */
const safeNext = (sub: string, next: string) => (next.startsWith(`/s/${sub}/`) && !next.includes("//", 1) && !next.includes("\\") ? next : `/s/${sub}/account`);

export async function registerAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  const values = { name: fd(form, "name"), email: fd(form, "email"), phone: fd(form, "phone") };
  if (fd(form, "password") !== fd(form, "confirm")) return { error: "The two passwords do not match.", values };
  const r = await registerCustomer(s.ctx, { ...values, password: fd(form, "password") }, await ipOf());
  if (!r.ok) return { error: r.error, values };
  if (s.feat.referral && fd(form, "ref").trim()) await applyReferral(s.ctx, s.settings, r.customer._id, fd(form, "ref")).catch(() => undefined);
  await setCustomerCookie(s.ctx, r.customer._id);
  if (s.feat.emails) {
    await enqueueEmail(s.ctx, "customer.welcome", r.customer.email, { storeName: storeName(s), name: r.customer.name, url: `${await storeUrlFor(s.ctx)}/account` });
    await processOutbox(s.ctx).catch(() => undefined);
  }
  redirect(safeNext(sub, fd(form, "next")));
}

export async function loginAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  const email = fd(form, "email");
  const r = await authenticateCustomer(s.ctx, email, fd(form, "password"), await ipOf());
  if (!r.ok) return { error: r.error, values: { email } };
  await setCustomerCookie(s.ctx, r.customer._id);
  redirect(safeNext(sub, fd(form, "next")));
}

export async function logoutAction(sub: string) {
  const s = await okStore(sub);
  await clearCustomerCookie(s.ctx);
  revalidatePath(`/s/${sub}`, "layout");
  redirect(`/s/${sub}`);
}

/** Same reply whether or not the email has an account. */
export async function requestLinkAction(sub: string, purpose: "reset" | "signin", _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  if (purpose === "signin" && s.eff.get("F-133")?.enabled === false) return { error: "Sign-in links are turned off for this store." };
  await sendCustomerLink(s.ctx, fd(form, "email"), purpose, storeName(s), await ipOf());
  return { message: "If that email has an account, we have sent a link. Check your inbox (and spam folder)." };
}

export async function resetAction(sub: string, token: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const s = await okStore(sub);
  if (fd(form, "password") !== fd(form, "confirm")) return { error: "The two passwords do not match." };
  const c = await consumeCustomerLink(s.ctx, token, "reset");
  if (!c) return { error: "This link has expired or was already used. Ask for a new one." };
  const r = await resetPassword(s.ctx, c._id, fd(form, "password"));
  if (!r.ok) return { error: r.error }; // the link is spent, the person must request another (safer than keeping it alive)
  await setCustomerCookie(s.ctx, c._id);
  redirect(`/s/${sub}/account`);
}

export async function magicLinkAction(sub: string, token: string) {
  const s = await okStore(sub);
  const c = await consumeCustomerLink(s.ctx, token, "signin");
  if (!c) redirect(`/s/${sub}/account/login?expired=1`);
  await setCustomerCookie(s.ctx, c._id);
  redirect(`/s/${sub}/account`);
}

async function me(sub: string) {
  const s = await okStore(sub);
  const c = await currentCustomer(s);
  if (!c) redirect(`/s/${sub}/account/login`);
  return { s, c };
}

export async function profileAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const { s, c } = await me(sub);
  const r = await updateProfile(s.ctx, c._id, { name: fd(form, "name"), phone: fd(form, "phone") });
  revalidatePath(`/s/${sub}/account`);
  return r.ok ? { message: "Saved." } : { error: r.error };
}

export async function addAddressAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const { s, c } = await me(sub);
  if (s.eff.get("F-046")?.enabled === false) return { error: "Saved addresses are turned off." };
  const r = await addAddress(s.ctx, c._id, { label: fd(form, "label"), address: fd(form, "address"), city: fd(form, "city"), phone: fd(form, "phone") });
  revalidatePath(`/s/${sub}/account`);
  return r.ok ? { message: "Address saved." } : { error: r.error };
}

export async function removeAddressAction(sub: string, addressId: string) {
  const { s, c } = await me(sub);
  await removeAddress(s.ctx, c._id, addressId);
  revalidatePath(`/s/${sub}/account`);
}

export async function wishlistAction(sub: string, productId: string) {
  const { s, c } = await me(sub);
  if (s.eff.get("F-048")?.enabled !== true) return;
  await toggleWishlist(s.ctx, c._id, productId);
  revalidatePath(`/s/${sub}`, "layout");
}

export async function verifyEmailAction(sub: string) {
  const { s, c } = await me(sub);
  await sendCustomerLink(s.ctx, c.email, "signin", storeName(s), await ipOf());
  redirect(`/s/${sub}/account?sent=1`);
}

export async function deleteAccountAction(sub: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const { s, c } = await me(sub);
  if (fd(form, "confirm") !== "DELETE") return { error: "Type DELETE to confirm. This cannot be undone." };
  if (!(await rateLimit(`cust-del:${s.instance._id}:${c._id}`, 3, 60 * 60_000)).ok) return { error: "Too many attempts." };
  await deleteCustomerAccount(s.ctx, c);
  await clearCustomerCookie(s.ctx);
  redirect(`/s/${sub}`);
}

// ---------------- reviews (F-009) ----------------
export async function reviewAction(sub: string, productId: string, _p: AcctState, form: FormData): Promise<AcctState> {
  const { s, c } = await me(sub);
  if (s.eff.get("F-009")?.enabled !== true) return { error: "Reviews are turned off." };
  const rating = Number(fd(form, "rating"));
  const text = fd(form, "text").trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "Choose a rating from 1 to 5 stars." };
  if (text.length > 1000) return { error: "Reviews can be at most 1000 characters." };
  const db = await tenantDb(s.ctx);
  const bought = await db.collection("orders").countDocuments({ instanceId: s.ctx.instanceId, customerId: c._id, "items.productId": productId, state: { $ne: "cancelled" } });
  await db.collection("reviews").updateOne(
    { instanceId: s.ctx.instanceId, productId, customerId: c._id },
    { $set: { rating, text, name: c.name.split(" ")[0], verifiedBuyer: bought > 0, status: "published", updatedAt: new Date() }, $setOnInsert: { _id: randomUUID(), createdAt: new Date() } } as never,
    { upsert: true },
  );
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Thanks for your review!" };
}
