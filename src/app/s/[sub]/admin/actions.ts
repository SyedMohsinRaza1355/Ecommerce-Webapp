"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { signSession } from "@/lib/auth/session";
import { authenticateStaff, beginTotpEnrollment, confirmTotpEnrollment, inviteStaff, changeStaff, setOwnPassword } from "@/lib/commerce/staff";
import { loadStore, STORE_COOKIE } from "@/lib/commerce/load";
import { guard, guardSoft, record } from "@/lib/commerce/guard";
import { appendAudit } from "@/lib/audit/log";
import { categories, products, createProduct, updateProduct, ProductInput, BrandingInput, CommerceInput, saveBranding, saveCommerce, slugify } from "@/lib/commerce/store";
import { transitionOrder, refundOrder, anonymizeCustomer, expireUnpaidOrders, type Features } from "@/lib/commerce/orders";
import { processOutbox } from "@/lib/commerce/outbox";
import { setOwnerFeature, undoChange } from "@/lib/commerce/features";
import { tenantDb } from "@/lib/tenant/schema";
import { ORDER_STATES, type OrderState } from "@/lib/commerce/states";
import { parseMajor } from "@/lib/money/money";
import { validatePasswordStrength } from "@/lib/auth/password";
import { clearResolutionCache } from "@/lib/tenant/resolve";
import { bumpInstance } from "@/lib/platform/manage";
import { clearToggleCache } from "@/lib/toggles/service";
import { rateLimit } from "@/lib/auth/ratelimit";

export type AdminState = undefined | { error?: string; message?: string; link?: string; secret?: string; fields?: Record<string, string> };

const home = (sub: string) => `/s/${sub}/admin`;
const fd = (f: FormData, k: string) => String(f.get(k) ?? "");

// ---------------- sign in / out ----------------
export async function loginAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const store = await loadStore(sub);
  if (store.status !== "ok") return { error: "This store is not available." };
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const r = await authenticateStaff(store.ctx, fd(form, "email"), fd(form, "password"), fd(form, "code") || undefined, ip);
  if (!r.ok) {
    await appendAudit({ actorId: fd(form, "email").slice(0, 120) || "unknown", actorRole: "unknown", instanceId: store.ctx.instanceId, action: "auth.staff_login", outcome: "failure" }).catch(() => undefined);
    switch (r.reason) {
      case "rate_limited": return { error: `Too many attempts. Try again in ${r.retryAfterSec} seconds.` };
      case "code_required": return { error: "Enter the 6-digit code from your authenticator app.", fields: { need2fa: "1" } };
      case "bad_code": return { error: "That code is not correct or was already used. Wait for a new one and try again.", fields: { need2fa: "1" } };
      case "disabled": return { error: "This account has been disabled. Contact the store owner." };
      default: return { error: "That email and password do not match." };
    }
  }
  const token = await signSession({ userId: r.user._id, role: r.user.role, instanceId: store.ctx.instanceId }, env().sessionSecret);
  (await cookies()).set(STORE_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  await appendAudit({ actorId: r.user._id, actorRole: r.user.role, instanceId: store.ctx.instanceId, action: "auth.staff_login", outcome: "success" }).catch(() => undefined);
  redirect(home(sub));
}

export async function logoutAction(sub: string) {
  (await cookies()).delete(STORE_COOKIE);
  redirect(`${home(sub)}/login`);
}

// ---------------- catalogue ----------------
function productFields(form: FormData) {
  return ProductInput.safeParse({
    name: fd(form, "name"), description: fd(form, "description"), price: fd(form, "price"), compareAt: fd(form, "compareAt"),
    categoryId: fd(form, "categoryId"), imageUrl: fd(form, "imageUrl"), stock: fd(form, "stock") || "0", trackStock: form.get("trackStock") === "on", backorder: form.get("backorder") === "on", status: fd(form, "status") || "draft",
  });
}

export async function saveProductAction(sub: string, id: string | null, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "catalog.manage");
  if (!g) return { error: "You do not have permission to change products." };
  const parsed = productFields(form);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const cur = g.store.settings.currency;
  const r = id ? await updateProduct(g.store.ctx, id, parsed.data, cur) : await createProduct(g.store.ctx, parsed.data, cur);
  if (!r.ok) return { error: r.error };
  await record(g.store, g.staff, id ? "product.update" : "product.create", parsed.data.name);
  revalidatePath(`/s/${sub}`, "layout");
  redirect(`${home(sub)}/products?saved=1`);
}

export async function deleteProductAction(sub: string, id: string) {
  const { store, staff } = await guard(sub, "catalog.manage");
  const p = await products.findById(store.ctx, id);
  if (p) {
    await products.deleteById(store.ctx, id);
    await record(store, staff, "product.delete", p.name);
  }
  revalidatePath(`/s/${sub}`, "layout");
  redirect(`${home(sub)}/products`);
}

