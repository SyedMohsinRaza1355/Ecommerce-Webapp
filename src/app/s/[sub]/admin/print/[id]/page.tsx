import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/commerce/load";
import { authorize } from "@/lib/auth/rbac";
import { orders } from "@/lib/commerce/orders";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import PrintButton from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Print", robots: { index: false } };

/** Receipt (F-036) or packing slip (F-070): a plain, printer-friendly page. */
export default async function PrintPage({ params, searchParams }: { params: Promise<{ sub: string; id: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { sub, id } = await params;
  const { kind } = await searchParams;
  const { store, staff } = await requireStaff(sub);
  if (!authorize(staff.actor, "orders.updateStatus", store.ctx).allow) notFound();
  const slip = kind === "slip";
  if (store.eff.get(slip ? "F-070" : "F-036")?.enabled === false) notFound();
  const o = await orders.findById(store.ctx, id);
  if (!o) notFound();
  const money = (n: number) => fmtMoney(n, o.currency, "en");
  const name = store.settings.branding.storeName || store.instance.name;
  return (
    <div className="mx-auto max-w-2xl bg-white p-6 text-slate-900 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a className="text-sm underline" href={`/s/${sub}/admin/orders/${id}`}>Back to order</a>
        <PrintButton />
      </div>
      <h1 className="text-2xl font-extrabold">{name}</h1>
      <p className="text-sm">{slip ? "Packing slip" : "Receipt"} for order #{o.orderNo} · {fmtDate(o.createdAt, "en")}</p>
      {store.settings.contactEmail && <p className="text-sm">{store.settings.contactEmail}</p>}
      <div className="mt-4 rounded-lg border border-slate-300 p-3 text-sm">
        <p className="font-bold">{slip ? "Ship to" : "Billed to"}</p>
        <p>{o.customer.name}<br />{o.customer.address}, {o.customer.city}<br />{o.customer.phone}</p>
        {o.customer.notes && <p className="mt-1"><strong>Customer note:</strong> {o.customer.notes}</p>}
      </div>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead><tr className="border-b-2 border-slate-900 text-start"><th className="py-1 text-start">Item</th><th className="text-start">Qty</th>{!slip && <><th className="text-end">Price</th><th className="text-end">Total</th></>}</tr></thead>
        <tbody>{o.items.map((i) => <tr key={i.productId} className="border-b border-slate-200"><td className="py-1">{slip && <span aria-hidden="true">☐ </span>}{i.name}</td><td>{i.qty}</td>{!slip && <><td className="text-end">{money(i.unitMinor)}</td><td className="text-end">{money(i.lineMinor)}</td></>}</tr>)}</tbody>
      </table>
      {!slip && (
        <dl className="ms-auto mt-3 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotalMinor)}</dd></div>
          {o.discountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>-{money(o.discountMinor)}</dd></div>}
          <div className="flex justify-between"><dt>Shipping</dt><dd>{money(o.shippingMinor)}</dd></div>
          <div className="flex justify-between"><dt>Tax</dt><dd>{money(o.taxMinor)}</dd></div>
          <div className="flex justify-between border-t border-slate-900 pt-1 text-base font-extrabold"><dt>Total</dt><dd>{money(o.totalMinor)}</dd></div>
          <p className="pt-1 text-xs">Payment: {o.payment.method} ({o.payment.state.replace(/_/g, " ")})</p>
        </dl>
      )}
      {slip && o.payment.method === "cod" && o.payment.state === "cod_due" && <p className="mt-4 rounded-lg border-2 border-slate-900 p-3 text-center text-lg font-extrabold">Collect on delivery: {money(o.totalMinor)}</p>}
    </div>
  );
}
