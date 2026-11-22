import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/ratelimit";
import { env } from "@/lib/env";
import { enqueueEmail, processOutbox } from "./outbox";
import { orders, storeUrlFor, anonymizeCustomer } from "./orders";
import type { Order } from "./types";

// Shopper accounts (F-045..F-051, F-133). Kept apart from staff accounts: different collection,
// different token issuer and cookie, so a shopper session can never open the admin area.
export type Address = { id: string; label: string; address: string; city: string; phone: string };
export type Customer = {
  _id: string;
  instanceId?: string;
  email: string;
  name: string;
  phone?: string;
  passwordHash?: string;
  emailVerified: boolean;
  addresses: Address[];
  wishlist: string[];
  createdAt: Date;
  sessionsValidAfter?: Date;
};

const ISSUER = "ecom-customer";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DUMMY = "$2b$12$JGGTdxtQhWFC5TBm.BE7x.ZjWZBcVDJdMlBM5q38AgBxgONjKDkl2";
export const customerCookie = (instanceId: string) => `cust_${instanceId}`;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const keyBytes = () => new TextEncoder().encode(env().sessionSecret);

async function col(ctx: TenantContext) {
  return (await tenantDb(ctx)).collection<Customer>("customers");
}

export async function signCustomerToken(ctx: TenantContext, customerId: string, ttlSec = 60 * 60 * 24 * 30): Promise<string> {
  return new SignJWT({ iid: ctx.instanceId, kind: "customer" }).setProtectedHeader({ alg: "HS256" }).setSubject(customerId).setIssuer(ISSUER).setIssuedAt().setExpirationTime(`${ttlSec}s`).sign(keyBytes());
}

export async function setCustomerCookie(ctx: TenantContext, customerId: string) {
  (await cookies()).set(customerCookie(ctx.instanceId), await signCustomerToken(ctx, customerId), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function clearCustomerCookie(ctx: TenantContext) {
  (await cookies()).delete(customerCookie(ctx.instanceId));
}

/** The signed-in shopper for this store, or null. A token for another store is worthless here. */
export async function currentCustomer(store: { ctx: TenantContext }): Promise<Customer | null> {
  const token = (await cookies()).get(customerCookie(store.ctx.instanceId))?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyBytes(), { issuer: ISSUER, algorithms: ["HS256"] });
    if (payload.iid !== store.ctx.instanceId || !payload.sub) return null;
    const c = await (await col(store.ctx)).findOne({ _id: payload.sub, instanceId: store.ctx.instanceId });
    if (!c) return null;
    if (c.sessionsValidAfter && (typeof payload.iat !== "number" || payload.iat < Math.floor(c.sessionsValidAfter.getTime() / 1000))) return null;
    return c;
  } catch {
    return null;
  }
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function registerCustomer(ctx: TenantContext, i: { name: string; email: string; password: string; phone?: string }, ip: string): Promise<Result<{ customer: Customer }>> {
  const email = i.email.trim().toLowerCase();
  const name = i.name.trim();
  if (name.length < 2 || name.length > 100) return { ok: false, error: "Enter your full name." };
  if (!EMAIL_RE.test(email) || email.length > 120) return { ok: false, error: "Enter a valid email address." };
  const weak = validatePasswordStrength(i.password);
  if (weak) return { ok: false, error: weak };
  if (!(await rateLimit(`cust-reg:${ctx.instanceId}:${ip}`, 8, 60 * 60_000)).ok) return { ok: false, error: "Too many sign-ups from this connection. Try again later." };
  const c: Customer = { _id: randomUUID(), email, name, ...(i.phone?.trim() ? { phone: i.phone.trim().slice(0, 20) } : {}), passwordHash: await hashPassword(i.password), emailVerified: false, addresses: [], wishlist: [], createdAt: new Date() };
  try {
    await (await col(ctx)).insertOne({ ...c, instanceId: ctx.instanceId });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { ok: false, error: "An account with this email already exists. Try signing in, or use \"Forgot password\"." };
    throw e;
  }
  return { ok: true, customer: c };
}

export async function authenticateCustomer(ctx: TenantContext, email: string, password: string, ip: string): Promise<Result<{ customer: Customer }> | { ok: false; error: string; rateLimited: true }> {
  const e = email.trim().toLowerCase();
  const rl = await rateLimit(`cust:${ctx.instanceId}:${ip}:${e}`, 6, 60_000);
  if (!rl.ok) return { ok: false, error: `Too many attempts. Try again in ${rl.retryAfterSec} seconds.`, rateLimited: true };
  const c = await (await col(ctx)).findOne({ instanceId: ctx.instanceId, email: e });
  const good = await verifyPassword(password, c?.passwordHash ?? DUMMY);
  if (!c || !c.passwordHash || !good) return { ok: false, error: "That email and password do not match." };
  return { ok: true, customer: c };
}

// ---------------- one-time links (password reset, magic sign-in, email verification) ----------------
export type LinkPurpose = "reset" | "signin";
const LINK_TTL_MS: Record<LinkPurpose, number> = { reset: 30 * 60_000, signin: 15 * 60_000 };

/** Always answers the same way, so nobody can use this form to find out which emails have accounts. */
export async function sendCustomerLink(ctx: TenantContext, email: string, purpose: LinkPurpose, storeName: string, ip: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return;
  if (!(await rateLimit(`cust-link:${ctx.instanceId}:${ip}`, 6, 15 * 60_000)).ok) return;
  if (!(await rateLimit(`cust-link-e:${ctx.instanceId}:${e}`, 3, 15 * 60_000)).ok) return;
  const c = await (await col(ctx)).findOne({ instanceId: ctx.instanceId, email: e });
  if (!c) return;
  const token = randomBytes(32).toString("base64url");
  const db = await tenantDb(ctx);
  await db.collection("customer_tokens").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, hash: sha(token), customerId: c._id, purpose, expiresAt: new Date(Date.now() + LINK_TTL_MS[purpose]) });
  const url = `${await storeUrlFor(ctx)}/account/${purpose === "reset" ? "reset" : "link"}/${token}`;
  await enqueueEmail(ctx, purpose === "reset" ? "customer.reset" : "customer.signin_link", c.email, { storeName, url });
  await processOutbox(ctx).catch(() => undefined);
}