export async function categoryAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "catalog.manage");
  if (!g) return { error: "You do not have permission to change categories." };
  const op = fd(form, "op");
  const name = fd(form, "name").trim();
  const id = fd(form, "id");
  if (op === "delete") {
    if (await products.count(g.store.ctx, { categoryId: id } as never)) return { error: "Move or delete the products in this category first." };
    await categories.deleteById(g.store.ctx, id);
  } else {
    if (name.length < 1 || name.length > 60) return { error: "Enter a category name (1 to 60 characters)." };
    const slug = slugify(name);
    if (op === "rename") {
      await categories.updateById(g.store.ctx, id, { name, slug } as never);
    } else {
      if (await categories.count(g.store.ctx, { slug } as never)) return { error: "A category with that name already exists." };
      await categories.insert(g.store.ctx, { _id: randomUUID(), name, slug, sortOrder: 99 } as never);
    }
  }
  await record(g.store, g.staff, `category.${op}`, name);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Saved." };
}

// ---------------- orders ----------------
const notifyOf = (store: { feat: Features; settings: { branding: { storeName: string } }; instance: { name: string } }) => ({ emails: store.feat.emails, storeName: store.settings.branding.storeName || store.instance.name });

export async function orderStatusAction(sub: string, orderId: string, to: string): Promise<AdminState> {
  const g = await guardSoft(sub, "orders.updateStatus");
  if (!g) return { error: "You do not have permission to change orders." };
  if (!(ORDER_STATES as readonly string[]).includes(to)) return { error: "Unknown status." };
  const r = await transitionOrder(g.store.ctx, orderId, to as OrderState, g.staff.actor, notifyOf(g.store));
  await record(g.store, g.staff, "order.status", `${orderId} -> ${to}`);
  revalidatePath(`${home(sub)}/orders`);
  return r.ok ? { message: `Order is now ${to}.` } : { error: r.error };
}

export async function refundAction(sub: string, orderId: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "orders.process");
  if (!g) return { error: "You do not have permission to refund." };
  let minor: number;
  try {
    minor = parseMajor(fd(form, "amount"), g.store.settings.currency).minor;
  } catch {
    return { error: "Enter an amount like 250 or 250.50." };
  }
  const r = await refundOrder(g.store.ctx, orderId, minor, g.staff.actor, fd(form, "key"), notifyOf(g.store));
  await record(g.store, g.staff, "order.refund", `${orderId} ${minor}`);
  revalidatePath(`${home(sub)}/orders`);
  return r.ok ? { message: r.duplicate ? "That refund was already recorded." : "Refund recorded." } : { error: r.error };
}

export async function expireUnpaidAction(sub: string) {
  const { store } = await guard(sub, "orders.process");
  await expireUnpaidOrders(store.ctx);
  revalidatePath(`${home(sub)}/orders`);
}

// ---------------- discounts ----------------
export async function discountAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "promotions.manage");
  if (!g) return { error: "You do not have permission to manage discounts." };
  const db = await tenantDb(g.store.ctx);
  const op = fd(form, "op");
  const code = fd(form, "code").trim().toUpperCase();
  if (op === "toggle") {
    await db.collection("discounts").updateOne({ instanceId: g.store.ctx.instanceId, code }, [{ $set: { active: { $not: "$active" } } }]);
    await record(g.store, g.staff, "discount.toggle", code);
    revalidatePath(`${home(sub)}/discounts`);
    return { message: "Updated." };
  }
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return { error: "Codes use 3 to 30 letters, digits, - or _." };
  const pct = parseFloat(fd(form, "percent"));
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { error: "Enter a percentage between 1 and 100." };
  const maxRaw = fd(form, "maxUses").trim();
  const maxUses = maxRaw === "" ? null : parseInt(maxRaw, 10);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) return { error: "Maximum uses must be a whole number of 1 or more." };
  const perRaw = fd(form, "perCustomer").trim();
  const perCustomer = perRaw === "" ? null : parseInt(perRaw, 10);
  if (perCustomer !== null && (!Number.isInteger(perCustomer) || perCustomer < 1 || perCustomer > 100)) return { error: "Uses per customer must be a whole number from 1 to 100." };
  const exp = fd(form, "expires");
  const expiresAt = exp ? new Date(exp + "T23:59:59Z") : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return { error: "Enter a valid expiry date." };
  try {
    await db.collection("discounts").insertOne({ instanceId: g.store.ctx.instanceId, code, percentBps: Math.round(pct * 100), active: true, maxUses, perCustomer, used: 0, expiresAt, createdAt: new Date() } as never);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { error: "That code already exists." };
    throw e;
  }
  await record(g.store, g.staff, "discount.create", code);
  revalidatePath(`${home(sub)}/discounts`);
  return { message: `Code ${code} created.` };
}

