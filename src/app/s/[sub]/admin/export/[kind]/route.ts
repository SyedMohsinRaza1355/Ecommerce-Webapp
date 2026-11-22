import { loadStore, getStaff } from "@/lib/commerce/load";
import { authorize } from "@/lib/auth/rbac";
import { exportCsv } from "@/lib/commerce/extras";
import { logActivity } from "@/lib/commerce/staff";

export const dynamic = "force-dynamic";
const KINDS = ["orders", "products", "customers", "newsletter", "ledger"] as const;

/** CSV download (F-096). Staff only, and cells that could run as spreadsheet formulas are neutralised. */
export async function GET(_req: Request, { params }: { params: Promise<{ sub: string; kind: string }> }) {
  const { sub, kind } = await params;
  const store = await loadStore(sub);
  if (store.status !== "ok") return new Response("Not found", { status: 404 });
  const staff = await getStaff(store);
  if (!staff || !authorize(staff.actor, "reports.view", store.ctx).allow) return new Response("Forbidden", { status: 403 });
  if (store.eff.get("F-096")?.enabled === false) return new Response("Data export is turned off for this store", { status: 403 });
  if (!(KINDS as readonly string[]).includes(kind)) return new Response("Not found", { status: 404 });
  if (kind === "ledger" && store.eff.get("F-101")?.enabled !== true) return new Response("The accounting export is turned off for this store", { status: 403 });
  await logActivity(store.ctx, staff.actor, "export.csv", kind).catch(() => undefined);
  return new Response(await exportCsv(store.ctx, kind as (typeof KINDS)[number]), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${sub}-${kind}.csv"`, "cache-control": "no-store" },
  });
}
