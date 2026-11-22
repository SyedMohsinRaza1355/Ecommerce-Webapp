import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { guard } from "@/lib/commerce/guard";
import { authorize } from "@/lib/auth/rbac";
import { orders } from "@/lib/commerce/orders";
import { nextOrderStates, roleMayMoveOrder } from "@/lib/commerce/states";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import { formatMajor, money as toMoney } from "@/lib/money/money";
import { ActionButton, AF } from "@/components/admin/Forms";
import { orderStatusAction, refundAction, confirmPaymentAction, orderNoteAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Order" };

export default async function OrderDetail({ params }: { params: Promise<{ sub: string; id: string }> }) {
  const { sub, id } = await params;
  const { store, staff } = await guard(sub, "orders.updateStatus");
  const o = await orders.findById(store.ctx, id);
  if (!o) notFound();
  const money = (n: number) => fmtMoney(n, o.currency, "en");
  const canRefund = authorize(staff.actor, "orders.process", store.ctx).allow && ["captured", "partially_refunded"].includes(o.payment.state);
  const nexts = nextOrderStates(o.state).filter((s) => roleMayMoveOrder(staff.actor.role, s) && !(s === "confirmed" && o.payment.method !== "cod" && o.payment.state !== "captured"));
  const remaining = o.totalMinor - o.payment.refundedMinor;

  return (
    <div>
      <Link href={`/s/${sub}/admin/orders`} className="text-sm text-muted underline">All orders</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Order #{o.orderNo}</h1>
        <span className="badge badge-indigo">{o.state}</span>
        <span className="badge badge-slate">{o.payment.method} / {o.payment.state.replace(/_/g, " ")}</span>
        {o.flags?.refundRequired && <span className="badge badge-red">Refund due</span>}
      </div>
      <p className="text-sm text-muted">Placed {fmtDate(o.createdAt, "en")}</p>
      {(store.eff.get("F-036")?.enabled !== false || store.eff.get("F-070")?.enabled === true) && (
        <p className="mt-2 flex flex-wrap gap-2">
          {store.eff.get("F-036")?.enabled !== false && <a className="btn btn-secondary" href={`/s/${sub}/admin/print/${o._id}`} target="_blank" rel="noopener noreferrer">Print receipt</a>}
          {store.eff.get("F-070")?.enabled === true && <a className="btn btn-secondary" href={`/s/${sub}/admin/print/${o._id}?kind=slip`} target="_blank" rel="noopener noreferrer">Print packing slip</a>}
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="it">
          <h2 id="it" className="font-extrabold">Items</h2>
          <table className="table mt-2">
            <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.productId}><td>{i.name}</td><td>{i.qty}</td><td>{money(i.unitMinor)}</td><td>{money(i.lineMinor)}</td></tr>)}</tbody>
          </table>
          <dl className="mt-3 ms-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotalMinor)}</dd></div>
            {o.discountMinor > 0 && <div className="flex justify-between"><dt>Discount {o.discountCode}</dt><dd>-{money(o.discountMinor)}</dd></div>}
            <div className="flex justify-between"><dt>Shipping</dt><dd>{money(o.shippingMinor)}</dd></div>
            <div className="flex justify-between"><dt>Tax</dt><dd>{money(o.taxMinor)}</dd></div>
            <div className="flex justify-between border-t border-line pt-1 text-base font-extrabold"><dt>Total</dt><dd>{money(o.totalMinor)}</dd></div>
            {o.payment.refundedMinor > 0 && <div className="flex justify-between text-red-800"><dt>Refunded</dt><dd>-{money(o.payment.refundedMinor)}</dd></div>}
          </dl>
        </section>
        <section className="card" aria-labelledby="cu">
          <h2 id="cu" className="font-extrabold">Customer</h2>
          <p className="mt-2 text-sm">{o.customer.name}<br />{o.customer.email}<br />{o.customer.phone}<br />{o.customer.address}, {o.customer.city}</p>
          {o.customer.notes && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm">Note: {o.customer.notes}</p>}
        </section>
      </div>

      {o.payment.method === "manual" && o.payment.manual && (
        <section className="card mt-5 border-amber-300" aria-labelledby="mp">
          <h2 id="mp" className="font-extrabold">Manual payment: {o.payment.manual.label}</h2>
          {o.payment.state === "requires_payment" ? (
            <>
              <p className="mt-1 text-sm">Waiting for <strong>{money(o.totalMinor)}</strong> to arrive in {o.payment.manual.accountTitle} ({o.payment.manual.accountNumber}).</p>
              <p className="mt-1 text-sm">{o.payment.manual.reference ? <>Customer says they paid. Reference: <strong dir="ltr">{o.payment.manual.reference}</strong>. Check your account, then confirm.</> : "The customer has not entered a transaction reference yet."}</p>
              {o.state !== "cancelled" && <div className="mt-3"><ActionButton label="Mark as paid" secondary={false} confirmText="Confirm that the money has arrived in your account?" run={confirmPaymentAction.bind(null, sub, o._id)} /></div>}
            </>
          ) : <p className="mt-1 text-sm">Payment confirmed.{o.payment.manual.reference ? <> Reference: <strong dir="ltr">{o.payment.manual.reference}</strong>.</> : null}</p>}
        </section>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card" aria-labelledby="ac">
          <h2 id="ac" className="font-extrabold">Move this order</h2>
          {nexts.length === 0 ? <p className="mt-2 text-sm text-muted">No further steps are available to you.</p> : (
            <div className="mt-3 flex flex-wrap gap-2">
              {nexts.map((s) => (
                <ActionButton key={s} label={`Mark ${s}`} danger={s === "cancelled"} secondary={s !== "cancelled" && s !== nexts[0]}
                  confirmText={s === "cancelled" ? "Cancel this order? Stock goes back on the shelf." : undefined}
                  run={orderStatusAction.bind(null, sub, o._id, s)} />
              ))}
            </div>
          )}
        </section>
        {canRefund && (
          <section className="card" aria-labelledby="rf">
            <h2 id="rf" className="font-extrabold">Refund</h2>
            <p className="text-sm text-muted">Up to {money(remaining)} can still be refunded. {o.payment.provider === "stripe" ? "The money goes back to the customer's card through Stripe." : "This records the refund. Send the money back to the customer yourself (cash, transfer or wallet)."}</p>
            {remaining > 0 && (
              <AF action={refundAction.bind(null, sub, o._id)} submit="Issue refund" className="mt-3">
                <input type="hidden" name="key" value={randomUUID()} />
                <label className="field"><span>Amount</span><input className="input" name="amount" inputMode="decimal" placeholder={formatMajor(toMoney(remaining, o.currency))} dir="ltr" required /></label>
              </AF>
            )}
          </section>
        )}
      </div>

      {store.eff.get("F-032")?.enabled !== false && (
        <section className="card mt-5" aria-labelledby="nt">
          <h2 id="nt" className="font-extrabold">Staff notes</h2>
          <p className="text-sm text-muted">Only your team can see these. Customers never do.</p>
          <AF action={orderNoteAction.bind(null, sub, o._id)} submit="Add note" className="mt-3">
            <label className="field"><span>Note</span><input className="input" name="note" maxLength={500} required /></label>
          </AF>
        </section>
      )}

      <section className="card mt-5" aria-labelledby="hi">
        <h2 id="hi" className="font-extrabold">History</h2>
        <ol className="timeline mt-4">
          {[...o.history].reverse().map((h, i) => (
            <li key={i}><p className="text-sm font-semibold">{h.kind === "note" ? `Note: ${h.note}` : `${h.kind}: ${h.from ? `${h.from} → ` : ""}${h.to}${h.note ? ` (${h.note})` : ""}`}</p><p className="text-xs text-muted">{fmtDate(h.at, "en")} by {h.by}</p></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