// ---------------- features ----------------
export async function featureAction(sub: string, id: string, value: boolean, cascade: boolean): Promise<AdminState> {
  const g = await guardSoft(sub, "toggle.enable");
  if (!g) return { error: "Only the store owner can change features." };
  const r = await setOwnerFeature(g.store.instance, g.staff.actor, id, value, cascade);
  if (r.ok) await record(g.store, g.staff, value ? "feature.on" : "feature.off", r.changed.join(", "));
  revalidatePath(`${home(sub)}/features`);
  revalidatePath(`/s/${sub}`, "layout");
  return r.ok ? { message: `Saved (${r.changed.length} feature${r.changed.length === 1 ? "" : "s"}).` } : { error: r.error };
}

export async function undoAction(sub: string, historyId: string): Promise<AdminState> {
  const g = await guardSoft(sub, "toggle.enable");
  if (!g) return { error: "Only the store owner can undo changes." };
  const r = await undoChange(g.store.instance, g.staff.actor, historyId);
  revalidatePath(`${home(sub)}/features`);
  return r.ok ? { message: "Change undone." } : { error: r.error };
}

// ---------------- settings ----------------
export async function brandingAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "branding.edit");
  if (!g) return { error: "You do not have permission to edit branding." };
  const parsed = BrandingInput.safeParse({
    storeName: fd(form, "storeName"), tagline: fd(form, "tagline"), primary: fd(form, "primary"), logoUrl: fd(form, "logoUrl"), contactEmail: fd(form, "contactEmail"), locale: fd(form, "locale") || "en",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  await saveBranding(g.store.ctx, parsed.data);
  await bumpInstance(g.store.instance._id);
  clearResolutionCache();
  clearToggleCache();
  await record(g.store, g.staff, "settings.branding", parsed.data.storeName);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Saved. Your changes are live." };
}

export async function commerceAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "settings.commerce");
  if (!g) return { error: "Only the store owner can change prices, tax and shipping." };
  const parsed = CommerceInput.safeParse({ currency: fd(form, "currency"), taxPercent: fd(form, "taxPercent"), shipping: fd(form, "shipping"), freeOver: fd(form, "freeOver") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const err = await saveCommerce(g.store.ctx, parsed.data);
  if (err) return { error: err };
  await record(g.store, g.staff, "settings.commerce", `${parsed.data.currency} tax ${parsed.data.taxPercent}%`);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Saved." };
}

// ---------------- staff, security, privacy ----------------
export async function inviteStaffAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "staff.manage");
  if (!g) return { error: "Only the store owner can manage staff." };
  const { platformDb } = await import("@/lib/db/client");
  const plan = await (await platformDb()).collection<{ _id: string; quotas: { staffSeats: number } }>("plans").findOne({ _id: g.store.instance.planId });
  const r = await inviteStaff(g.store.ctx, g.staff.actor, fd(form, "email"), fd(form, "role"), plan?.quotas.staffSeats ?? 1);
  if (!r.ok) return { error: r.error };
  await record(g.store, g.staff, "staff.invite", fd(form, "email"));
  revalidatePath(`${home(sub)}/staff`);
  return { message: `Invitation created. Share this one-time link (valid for 1 hour):`, link: `/invite/${r.token}` };
}

export async function staffChangeAction(sub: string, userId: string, change: { role?: string; disabled?: boolean }): Promise<AdminState> {
  const g = await guardSoft(sub, "staff.manage");
  if (!g) return { error: "Only the store owner can manage staff." };
  const r = await changeStaff(g.store.ctx, g.staff.actor, userId, change);
  revalidatePath(`${home(sub)}/staff`);
  return r.ok ? { message: "Saved." } : { error: r.error };
}

export async function beginTotpAction(sub: string): Promise<AdminState> {
  const { store, staff } = await (await import("@/lib/commerce/load")).requireStaff(sub, { allowSetup2fa: true });
  if (staff.impersonating || !staff.user) return { error: "Two-factor settings cannot be changed in a support session." };
  const secret = await beginTotpEnrollment(store.ctx, staff.user._id);
  return { secret };
}

export async function confirmTotpAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const { store, staff } = await (await import("@/lib/commerce/load")).requireStaff(sub, { allowSetup2fa: true });
  if (staff.impersonating || !staff.user) return { error: "Two-factor settings cannot be changed in a support session." };
  const ok = await confirmTotpEnrollment(store.ctx, staff.user._id, fd(form, "code"));
  if (!ok) return { error: "That code did not match. Check the time on your phone and try again." };
  await record(store, staff, "security.2fa_enabled");
  await appendAudit({ actorId: staff.user._id, actorRole: staff.actor.role, instanceId: store.ctx.instanceId, action: "security.2fa_enabled", outcome: "success" }).catch(() => undefined);
  redirect(home(sub));
}

