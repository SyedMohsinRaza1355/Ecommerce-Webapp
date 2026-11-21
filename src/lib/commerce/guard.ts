import { redirect } from "next/navigation";
import { authorize, type Action } from "@/lib/auth/rbac";
import { requireStaff } from "./load";
import { logActivity } from "./staff";

/** Every admin page and server action goes through this: signed-in staff of THIS store, with the named permission. */
export async function guard(sub: string, action: Action, opts: { allowSetup2fa?: boolean } = {}) {
  const { store, staff } = await requireStaff(sub, { allowSetup2fa: opts.allowSetup2fa });
  const d = authorize(staff.actor, action, store.ctx);
  if (!d.allow) redirect(`/s/${sub}/admin?denied=1`);
  return { store, staff };
}

/** For server actions that report errors in the form instead of redirecting. */
export async function guardSoft(sub: string, action: Action) {
  const { store, staff } = await requireStaff(sub);
  const d = authorize(staff.actor, action, store.ctx);
  return d.allow ? { store, staff } : null;
}

export async function record(store: { ctx: Parameters<typeof logActivity>[0] }, staff: { actor: { userId: string; role: string } }, action: string, detail?: string) {
  await logActivity(store.ctx, staff.actor, action, detail).catch(() => undefined);
}
