import { getActor } from "@/lib/auth/current";
import { authorize } from "@/lib/auth/rbac";
import { platformDb } from "@/lib/db/client";
import { tenantDb } from "@/lib/tenant/schema";
import { issueTenantContext } from "@/lib/tenant/context";
import { appendAudit } from "@/lib/audit/log";
import type { InstanceRecord } from "@/lib/tenant/resolve";

export const dynamic = "force-dynamic";

/** Per-store data export for the Super Admin (SA-09). Secrets and password hashes are never included. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || !authorize(actor, "instance.suspend").allow) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  if (!/^[a-z0-9]{12}$/.test(id)) return new Response("Not found", { status: 404 });
  const inst = await (await platformDb()).collection<InstanceRecord>("instances").findOne({ _id: id });
  if (!inst) return new Response("Not found", { status: 404 });
  const db = await tenantDb(issueTenantContext(id));
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), store: { id, name: inst.name, subdomain: inst.subdomain, plan: inst.planId } };
  for (const c of ["settings", "categories", "products", "orders", "discounts", "activity"]) {
    out[c] = await db.collection(c).find({ instanceId: id }).limit(5000).toArray();
  }
  out.users = (await db.collection("users").find({ instanceId: id }).limit(500).toArray()).map(({ passwordHash: _p, totp: _t, ...u }) => { void _p; void _t; return u; });
  await appendAudit({ actorId: actor.userId, actorRole: actor.role, instanceId: id, action: "instance.export", target: inst.subdomain, outcome: "success" });
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${inst.subdomain}-export.json"`, "cache-control": "no-store" },
  });
}