export async function changePasswordAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const { store, staff } = await (await import("@/lib/commerce/load")).requireStaff(sub, { allowSetup2fa: true });
  if (staff.impersonating || !staff.user) return { error: "Passwords cannot be changed in a support session." };
  const next = fd(form, "next");
  const weak = validatePasswordStrength(next);
  if (weak) return { error: weak };
  if (next !== fd(form, "confirm")) return { error: "The two new passwords do not match." };
  const r = await setOwnPassword(store.ctx, staff.user._id, fd(form, "current"), next);
  if (!r.ok) return { error: r.error };
  // every other device is signed out; this one gets a fresh session
  const fresh = await signSession({ userId: staff.user._id, role: staff.user.role, instanceId: store.ctx.instanceId }, env().sessionSecret);
  (await cookies()).set(STORE_COOKIE, fresh, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  await appendAudit({ actorId: staff.user._id, actorRole: staff.actor.role, instanceId: store.ctx.instanceId, action: "security.password_change", outcome: "success" }).catch(() => undefined);
  return { message: "Password changed. Other devices have been signed out." };
}

export async function anonymizeAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "privacy.manage");
  if (!g) return { error: "Only the store owner can handle privacy requests." };
  const email = fd(form, "email").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter the customer's email address." };
  if (fd(form, "confirm") !== "DELETE") return { error: "Type DELETE to confirm. This cannot be undone." };
  const n = await anonymizeCustomer(g.store.ctx, email);
  await appendAudit({ actorId: g.staff.actor.userId, actorRole: g.staff.actor.role, instanceId: g.store.ctx.instanceId, action: "privacy.anonymize", outcome: "success", after: { orders: n } }).catch(() => undefined);
  return { message: `${n} order${n === 1 ? "" : "s"} anonymised. Totals are kept for accounting.` };
}

export async function processOutboxAction(sub: string) {
  const { store } = await guard(sub, "orders.process");
  await processOutbox(store.ctx);
  revalidatePath(`${home(sub)}/emails`);
}

// ---------------- payments (the owner connects their OWN accounts) ----------------
import { connectStripe, disconnectStripe, setTestMode, upsertManual, setManualEnabled, removeManual, type ManualKind } from "@/lib/payments/config";
import { confirmManualPayment } from "@/lib/commerce/payflow";
import { enqueueEmail } from "@/lib/commerce/outbox";

export async function connectStripeAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "payments.manage");
  if (!g) return { error: "Only the store owner can connect payment accounts." };
  if (g.staff.impersonating) return { error: "Payment settings cannot be changed in a support session." };
  if (!(await rateLimit(`pay-connect:${g.store.instance._id}`, 8, 10 * 60_000)).ok) return { error: "Too many attempts. Wait a few minutes and try again." };
  const r = await connectStripe(g.store.ctx, fd(form, "secretKey"));
  if (!r.ok) return { error: r.error };
  await record(g.store, g.staff, "payments.stripe_connected", `${r.accountName} (${r.livemode ? "live" : "test"})`);
  await setOwnerFeature(g.store.instance, g.staff.actor, "F-037", true, true).catch(() => undefined);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: `Connected to ${r.accountName} (${r.livemode ? "live mode: real money" : "test mode: no real money"}). Customers can now pay by card and the money goes to your Stripe account.` };
}

export async function disconnectStripeAction(sub: string): Promise<AdminState> {
  const g = await guardSoft(sub, "payments.manage");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can change payment accounts." };
  await disconnectStripe(g.store.ctx);
  await record(g.store, g.staff, "payments.stripe_disconnected");
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Stripe disconnected. Card payments are off until you connect an account again." };
}

export async function testModeAction(sub: string, on: boolean): Promise<AdminState> {
  const g = await guardSoft(sub, "payments.manage");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can change payment settings." };
  await setTestMode(g.store.ctx, on);
  await record(g.store, g.staff, on ? "payments.test_on" : "payments.test_off");
  revalidatePath(`/s/${sub}`, "layout");
  return { message: on ? "Test payments are on. No real money moves." : "Test payments are off." };
}

