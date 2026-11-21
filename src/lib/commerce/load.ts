import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolvePreview, type InstanceRecord } from "@/lib/tenant/resolve";
import type { TenantContext } from "@/lib/tenant/context";
import { getEffectiveToggles } from "@/lib/toggles/service";
import { getSettings } from "./store";
import { featuresFrom } from "./features";
import type { Settings } from "./types";
import type { Effective } from "@/lib/toggles/types";
import { isLocale, type Locale } from "@/lib/i18n";
import { env } from "@/lib/env";
import { verifySession } from "@/lib/auth/session";
import type { Actor } from "@/lib/auth/rbac";
import { users, type StaffUser } from "./staff";

export const STORE_COOKIE = "store_session";

export type Store =
  | { status: "ok"; ctx: TenantContext; instance: InstanceRecord; eff: Map<string, Effective>; settings: Settings; feat: ReturnType<typeof featuresFrom>; locale: Locale }
  | { status: "suspended"; name: string }
  | { status: "not_found" };

/** Resolve a store from the route and load everything pages need (cached per request). */
export const loadStore = cache(async (sub: string): Promise<Store> => {
  const r = await resolvePreview(sub);
  if (r.type === "suspended") return { status: "suspended", name: r.name };
  if (r.type !== "ok") return { status: "not_found" };
  const [eff, settings] = await Promise.all([getEffectiveToggles(r.instance), getSettings(r.ctx)]);
  const c = await cookies();
  const pref = c.get(`locale_${r.instance._id}`)?.value;
  const locale: Locale = isLocale(pref) ? pref : settings.locale;
  return { status: "ok", ctx: r.ctx, instance: r.instance, eff, settings, feat: featuresFrom(eff), locale };
});

export type StaffSession = { actor: Actor; user: StaffUser | null; impersonating: boolean; expiresAt: number | null };

/** Current staff member for this store, or null. Re-checks the user record so disabled accounts lose access at once. */
export async function getStaff(store: Extract<Store, { status: "ok" }>): Promise<StaffSession | null> {
  const token = (await cookies()).get(STORE_COOKIE)?.value;
  const a = await verifySession(token, env().sessionSecret);
  if (!a || a.instanceId !== store.ctx.instanceId) return null; // a session for another store is worthless here
  if (a.impersonating) {
    return a.role === "store_owner" ? { actor: a, user: null, impersonating: true, expiresAt: null } : null;
  }
  const user = await users.findById(store.ctx, a.userId);
  if (!user || user.disabled || user.role !== a.role) return null;
  return { actor: { userId: user._id, role: user.role, instanceId: store.ctx.instanceId }, user, impersonating: false, expiresAt: null };
}

export async function requireStaff(sub: string, opts: { roles?: string[]; allowSetup2fa?: boolean } = {}) {
  const store = await loadStore(sub);
  if (store.status === "not_found") redirect("/");
  if (store.status === "suspended") redirect(`/s/${sub}`);
  const staff = await getStaff(store);
  if (!staff) redirect(`/s/${sub}/admin/login`);
  if (opts.roles && !opts.roles.includes(staff.actor.role)) redirect(`/s/${sub}/admin?denied=1`);
  // mandatory two-factor for staff accounts when the feature is on (F-109, NFR-09)
  if (!opts.allowSetup2fa && store.eff.get("F-109")?.enabled && staff.user && !staff.user.totp?.enabled) redirect(`/s/${sub}/admin/security`);
  return { store, staff };
}