/** Single use: the token is deleted the moment it is checked. Using it also proves the email address is theirs. */
export async function consumeCustomerLink(ctx: TenantContext, token: string, purpose: LinkPurpose): Promise<Customer | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const db = await tenantDb(ctx);
  const t = await db.collection<{ customerId: string; expiresAt: Date; purpose: string }>("customer_tokens").findOneAndDelete({ instanceId: ctx.instanceId, hash: sha(token), purpose } as never);
  if (!t || t.expiresAt < new Date()) return null;
  const c = await (await col(ctx)).findOneAndUpdate({ _id: t.customerId, instanceId: ctx.instanceId }, { $set: { emailVerified: true } }, { returnDocument: "after" });
  if (c) await linkPastOrders(ctx, c);
  return c;
}

/** Guest orders made with the same (now verified) email become part of the account. */
export async function linkPastOrders(ctx: TenantContext, c: Customer): Promise<number> {
  const r = await (await orders.collection(ctx)).updateMany({ instanceId: ctx.instanceId, "customer.email": c.email, customerId: { $exists: false } } as never, { $set: { customerId: c._id } } as never);
  return r.modifiedCount;
}

export async function resetPassword(ctx: TenantContext, customerId: string, password: string): Promise<Result> {
  const weak = validatePasswordStrength(password);
  if (weak) return { ok: false, error: weak };
  await (await col(ctx)).updateOne({ _id: customerId, instanceId: ctx.instanceId }, { $set: { passwordHash: await hashPassword(password), sessionsValidAfter: new Date() } });
  return { ok: true };
}