export async function manualMethodAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "payments.manage");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can change payment settings." };
  const kind = fd(form, "kind") as ManualKind;
  const r = await upsertManual(g.store.ctx, { kind, accountTitle: fd(form, "accountTitle"), accountNumber: fd(form, "accountNumber"), instructions: fd(form, "instructions"), label: fd(form, "label") });
  if (!r.ok) return { error: r.error };
  // make sure the matching catalogue feature is on so customers actually see the option
  const feature = kind === "bank" || kind === "other" ? "F-039" : "F-040";
  const f = await setOwnerFeature(g.store.instance, g.staff.actor, feature, true, true);
  await record(g.store, g.staff, "payments.manual_saved", kind);
  revalidatePath(`/s/${sub}`, "layout");
  return f.ok ? { message: "Saved. Customers can now choose this at checkout." } : { message: "Saved, but it is hidden from customers:", error: f.error };
}

export async function manualMethodOpAction(sub: string, id: string, op: "enable" | "disable" | "remove"): Promise<AdminState> {
  const g = await guardSoft(sub, "payments.manage");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can change payment settings." };
  if (op === "remove") await removeManual(g.store.ctx, id); else await setManualEnabled(g.store.ctx, id, op === "enable");
  await record(g.store, g.staff, `payments.manual_${op}`, id);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Saved." };
}

export async function confirmPaymentAction(sub: string, orderId: string): Promise<AdminState> {
  const g = await guardSoft(sub, "orders.process");
  if (!g) return { error: "You do not have permission to confirm payments." };
  const r = await confirmManualPayment(g.store.ctx, orderId, g.staff.actor, async () => g.store.settings.branding.storeName || g.store.instance.name);
  if (r.ok) await record(g.store, g.staff, "order.payment_confirmed", orderId);
  revalidatePath(`${home(sub)}/orders`);
  return r.ok ? { message: "Marked as paid. The order is confirmed and the customer was notified." } : { error: r.error };
}

export async function testEmailAction(sub: string): Promise<AdminState> {
  const g = await guardSoft(sub, "activity.view");
  if (!g) return { error: "You do not have permission." };
  const to = g.staff.user?.email;
  if (!to) return { error: "Sign in with your own account to send a test email." };
  if (!(await rateLimit(`test-email:${g.store.instance._id}`, 5, 10 * 60_000)).ok) return { error: "Too many test emails. Try again later." };
  await enqueueEmail(g.store.ctx, "test.email", to, { storeName: g.store.settings.branding.storeName || g.store.instance.name });
  await processOutbox(g.store.ctx);
  revalidatePath(`${home(sub)}/emails`);
  return { message: `Test email queued for ${to}. Check the list below to see whether it was sent.` };
}

// ---------------- notes, content, reviews, import ----------------
import { savePage, deletePage, setReviewStatus, importProductsCsv, sendCampaign } from "@/lib/commerce/extras";
import { orders as ordersRepo } from "@/lib/commerce/orders";

export async function orderNoteAction(sub: string, orderId: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "orders.updateStatus");
  if (!g) return { error: "You do not have permission to change orders." };
  if (g.store.eff.get("F-032")?.enabled === false) return { error: "Order notes are turned off." };
  const note = fd(form, "note").trim();
  if (note.length < 1 || note.length > 500) return { error: "Write a note of 1 to 500 characters." };
  const r = await (await ordersRepo.collection(g.store.ctx)).updateOne(
    { _id: orderId, instanceId: g.store.ctx.instanceId } as never,
    { $push: { history: { at: new Date(), kind: "note", by: g.staff.actor.userId, note } } } as never,
  );
  if (r.matchedCount !== 1) return { error: "Order not found." };
  revalidatePath(`${home(sub)}/orders/${orderId}`);
  return { message: "Note added (only staff can see it)." };
}

export async function announcementAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "branding.edit");
  if (!g) return { error: "You do not have permission to edit the store." };
  const text = fd(form, "announcement").trim();
  if (text.length > 160) return { error: "The announcement can be at most 160 characters." };
  await (await tenantDb(g.store.ctx)).collection("settings").updateOne({ instanceId: g.store.ctx.instanceId }, { $set: { announcement: text } });
  await bumpInstance(g.store.instance._id);
  clearResolutionCache();
  await record(g.store, g.staff, "settings.announcement");
  revalidatePath(`/s/${sub}`, "layout");
  return { message: text ? "Announcement is live on your store." : "Announcement removed." };
}

export async function pageAction(sub: string, id: string | null, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "branding.edit");
  if (!g) return { error: "You do not have permission to edit pages." };
  if (g.store.eff.get("F-078")?.enabled === false) return { error: "Custom pages are turned off." };
  const r = await savePage(g.store.ctx, { id: id ?? undefined, title: fd(form, "title"), slug: fd(form, "slug"), body: fd(form, "body"), kind: fd(form, "kind") === "post" ? "post" : "page", published: form.get("published") === "on", inFooter: form.get("inFooter") === "on" });
  if (!r.ok) return { error: r.error };
  await record(g.store, g.staff, id ? "page.update" : "page.create", fd(form, "title"));
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Page saved." };
}

