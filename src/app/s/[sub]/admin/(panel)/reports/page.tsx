import { guard } from "@/lib/commerce/guard";
import { authorize } from "@/lib/auth/rbac";
import { productReport, customerReport, taxReport } from "@/lib/commerce/extras";
import { fmtMoney } from "@/lib/i18n";
import { AF } from "@/components/admin/Forms";
import { importProductsAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Reports and data" };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { sub } = await params;
  const { from: f, to: t } = await searchParams;
  const { store, staff } = await guard(sub, "reports.view");
  const now = new Date();
  const to = t && !Number.isNaN(Date.parse(t)) ? new Date(Date.parse(t) + 86_400_000) : new Date(now.getTime() + 86_400_000);
  const from = f && !Number.isNaN(Date.parse(f)) ? new Date(Date.parse(f)) : new Date(now.getTime() - 30 * 86_400_000);
  const cur = store.settings.currency;
  const m = (n: number) => fmtMoney(n, cur, "en");
  const on = (id: string) => store.eff.get(id)?.enabled === true;
  const [prod, cust, tax] = await Promise.all([
    on("F-094") ? productReport(store.ctx, from, to) : [],
    on("F-095") ? customerReport(store.ctx, from, to) : [],
    on("F-098") ? taxReport(store.ctx, from, to) : [],
  ]);
  const owner = authorize(staff.actor, "instance.export", store.ctx).allow && !staff.impersonating;
  const base = `/s/${sub}/admin`;
  const off = (id: string, name: string) => !on(id) && <p className="mt-2 text-sm text-muted">Turn on &quot;{name}&quot; in Features to see this report.</p>;

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Reports and data</h1>
        <p className="text-muted">Only paid and cash-on-delivery orders that were not cancelled are counted.</p>
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3" aria-label="Date range">
        <label className="field mb-0"><span>From</span><input className="input" type="date" name="from" defaultValue={iso(from)} /></label>
        <label className="field mb-0"><span>To</span><input className="input" type="date" name="to" defaultValue={iso(new Date(to.getTime() - 86_400_000))} /></label>
        <button className="btn btn-primary">Show</button>
      </form>

      <section className="card" aria-labelledby="pr">
        <h2 id="pr" className="text-lg font-extrabold">Best-selling products</h2>
        {off("F-094", "Product performance report")}
        {on("F-094") && (prod.length === 0 ? <p className="mt-2 text-sm text-muted">No sales in this period.</p> : (
          <div className="mt-3 overflow-x-auto"><table className="table"><thead><tr><th>Product</th><th>Sold</th><th>Revenue</th></tr></thead>
            <tbody>{prod.map((p) => <tr key={p._id}><td>{p.name}</td><td>{p.qty}</td><td>{m(p.revenueMinor)}</td></tr>)}</tbody></table></div>
        ))}
      </section>

      <section className="card" aria-labelledby="cr">
        <h2 id="cr" className="text-lg font-extrabold">Top customers</h2>
        {off("F-095", "Customer report")}
        {on("F-095") && (cust.length === 0 ? <p className="mt-2 text-sm text-muted">No customers in this period.</p> : (
          <div className="mt-3 overflow-x-auto"><table className="table"><thead><tr><th>Customer</th><th>Email</th><th>Orders</th><th>Spent</th></tr></thead>
            <tbody>{cust.map((c) => <tr key={c._id}><td>{c.name}</td><td dir="ltr" className="text-xs">{c._id}</td><td>{c.orders}</td><td>{m(c.spentMinor)}</td></tr>)}</tbody></table></div>
        ))}
      </section>

      <section className="card" aria-labelledby="tr">
        <h2 id="tr" className="text-lg font-extrabold">Tax summary by month</h2>
        {off("F-098", "Tax report")}
        {on("F-098") && (tax.length === 0 ? <p className="mt-2 text-sm text-muted">No sales in this period.</p> : (
          <div className="mt-3 overflow-x-auto"><table className="table"><thead><tr><th>Month</th><th>Orders</th><th>Sales before tax</th><th>Discounts</th><th>Shipping</th><th>Tax collected</th><th>Total</th></tr></thead>
            <tbody>{tax.map((r) => <tr key={r._id}><td>{r._id}</td><td>{r.orders}</td><td>{m(r.subtotalMinor)}</td><td>{m(r.discountMinor)}</td><td>{m(r.shippingMinor)}</td><td>{m(r.taxMinor)}</td><td>{m(r.totalMinor)}</td></tr>)}</tbody></table></div>
        ))}
      </section>

      <section className="card" aria-labelledby="ex">
        <h2 id="ex" className="text-lg font-extrabold">Download your data</h2>
        {store.eff.get("F-096")?.enabled === false ? <p className="mt-2 text-sm text-muted">Data export is turned off in Features.</p> : (
          <p className="mt-3 flex flex-wrap gap-2">
            {(["orders", "products", "customers"] as const).map((k) => <a key={k} className="btn btn-secondary" href={`${base}/export/${k}`}>{k[0].toUpperCase() + k.slice(1)} (CSV)</a>)}
            {owner && on("F-111") && <a className="btn btn-secondary" href={`${base}/backup`}>Full backup (JSON)</a>}
          </p>
        )}
        {owner && !on("F-111") && <p className="hint mt-2">Turn on &quot;Store backup download&quot; in Features to get a complete backup file.</p>}
      </section>

      {store.eff.get("F-011")?.enabled !== false && (
        <section className="card" aria-labelledby="im">
          <h2 id="im" className="text-lg font-extrabold">Import products from a spreadsheet</h2>
          <p className="mt-1 text-sm text-muted">Use a CSV file with the columns <code>name, price, stock, category, description, status, image</code>. Only name and price are required. Set <code>status</code> to <code>published</code> to show items right away. Tip: download &quot;Products (CSV)&quot; above and edit it. Up to 500 products at a time.</p>
          <AF action={importProductsAction.bind(null, sub)} submit="Import products" className="mt-3">
            <label className="field"><span>CSV file</span><input className="input" type="file" name="file" accept=".csv,text/csv" required /></label>
          </AF>
        </section>
      )}
    </div>
  );
}