// ---------------- profile, addresses, wishlist ----------------
export async function updateProfile(ctx: TenantContext, id: string, i: { name: string; phone: string }): Promise<Result> {
  if (i.name.trim().length < 2 || i.name.length > 100) return { ok: false, error: "Enter your full name." };
  if (i.phone && !/^[0-9+()\-\s]{7,20}$/.test(i.phone)) return { ok: false, error: "Enter a valid phone number." };
  await (await col(ctx)).updateOne({ _id: id, instanceId: ctx.instanceId }, { $set: { name: i.name.trim(), phone: i.phone.trim() } });
  return { ok: true };
}

export async function addAddress(ctx: TenantContext, id: string, a: Omit<Address, "id">): Promise<Result> {
  if (a.address.trim().length < 5 || a.address.length > 300) return { ok: false, error: "Enter the delivery address." };
  if (a.city.trim().length < 2 || a.city.length > 80) return { ok: false, error: "Enter the city." };
  if (a.phone && !/^[0-9+()\-\s]{7,20}$/.test(a.phone)) return { ok: false, error: "Enter a valid phone number." };
  const c = await (await col(ctx)).findOne({ _id: id, instanceId: ctx.instanceId });
  if ((c?.addresses.length ?? 0) >= 10) return { ok: false, error: "You can save up to 10 addresses." };
  await (await col(ctx)).updateOne({ _id: id, instanceId: ctx.instanceId }, { $push: { addresses: { id: randomUUID().slice(0, 8), label: (a.label.trim() || "Home").slice(0, 30), address: a.address.trim(), city: a.city.trim(), phone: a.phone.trim() } } });
  return { ok: true };
}

export async function removeAddress(ctx: TenantContext, id: string, addressId: string) {
  await (await col(ctx)).updateOne({ _id: id, instanceId: ctx.instanceId }, { $pull: { addresses: { id: addressId } } });
}

export async function toggleWishlist(ctx: TenantContext, id: string, productId: string): Promise<boolean> {
  const c = await (await col(ctx)).findOne({ _id: id, instanceId: ctx.instanceId });
  if (!c) return false;
  const has = c.wishlist.includes(productId);
  if (!has && c.wishlist.length >= 100) return false;
  await (await col(ctx)).updateOne({ _id: id, instanceId: ctx.instanceId }, has ? { $pull: { wishlist: productId } } : { $addToSet: { wishlist: productId } });
  return !has;
}

export async function ordersOf(ctx: TenantContext, c: Customer, limit = 50): Promise<Order[]> {
  return (await orders.find(ctx, { customerId: c._id } as never, limit)).sort((a, b) => +b.createdAt - +a.createdAt);
}

// ---------------- privacy (F-051) ----------------
export async function exportCustomerData(ctx: TenantContext, c: Customer) {
  const os = await orders.find(ctx, { $or: [{ customerId: c._id }, ...(c.emailVerified ? [{ "customer.email": c.email }] : [])] } as never, 500);
  return {
    exportedAt: new Date().toISOString(),
    profile: { name: c.name, email: c.email, phone: c.phone ?? null, createdAt: c.createdAt, addresses: c.addresses, wishlist: c.wishlist },
    orders: os.map((o) => ({ orderNo: o.orderNo, placedAt: o.createdAt, state: o.state, total: o.totalMinor / 100, currency: o.currency, items: o.items.map((i) => ({ name: i.name, qty: i.qty })) })),
  };
}

/** Deletes the account and removes personal details from their orders (financial totals stay for accounting). */
export async function deleteCustomerAccount(ctx: TenantContext, c: Customer): Promise<void> {
  if (c.emailVerified) await anonymizeCustomer(ctx, c.email);
  await (await orders.collection(ctx)).updateMany({ instanceId: ctx.instanceId, customerId: c._id } as never, { $set: { customer: { name: "[deleted]", email: "[deleted]", phone: "[deleted]", address: "[deleted]", city: "[deleted]" } }, $unset: { customerId: "" } } as never);
  await (await col(ctx)).deleteOne({ _id: c._id, instanceId: ctx.instanceId });
  await (await tenantDb(ctx)).collection("customer_tokens").deleteMany({ instanceId: ctx.instanceId, customerId: c._id });
}
