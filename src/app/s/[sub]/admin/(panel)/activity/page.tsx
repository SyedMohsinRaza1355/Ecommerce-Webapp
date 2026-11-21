import { guard } from "@/lib/commerce/guard";
import { tenantDb } from "@/lib/tenant/schema";
import { fmtDate } from "@/lib/i18n";

export const metadata = { title: "Activity" };

export default async function ActivityPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "activity.view");
  const rows = await (await tenantDb(store.ctx)).collection("activity").find({ instanceId: store.ctx.instanceId }).sort({ at: -1 }).limit(100).toArray();
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Staff activity</h1>
      <p className="mb-5 text-muted">What your team did recently. Entries cannot be edited.</p>
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>When</th><th>Role</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted">No activity yet.</td></tr>}
            {rows.map((r) => <tr key={String(r._id)}><td className="whitespace-nowrap text-xs">{fmtDate(r.at, "en")}</td><td><span className="badge badge-slate">{r.role}</span></td><td className="font-mono text-xs">{r.action}</td><td className="text-xs">{r.detail}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
