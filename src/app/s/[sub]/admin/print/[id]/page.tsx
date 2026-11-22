import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/commerce/load";
import { authorize } from "@/lib/auth/rbac";
import { orders } from "@/lib/commerce/orders";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import PrintButton from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Print", robots: { index: false } };

type Kind = "receipt" | "slip" | "thermal" | "ticket";

/**
 * Printable pages: A4 receipt, packing slip, 80 mm thermal receipt (till printers) and 80 mm kitchen ticket.
 * Kitchen staff may print tickets only; receipts need permission to process orders.
 */
export default async function PrintPage({ params, searchParams }: { params: Promise<{ sub: string; id: string }>; searchParams: Promise<{ kind?: string; auto?: string }> }) {
  const { sub, id } = await params;
  const sp = await searchParams;
  const kind: Kind = (["slip", "thermal", "ticket"] as const).find((k) => k === sp.kind) ?? "receipt";
  const { store, staff } = await requireStaff(sub);
  if (!authorize(staff.actor, "orders.updateStatus", store.ctx).allow) notFound();
  if (kind !== "ticket" && !authorize(staff.actor, "orders.process", store.ctx).allow) notFound(); // kitchen: tickets only
  const o = await orders.findById(store.ctx, id);
  if (!o) notFound();
  const money = (n: number) => fmtMoney(n, o.currency, "en");
  const name = store.settings.branding.storeName || store.instance.name;
  const narrow = kind === "thermal" || kind === "ticket";
  const inStore = o.source === "pos";
  const auto = sp.auto === "1";

  return (
    <div className={narrow ? "thermal-page mx-auto bg-white p-2 text-black" : "mx-auto max-w-2xl bg-white p-6 text-slate-900 print:p-0"}>
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <a className="text-sm underline" href={`/s/${sub}/admin/orders/${id}`}>Back to order</a>
        <PrintButton auto={auto} />
      </div>

      {kind === "ticket" ? (
        <>
          <p className="text-center text-lg font-extrabold">{name}</p>
          <p className="text-center text-3xl font-extrabold">#{o.orderNo}</p>
          <p className="text-center text-xs">{fmtDate(o.createdAt, "en")} · {inStore ? "In store" : o.customer.city === "In store" ? "In store" : "Online"}</p>
          <hr className="my-2 border-black" />
          <ul className="space-y-1 text-lg font-bold">{o.items.map((i) => <li key={i.productId}>{i.qty} x {i.name}</li>)}</ul>
          {o.customer.notes && <p className="mt-2 border-2 border-black p-1 text-sm font-bold">NOTE: {o.customer.notes}</p>}
          <hr className="my-2 border-black" />
          <p className="text-center text-xs">{o.customer.name}</p>
        </>
      ) : kind === "thermal" ? (
        <>
          <p className="text-center text-base font-extrabold">{name}</p>
          {store.settings.contactEmail && <p className="text-center text-[10px]">{store.settings.contactEmail}</p>}
          <p className="text-center text-[11px]">Receipt #{o.orderNo} · {fmtDate(o.createdAt, "en")}</p>
          {inStore && <p className="text-center text-[11px]">{o.customer.name}</p>}
          <hr className="my-1 border-dashed border-black" />
          <table className="w-full text-[12px]"><tbody>
            {o.items.map((i) => (
              <tr key={i.productId} className="align-top"><td className="pe-1">{i.qty} x {i.name}</td><td className="text-end">{money(i.lineMinor)}</td></tr>
            ))}
          </tbody></table>
          <hr className="my-1 border-dashed border-black" />
          <dl className="space-y-0.5 text-[12px]">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotalMinor)}</dd></div>
            {o.discountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>-{money(o.discountMinor)}</dd></div>}
            {o.shippingMinor > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{money(o.shippingMinor)}</dd></div>}
            {o.taxMinor > 0 && <div className="flex justify-between"><dt>Tax</dt><dd>{money(o.taxMinor)}</dd></div>}
            <div className="flex justify-between border-t border-black pt-0.5 text-sm font-extrabold"><dt>TOTAL</dt><dd>{money(o.totalMinor)}</dd></div>
            {o.payment.pos?.receivedMinor !== undefined && <><div className="flex justify-between"><dt>Cash</dt><dd>{money(o.payment.pos.receivedMinor)}</dd></div><div className="flex justify-between"><dt>Change</dt><dd>{money(o.payment.pos.changeMinor ?? 0)}</dd></div></>}
          </dl>
          <p className="mt-1 text-center text-[11px]">Paid by {o.payment.pos?.tender ?? o.payment.method} · {o.payment.state.replace(/_/g, " ")}</p>
          <p className="mt-2 text-center text-[11px]">Thank you!</p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-extrabold">{name}</h1>
          <p className="text-sm">{kind === "slip" ? "Packing slip" : "Receipt"} for order #{o.orderNo} · {fmtDate(o.createdAt, "en")}</p>
          {store.settings.contactEmail && <p className="text-sm">{store.settings.contactEmail}</p>}
          <div className="mt-4 rounded-lg border border-slate-300 p-3 text-sm">
            <p className="font-bold">{kind === "slip" ? "Ship to" : "Billed to"}</p>
            <p>{o.customer.name}<br />{o.customer.address}, {o.customer.city}<br />{o.customer.phone}</p>
            {o.customer.notes && <p className="mt-1"><strong>Customer note:</strong> {o.customer.notes}</p>}
          </div>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead><tr className="border-b-2 border-slate-900 text-start"><th className="py-1 text-start">Item</th><th className="text-start">Qty</th>{kind !== "slip" && <><th className="text-end">Price</th><th className="text-end">Total</th></>}</tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.productId} className="border-b border-slate-200"><td className="py-1">{kind === "slip" && <span aria-hidden="true">☐ </span>}{i.name}</td><td>{i.qty}</td>{kind !== "slip" && <><td className="text-end">{money(i.unitMinor)}</td><td className="text-end">{money(i.lineMinor)}</td></>}</tr>)}</tbody>
          </table>
          {kind !== "slip" && (
            <dl className="ms-auto mt-3 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotalMinor)}</dd></div>
              {o.discountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>-{money(o.discountMinor)}</dd></div>}
              <div className="flex justify-between"><dt>Shipping</dt><dd>{money(o.shippingMinor)}</dd></div>
              <div className="flex justify-between"><dt>Tax</dt><dd>{money(o.taxMinor)}</dd></div>
              <div className="flex justify-between border-t border-slate-900 pt-1 text-base font-extrabold"><dt>Total</dt><dd>{money(o.totalMinor)}</dd></div>
              <p className="pt-1 text-xs">Payment: {o.payment.pos?.tender ?? o.payment.method} ({o.payment.state.replace(/_/g, " ")})</p>
            </dl>
          )}
          {kind === "slip" && o.payment.method === "cod" && o.payment.state === "cod_due" && <p className="mt-4 rounded-lg border-2 border-slate-900 p-3 text-center text-lg font-extrabold">Collect on delivery: {money(o.totalMinor)}</p>}
        </>
      )}
    </div>
  );
}
