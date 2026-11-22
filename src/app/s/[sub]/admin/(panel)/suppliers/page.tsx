import { guard } from "@/lib/commerce/guard";
import { listSuppliers, listPurchaseOrders } from "@/lib/commerce/operations";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import { AF, ActionButton } from "@/components/admin/Forms";
import { supplierAction, supplierDeleteAction, purchaseOrderAction, purchaseOrderOpAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Suppliers" };

const BADGE = { draft: "badge-slate", ordered: "badge-amber", received: "badge-green", cancelled: "badge-red" } as const;

export default async function SuppliersPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "catalog.manage");
  const [sups, pos] = await Promise.all([listSuppliers(store.ctx), listPurchaseOrders(store.ctx)]);
  const cur = store.settings.currency;
  const m = (n: number) => fmtMoney(n, cur, "en");
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Suppliers and purchase orders</h1>
        <p className="text-muted">Keep your suppliers, write down what you ordered, and when the delivery arrives press Receive to add it to your stock.</p>
      </div>

      <section className="card" aria-labelledby="ns">
        <h2 id="ns" className="text-lg font-extrabold">Add a supplier</h2>
        <AF action={supplierAction.bind(null, sub)} submit="Save supplier" className="mt-3">
          <div className="grid gap-x-4 sm:grid-cols-3">
            <label className="field"><span>Name</span><input className="input" name="name" required maxLength={80} /></label>
            <label className="field"><span>Phone</span><input className="input" name="phone" type="tel" dir="ltr" maxLength={30} /></label>
            <label className="field"><span>Email</span><input className="input" name="email" type="email" dir="ltr" /></label>
          </div>
          <label className="field"><span>Note (what they supply, delivery days)</span><input className="input" name="note" maxLength={300} /></label>
        </AF>
        <ul className="mt-4 divide-y divide-line">
          {sups.length === 0 && <li className="py-3 text-sm text-muted">No suppliers yet.</li>}
          {sups.map((s) => (
            <li key={s._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="font-semibold">{s.name}</p><p className="text-xs text-muted">{[s.phone, s.email, s.note].filter(Boolean).join(" | ")}</p></div>
              <ActionButton label="Delete" danger confirmText={`Delete ${s.name}?`} run={supplierDeleteAction.bind(null, sub, s._id)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="np">
        <h2 id="np" className="text-lg font-extrabold">New purchase order</h2>
        {sups.length === 0 ? <p className="mt-2 text-sm text-muted">Add a supplier first.</p> : (
          <AF action={purchaseOrderAction.bind(null, sub)} submit="Create purchase order" className="mt-3">
            <label className="field"><span>Supplier</span><select className="input" name="supplierId" required>{sups.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
            <label className="field"><span>What you are ordering, one per line: product code x quantity @ unit cost</span><textarea className="input min-h-24" name="lines" required dir="ltr" placeholder={"BRG-CLS x 20 @ 300\nSDE-FRY x 50 @ 60"} /></label>
            <label className="field"><span>Note (optional)</span><input className="input" name="note" maxLength={300} /></label>
          </AF>
        )}
      </section>

      <section className="card overflow-x-auto p-0" aria-label="Purchase orders">
        <table className="table">
          <thead><tr><th>PO</th><th>Supplier</th><th>What</th><th>Total</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {pos.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">No purchase orders yet.</td></tr>}
            {pos.map((p) => (
              <tr key={p._id}>
                <td className="font-semibold">#{p.no}<p className="text-xs font-normal text-muted">{fmtDate(p.createdAt, "en")}</p></td>
                <td>{p.supplierName}</td>
                <td className="text-xs">{p.lines.map((l) => `${l.qty} x ${l.name}`).join(", ")}</td>
                <td>{m(p.totalMinor)}</td>
                <td><span className={`badge ${BADGE[p.status]}`}>{p.status}</span></td>
                <td className="text-end"><span className="flex flex-wrap justify-end gap-2">
                  {p.status === "draft" && <ActionButton label="Mark ordered" run={purchaseOrderOpAction.bind(null, sub, p._id, "ordered")} />}
                  {p.status === "ordered" && <ActionButton label="Receive into stock" secondary={false} run={purchaseOrderOpAction.bind(null, sub, p._id, "received")} />}
                  {(p.status === "draft" || p.status === "ordered") && <ActionButton label="Cancel" danger confirmText="Cancel this purchase order?" run={purchaseOrderOpAction.bind(null, sub, p._id, "cancelled")} />}
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