export async function pageDeleteAction(sub: string, id: string): Promise<AdminState> {
  const g = await guardSoft(sub, "branding.edit");
  if (!g) return { error: "You do not have permission to edit pages." };
  await deletePage(g.store.ctx, id);
  await record(g.store, g.staff, "page.delete", id);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Page deleted." };
}

export async function reviewModerateAction(sub: string, id: string, status: "published" | "hidden" | "deleted"): Promise<AdminState> {
  const g = await guardSoft(sub, "catalog.manage");
  if (!g) return { error: "You do not have permission to moderate reviews." };
  await setReviewStatus(g.store.ctx, id, status);
  await record(g.store, g.staff, `review.${status}`, id);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Done." };
}

export async function importProductsAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "catalog.manage");
  if (!g) return { error: "You do not have permission to import products." };
  if (g.store.eff.get("F-011")?.enabled === false) return { error: "Product import is turned off." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file first." };
  if (file.size > 1_000_000) return { error: "The file is too large (1 MB maximum)." };
  const r = await importProductsCsv(g.store.ctx, await file.text(), g.store.settings.currency);
  await record(g.store, g.staff, "products.import", `${r.created} created, ${r.errors.length} problems`);
  revalidatePath(`/s/${sub}`, "layout");
  const detail = r.errors.slice(0, 5).map((e) => `row ${e.row}: ${e.message}`).join("; ");
  if (r.created === 0 && r.errors.length) return { error: `Nothing was imported. ${detail}` };
  return { message: `${r.created} product${r.created === 1 ? "" : "s"} imported (set to published in the file to show them in the store).${r.errors.length ? ` ${r.errors.length} row(s) skipped: ${detail}` : ""}` };
}

// ---------------- promotions, hours, delivery zones, look and feel ----------------
import { savePromo, setPromoActive, validateHours, validateZones } from "@/lib/commerce/rules";
import { DAYS, type Day, type Settings } from "@/lib/commerce/types";

async function saveSetting(g: NonNullable<Awaited<ReturnType<typeof guardSoft>>>, sub: string, set: Record<string, unknown>, what: string) {
  await (await tenantDb(g.store.ctx)).collection("settings").updateOne({ instanceId: g.store.ctx.instanceId }, { $set: set, $inc: { configVersion: 1 } }, { upsert: true });
  await bumpInstance(g.store.instance._id);
  clearResolutionCache();
  clearToggleCache();
  await record(g.store, g.staff, `settings.${what}`);
  revalidatePath(`/s/${sub}`, "layout");
}

export async function promoAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "promotions.manage");
  if (!g) return { error: "You do not have permission to manage promotions." };
  const r = await savePromo(g.store.ctx, { name: fd(form, "name"), kind: fd(form, "kind"), percent: fd(form, "percent"), min: fd(form, "min"), categoryId: fd(form, "categoryId"), startsAt: fd(form, "startsAt"), endsAt: fd(form, "endsAt") }, g.store.settings.currency);
  if (!r.ok) return { error: r.error };
  const feature = fd(form, "kind") === "flash" ? "F-056" : "F-054";
  const f = await setOwnerFeature(g.store.instance, g.staff.actor, feature, true, true);
  await record(g.store, g.staff, "promo.create", fd(form, "name"));
  revalidatePath(`/s/${sub}`, "layout");
  return f.ok ? { message: "Promotion saved. It applies automatically in the cart." } : { message: "Saved, but not active for customers:", error: f.error };
}

export async function promoOpAction(sub: string, id: string, op: "on" | "off" | "delete"): Promise<AdminState> {
  const g = await guardSoft(sub, "promotions.manage");
  if (!g) return { error: "You do not have permission to manage promotions." };
  await setPromoActive(g.store.ctx, id, op === "delete" ? "delete" : op === "on");
  await record(g.store, g.staff, `promo.${op}`, id);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: "Done." };
}

export async function hoursAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "branding.edit");
  if (!g) return { error: "You do not have permission to change opening hours." };
  if (form.get("clear") === "on") {
    await saveSetting(g, sub, { hours: {} }, "hours");
    return { message: "Opening hours removed: the store takes orders at any time." };
  }
  const hours: NonNullable<Settings["hours"]> = {};
  for (const d of DAYS as Day[]) hours[d] = form.get(`closed_${d}`) === "on" || !fd(form, `open_${d}`) ? null : { open: fd(form, `open_${d}`), close: fd(form, `close_${d}`) };
  const bad = validateHours(hours);
  if (bad) return { error: bad };
  await saveSetting(g, sub, { hours }, "hours");
  await setOwnerFeature(g.store.instance, g.staff.actor, "F-018", true, true).catch(() => undefined);
  return { message: "Opening hours saved. Outside these hours customers can browse but not order." };
}

