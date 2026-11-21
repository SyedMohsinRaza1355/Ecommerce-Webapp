"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/current";
import { authorize } from "@/lib/auth/rbac";
import { signSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { platformDb } from "@/lib/db/client";
import { appendAudit } from "@/lib/audit/log";
import { STORE_COOKIE } from "@/lib/commerce/load";
import { issueTenantContext } from "@/lib/tenant/context";
import { enqueueEmail, processOutbox } from "@/lib/commerce/outbox";
import { users } from "@/lib/commerce/staff";
import type { InstanceRecord } from "@/lib/tenant/resolve";

export type SupportState = undefined | { error: string };

/** Sign in as the store owner for support: reason required, 30 minutes, owner notified, fully logged (SA-07, D-2, 5.1). */
export async function impersonateAction(id: string, _p: SupportState, form: FormData): Promise<SupportState> {
  const actor = await requireSuperAdmin();
  if (!authorize(actor, "owner.impersonate").allow) return { error: "Not allowed." };
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 8) return { error: "Enter the support ticket or reason (at least 8 characters)." };
  if (reason.length > 300) return { error: "Keep the reason under 300 characters." };
  const inst = await (await platformDb()).collection<InstanceRecord>("instances").findOne({ _id: id });
  if (!inst) return { error: "Store not found." };
  if (inst.status !== "active") return { error: "Only active stores can be accessed." };

  const ctx = issueTenantContext(inst._id);
  const owner = (await users.find(ctx, { role: "store_owner" } as never, 1))[0];
  if (!owner) return { error: "The owner has not set up their account yet." };

  const token = await signSession({ userId: actor.userId, role: "store_owner", instanceId: inst._id, impersonating: true }, env().sessionSecret, 30 * 60);
  (await cookies()).set(STORE_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 60 });
  await appendAudit({ actorId: actor.userId, actorRole: "super_admin", instanceId: inst._id, action: "impersonation.start", target: inst.subdomain, outcome: "success", after: { reason } });
  await enqueueEmail(ctx, "support.signin", owner.email, { storeName: inst.name, reason, at: new Date().toISOString() }).catch(() => undefined);
  await processOutbox(ctx).catch(() => undefined);
  redirect(`/s/${inst.subdomain}/admin`);
}
