import type { TenantContext } from "@/lib/tenant/context";

export type Role = "super_admin" | "store_owner" | "manager" | "cashier" | "kitchen_ops" | "customer";
export const ROLES: readonly Role[] = ["super_admin", "store_owner", "manager", "cashier", "kitchen_ops", "customer"];

/** Named resource actions (ADD-029). Anything not listed is denied. */
export const PERMISSIONS = {
  // platform level (no tenant scope)
  "instance.create": ["super_admin"],
  "plan.set": ["super_admin"],
  "toggle.availability.set": ["super_admin"],
  "setting.override": ["super_admin"],
  "setting.lock": ["super_admin"],
  "instance.suspend": ["super_admin"],
  "owner.impersonate": ["super_admin"],
  "owner.password.reset": ["super_admin"],
  "killswitch.set": ["super_admin"],
  "audit.read": ["super_admin"],
  // tenant scoped
  "toggle.enable": ["super_admin", "store_owner"],
  "instance.export": ["super_admin", "store_owner"],
  "billing.view": ["super_admin", "store_owner"],
  "branding.edit": ["super_admin", "store_owner", "manager"],
  "catalog.manage": ["super_admin", "store_owner", "manager"],
  "inventory.view": ["super_admin", "store_owner", "manager", "kitchen_ops"],
  "orders.process": ["super_admin", "store_owner", "manager", "cashier"],
  "orders.updateStatus": ["super_admin", "store_owner", "manager", "cashier", "kitchen_ops"],
  "promotions.manage": ["super_admin", "store_owner", "manager"],
  "staff.manage": ["super_admin", "store_owner"],
  "settings.commerce": ["super_admin", "store_owner"],
  "payments.manage": ["super_admin", "store_owner"],
  "privacy.manage": ["super_admin", "store_owner"],
  "activity.view": ["super_admin", "store_owner", "manager"],
  "reports.view": ["super_admin", "store_owner", "manager"],
  "orders.own": ["super_admin", "store_owner", "manager", "cashier", "kitchen_ops", "customer"],
  "profile.own": ["super_admin", "store_owner", "manager", "cashier", "kitchen_ops", "customer"],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

const PLATFORM_ONLY = new Set<Action>([
  "instance.create", "plan.set", "toggle.availability.set", "setting.override", "setting.lock",
  "instance.suspend", "owner.impersonate", "owner.password.reset", "killswitch.set", "audit.read",
]);

export type Actor = {
  userId: string;
  role: Role;
  /** instance the actor belongs to; null for platform super admins */
  instanceId: string | null;
  /** set while a super admin impersonates an owner */
  impersonating?: boolean;
  /** token issue time in seconds, used for session revocation */
  issuedAt?: number;
};

/** Actions an impersonated session may never perform (SRS 5.1). */
export const IMPERSONATION_BLOCKED: ReadonlySet<string> = new Set([
  "owner.password.change", "owner.email.change", "owner.2fa.change", "billing.card.change",
]);

export type Decision = { allow: true } | { allow: false; reason: string };

/** Deny by default. Tenant actions also require the actor to belong to the resolved tenant. */
export function authorize(actor: Actor | null | undefined, action: string, ctx?: TenantContext): Decision {
  if (!actor) return { allow: false, reason: "unauthenticated" };
  if (actor.impersonating && IMPERSONATION_BLOCKED.has(action)) return { allow: false, reason: "blocked_during_impersonation" };
  const roles = (PERMISSIONS as Record<string, readonly Role[]>)[action];
  if (!roles) return { allow: false, reason: "unknown_action" };
  if (!roles.includes(actor.role)) return { allow: false, reason: "role_not_permitted" };
  if (PLATFORM_ONLY.has(action as Action)) return { allow: true };
  if (!ctx) return { allow: false, reason: "tenant_required" };
  if (actor.role !== "super_admin" && actor.instanceId !== ctx.instanceId) return { allow: false, reason: "wrong_tenant" };
  return { allow: true };
}