export async function zonesAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "settings.commerce");
  if (!g) return { error: "Only the store owner can change delivery fees." };
  const cur = g.store.settings.currency;
  const zones: { id: string; name: string; cities: string[]; feeMinor: number }[] = [];
  for (const line of fd(form, "zones").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name = "", fee = "", cities = ""] = line.split("|").map((x) => x.trim());
    let feeMinor: number;
    try { feeMinor = parseMajor(fee, cur).minor; } catch { return { error: `Line "${line.slice(0, 40)}": write the fee as a number like 200.` }; }
    zones.push({ id: randomUUID().slice(0, 8), name, cities: cities.split(",").map((c) => c.trim()).filter(Boolean), feeMinor });
  }
  const bad = validateZones(zones);
  if (bad) return { error: bad };
  await saveSetting(g, sub, { zones }, "zones");
  if (zones.length) {
    const f = await setOwnerFeature(g.store.instance, g.staff.actor, "F-071", true, true);
    if (!f.ok) return { message: "Saved, but not active:", error: f.error };
  }
  return { message: zones.length ? "Delivery zones saved." : "Delivery zones removed: the flat fee applies everywhere." };
}

export async function lookAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "branding.edit");
  if (!g) return { error: "You do not have permission to change the look of the store." };
  const font = fd(form, "font");
  if (!["system", "serif", "rounded", "mono"].includes(font)) return { error: "Choose one of the listed fonts." };
  const hero: NonNullable<Settings["hero"]> = [];
  for (let i = 1; i <= 3; i++) {
    const title = fd(form, `title${i}`).trim(), text = fd(form, `text${i}`).trim(), imageUrl = fd(form, `image${i}`).trim(), link = fd(form, `link${i}`).trim();
    if (!title && !text && !imageUrl) continue;
    if (title.length > 80 || text.length > 200) return { error: `Slide ${i}: title up to 80 and text up to 200 characters.` };
    if (imageUrl && !/^https:\/\/[^\s"'<>]+$/i.test(imageUrl) && !/^\/s\/[a-z0-9-]{1,40}\/img\/[0-9a-f-]{36}$/.test(imageUrl)) return { error: `Slide ${i}: the image link must start with https://` };
    if (link && !/^(\/|https:\/\/)[^\s"'<>]*$/i.test(link)) return { error: `Slide ${i}: the button link must start with / or https://` };
    if (link.startsWith("//")) return { error: `Slide ${i}: the button link is not valid.` };
    hero.push({ title, text, imageUrl, link });
  }
  await saveSetting(g, sub, { font, hero }, "look");
  return { message: "Saved. Your store has its new look." };
}

// ---------------- bulk product edits (F-115) ----------------
export async function bulkProductsAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "catalog.manage");
  if (!g) return { error: "You do not have permission to change products." };
  if (g.store.eff.get("F-115")?.enabled !== true) return { error: "Bulk editing is turned off. Turn it on in Features." };
  const ids = form.getAll("ids").map(String).filter(Boolean).slice(0, 200);
  if (!ids.length) return { error: "Tick at least one product first." };
  const op = fd(form, "op");
  const col = await products.collection(g.store.ctx);
  const scope = products.scope(g.store.ctx, { _id: { $in: ids } } as never);
  let n = 0;
  if (op === "publish" || op === "draft") n = (await col.updateMany(scope, { $set: { status: op === "publish" ? "published" : "draft", updatedAt: new Date() } })).modifiedCount;
  else if (op === "delete") n = (await col.deleteMany(scope)).deletedCount;
  else if (op === "price") {
    const pct = parseFloat(fd(form, "value"));
    if (!Number.isFinite(pct) || pct < -90 || pct > 500 || pct === 0) return { error: "Enter a percentage between -90 and 500, for example 10 or -15." };
    n = (await col.updateMany(scope, [{ $set: { priceMinor: { $max: [0, { $round: [{ $multiply: ["$priceMinor", 1 + pct / 100] }, 0] }] }, compareAtMinor: null, updatedAt: new Date() } }])).modifiedCount;
  } else if (op === "stock") {
    const v = parseInt(fd(form, "value"), 10);
    if (!Number.isInteger(v) || v < 0 || v > 1_000_000) return { error: "Enter the new stock as a whole number." };
    n = (await col.updateMany(scope, { $set: { stock: v, updatedAt: new Date() } })).modifiedCount;
  } else return { error: "Choose what to do with the selected products." };
  await record(g.store, g.staff, `products.bulk_${op}`, `${n} products`);
  revalidatePath(`/s/${sub}`, "layout");
  return { message: `${n} product${n === 1 ? "" : "s"} updated.` };
}

export async function campaignAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "promotions.manage");
  if (!g) return { error: "You do not have permission to send campaigns." };
  if (g.store.eff.get("F-058")?.enabled !== true) return { error: "Turn on Newsletter signup first." };
  const f = await setOwnerFeature(g.store.instance, g.staff.actor, "F-059", true, true);
  if (!f.ok) return { error: f.error };
  const r = await sendCampaign(g.store.ctx, { subject: fd(form, "subject"), message: fd(form, "message") }, g.store.settings.branding.storeName || g.store.instance.name);
  if (!r.ok) return { error: r.error };
  await record(g.store, g.staff, "campaign.sent", `${r.queued} subscribers`);
  revalidatePath(`${home(sub)}/inbox`);
  return { message: `Sent to ${r.queued} subscriber${r.queued === 1 ? "" : "s"}. Every email has an unsubscribe link.` };
}

