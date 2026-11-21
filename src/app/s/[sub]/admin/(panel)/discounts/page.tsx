import { guard } from "@/lib/commerce/guard";
import { tenantDb } from "@/lib/tenant/schema";
import { AF } from "@/components/admin/Forms";
import { discountAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Discounts" };

type D = { code: string; percentBps: number; active: boolean; maxUses: number | null; used: number; expiresAt: Date | null };

export default async function DiscountsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "promotions.manage");
  const db = await tenantDb(store.ctx);
  const rows = await db.collection<D>("discounts").find({ instanceId: store.ctx.instanceId }).sort({ createdAt: -1 }).limit(100).toArray();
  const on = store.feat.discounts;
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Discount codes</h1>
      {!on && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">Discount codes are switched off for your store. Turn on &ldquo;Discount codes&rdquo; under Features for customers to use them.</p>}
      <AF action={discountAction.bind(null, sub)} submit="Create code" className="card mt-5">
        <input type="hidden" name="op" value="create" />
        <div className="grid gap-x-4 sm:grid-cols-2">
          <label className="field"><span>Code</span><input className="input" name="code" placeholder="WEEKDAY10" maxLength={30} dir="ltr" required /></label>
          <label className="field"><span>Percent off</span><input className="input" name="percent" inputMode="decimal" placeholder="10" dir="ltr" required /></label>
          <label className="field"><span>Maximum uses (optional)</span><input className="input" name="maxUses" inputMode="numeric" placeholder="100" dir="ltr" /></label>
          <label className="field"><span>Expires on (optional)</span><input className="input" name="expires" type="date" /></label>
        </div>
      </AF>
      <div className="card mt-5 overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Code</th><th>Discount</th><th>Used</th><th>Expires</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">No codes yet.</td></tr>}
            {rows.map((d) => (
              <tr key={d.code}>
                <td className="font-mono font-semibold">{d.code}</td>
                <td>{d.percentBps / 100}%</td>
                <td>{d.used}{d.maxUses !== null ? ` / ${d.maxUses}` : ""}</td>
                <td className="text-xs">{d.expiresAt ? new Date(d.expiresAt).toLocaleDateString() : "Never"}</td>
                <td><span className={`badge ${d.active ? "badge-green" : "badge-slate"}`}>{d.active ? "Active" : "Off"}</span></td>
                <td className="text-end">
                  <AF action={discountAction.bind(null, sub)} submit={d.active ? "Turn off" : "Turn on"} secondary>
                    <input type="hidden" name="op" value="toggle" /><input type="hidden" name="code" value={d.code} />
                  </AF>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
