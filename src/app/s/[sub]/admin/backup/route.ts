import { loadStore, getStaff } from "@/lib/commerce/load";
import { authorize } from "@/lib/auth/rbac";
import { buildBackup } from "@/lib/commerce/extras";
import { logActivity } from "@/lib/commerce/staff";

export const dynamic = "force-dynamic";

/** Store backup (F-111): owner only. Passwords, 2-step secrets and payment keys are never included. */
export async function GET(_req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const store = await loadStore(sub);
  if (store.status !== "ok") return new Response("Not found", { status: 404 });
  const staff = await getStaff(store);
  if (!staff || staff.impersonating || !authorize(staff.actor, "instance.export", store.ctx).allow) return new Response("Forbidden", { status: 403 });
  if (store.eff.get("F-111")?.enabled !== true) return new Response("Backups are turned off for this store", { status: 403 });
  await logActivity(store.ctx, staff.actor, "backup.download").catch(() => undefined);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(await buildBackup(store.ctx), null, 1), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${sub}-backup-${day}.json"`, "cache-control": "no-store" },
  });
}