// ---------------- integrations (webhooks, API keys) ----------------
import { addEndpoint, setEndpoint, replayDelivery, createApiKey, revokeApiKey, WEBHOOK_EVENTS } from "@/lib/commerce/integrations";

export async function webhookAddAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "settings.commerce");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can manage integrations." };
  const r = await addEndpoint(g.store.ctx, fd(form, "url"), WEBHOOK_EVENTS.filter((e) => form.get(`ev_${e}`) === "on"));
  if (!r.ok) return { error: r.error };
  const f = await setOwnerFeature(g.store.instance, g.staff.actor, "F-099", true, true);
  await setOwnerFeature(g.store.instance, g.staff.actor, "F-142", true, true).catch(() => undefined);
  await record(g.store, g.staff, "webhook.add", fd(form, "url").slice(0, 80));
  revalidatePath(`${home(sub)}/integrations`);
  return { message: `Added. Your signing secret is shown only now, copy it: ${r.secret}`, ...(f.ok ? {} : { error: f.error }) };
}

export async function webhookOpAction(sub: string, id: string, op: "enable" | "disable" | "delete"): Promise<AdminState> {
  const g = await guardSoft(sub, "settings.commerce");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can manage integrations." };
  await setEndpoint(g.store.ctx, id, op);
  await record(g.store, g.staff, `webhook.${op}`, id);
  revalidatePath(`${home(sub)}/integrations`);
  return { message: "Done." };
}

export async function webhookReplayAction(sub: string, id: string): Promise<AdminState> {
  const g = await guardSoft(sub, "settings.commerce");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can manage integrations." };
  const ok = await replayDelivery(g.store.ctx, id);
  revalidatePath(`${home(sub)}/integrations`);
  return ok ? { message: "Sent again. Check the status below." } : { error: "That delivery was not found." };
}

export async function apiKeyCreateAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = await guardSoft(sub, "settings.commerce");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can manage integrations." };
  const r = await createApiKey(g.store.ctx, fd(form, "name"));
  if (!r.ok) return { error: r.error };
  const f = await setOwnerFeature(g.store.instance, g.staff.actor, "F-100", true, true);
  await record(g.store, g.staff, "apikey.create", fd(form, "name"));
  revalidatePath(`${home(sub)}/integrations`);
  return { message: `Key created. Copy it now, it is never shown again: ${r.key}`, ...(f.ok ? {} : { error: f.error }) };
}

export async function apiKeyRevokeAction(sub: string, id: string): Promise<AdminState> {
  const g = await guardSoft(sub, "settings.commerce");
  if (!g || g.staff.impersonating) return { error: "Only the store owner can manage integrations." };
  await revokeApiKey(g.store.ctx, id);
  await record(g.store, g.staff, "apikey.revoke", id);
  revalidatePath(`${home(sub)}/integrations`);
  return { message: "Key revoked. It stops working immediately." };
}

// ---------------- picture upload ----------------
import { saveImage } from "@/lib/commerce/images";

/** Used by the product, logo and banner forms. Needs permission to edit either the catalogue or the look of the store. */
export async function uploadImageAction(sub: string, _p: AdminState, form: FormData): Promise<AdminState> {
  const g = (await guardSoft(sub, "catalog.manage")) ?? (await guardSoft(sub, "branding.edit"));
  if (!g) return { error: "You do not have permission to upload pictures." };
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose a picture first." };
  if (file.size > 400 * 1024) return { error: "That picture is too big. Pictures are shrunk automatically before upload; try a different one." };
  const r = await saveImage(g.store.ctx, sub, new Uint8Array(await file.arrayBuffer()));
  if (!r.ok) return { error: r.error };
  await record(g.store, g.staff, "image.upload");
  return { link: r.url, message: "Uploaded." };
}
