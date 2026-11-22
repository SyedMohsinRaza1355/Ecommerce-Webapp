import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { findOrderByToken } from "@/lib/commerce/orders";
import { reconcileStripePayment } from "@/lib/commerce/payflow";
import { LiveRefresh } from "@/components/store/Bits";
import { OrderStepper, NEXT_TEXT } from "@/components/store/OrderStepper";
import { currentCustomer } from "@/lib/commerce/customers";
import { Icon } from "@/components/Icons";
import { fmtDate, fmtMoney, t } from "@/lib/i18n";
import { retryPaymentAction, returnAction } from "../../actions";
import { returnForOrder } from "@/lib/commerce/growth";
import AcctForm from "@/components/store/AcctForm";

export const metadata = { title: "Your order", robots: { index: false, follow: false } };

const STEP_TEXT: Record<string, string> = {
  pending: "Order received", confirmed: "Order confirmed", processing: "Being prepared", ready: "Ready", fulfilled: "On its way / handed over", completed: "Completed", cancelled: "Cancelled",
};

const PAY_TEXT: Record<string, string> = { captured: "Payment received", failed: "Payment failed", requires_payment: "Waiting for payment", partially_refunded: "Partly refunded", refunded: "Refunded", cod_due: "Pay on delivery" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ sub: string; token: string }>; searchParams: Promise<{ return?: string }> }) {
  const { sub, token } = await params;
  const { return: returned } = await searchParams;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  let o = await findOrderByToken(s.ctx, token);
  if (!o) notFound();
  if (returned === "1" && o.payment.provider === "stripe" && o.payment.state !== "captured") {
    // the customer just came back from Stripe: ask Stripe directly instead of waiting for the notification
    await reconcileStripePayment(s.ctx, o._id, async () => s.settings.branding.storeName || s.instance.name);
    o = (await findOrderByToken(s.ctx, token)) ?? o;
  }
  const L = s.locale;
  const guest = s.eff.get("F-045")?.enabled !== false && !(await currentCustomer(s));
  const money = (n: number) => fmtMoney(n, o.currency, L);
  const active = !["completed", "cancelled"].includes(o.state);
  const waitingPay = ["failed", "requires_payment"].includes(o.payment.state) && o.state === "pending";
  const rmaOn = s.eff.get("F-129")?.enabled === true;
  const rma = rmaOn ? await returnForOrder(s.ctx, o._id) : null;
  const events = o.history.filter((h) => h.kind === "order" || h.kind === "payment");

  return (
    <div className="mx-auto max-w-3xl">
      <LiveRefresh active={active} />
      <div className="card pop-in text-center">
        <span className="icon-chip mx-auto">{o.state === "cancelled" || waitingPay ? Icon.lock : Icon.check}</span>
        <h1 className="mt-4 text-2xl font-extrabold">{o.state === "cancelled" ? "Order cancelled" : o.payment.state === "failed" ? "Payment not completed" : o.payment.state === "requires_payment" ? "Almost done: complete your payment" : t(L, "orderPlaced")}</h1>
        <p className="mt-1 text-muted">{t(L, "orderNumber")} <strong>#{o.orderNo}</strong></p>
        <p className="mt-3 flex flex-wrap justify-center gap-2" aria-live="polite">
          <span className="badge badge-indigo">{t(L, "status")}: {STEP_TEXT[o.state] ?? o.state}</span>
          <span className={`badge ${o.payment.state === "captured" ? "badge-green" : o.payment.state === "failed" ? "badge-red" : "badge-amber"}`}>
            {o.payment.method === "cod" ? t(L, "payCod") : o.payment.method === "manual" && o.payment.state === "requires_payment" ? (o.payment.manual?.reference ? "Payment being checked" : "Waiting for your payment") : o.payment.state === "captured" ? t(L, "paymentReceived") : o.payment.state === "failed" ? t(L, "paymentFailed") : o.payment.state.startsWith("refund") || o.payment.state === "partially_refunded" ? "Refunded" : t(L, "awaitingPayment")}
          </span>
        </p>
        {o.state !== "cancelled" && <OrderStepper state={o.state} />}
        <p className="mx-auto mt-4 max-w-md text-sm text-muted">{NEXT_TEXT[o.state] ?? ""}</p>
        {o.payment.state === "failed" && o.state === "pending" && (
          <form action={retryPaymentAction.bind(null, sub, token)} className="mt-4"><button className="btn btn-primary">{t(L, "tryAgain")}</button></form>
        )}
        {o.payment.state === "requires_payment" && o.state === "pending" && <Link href={`/s/${sub}/pay/${token}`} className="btn btn-primary mt-4">{t(L, "payNow")}</Link>}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="card" aria-labelledby="tl">
          <h2 id="tl" className="font-extrabold">{t(L, "timeline")}</h2>
          <ol className="timeline mt-4">
            {events.map((h, i) => (
              <li key={i}>
                <p className="font-semibold">{h.kind === "payment" ? PAY_TEXT[h.to ?? ""] ?? h.to : STEP_TEXT[h.to ?? ""] ?? h.to}</p>
                <p className="text-xs text-muted">{fmtDate(h.at, L)}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="card" aria-labelledby="its">
          <h2 id="its" className="font-extrabold">{t(L, "items")}</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {o.items.map((i) => <li key={i.productId} className="flex justify-between gap-2"><span>{i.qty} x {i.name}</span><span>{money(i.lineMinor)}</span></li>)}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><dt>{t(L, "subtotal")}</dt><dd>{money(o.subtotalMinor)}</dd></div>
            {o.discountMinor > 0 && <div className="flex justify-between"><dt>{t(L, "discount")}</dt><dd>-{money(o.discountMinor)}</dd></div>}
            <div className="flex justify-between"><dt>{t(L, "shipping")}</dt><dd>{o.shippingMinor ? money(o.shippingMinor) : t(L, "free")}</dd></div>
            {o.taxMinor > 0 && <div className="flex justify-between"><dt>{t(L, "tax")}</dt><dd>{money(o.taxMinor)}</dd></div>}
            <div className="flex justify-between text-base font-extrabold"><dt>{t(L, "total")}</dt><dd>{money(o.totalMinor)}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-muted">{o.customer.name}, {o.customer.address}, {o.customer.city}</p>
          {s.settings.contactEmail && <p className="mt-1 text-xs text-muted">Questions? {s.settings.contactEmail}</p>}
        </section>
      </div>
      {rmaOn && (rma && rma.state !== "rejected" ? (
        <section className="card mt-6" aria-labelledby="rma">
          <h2 id="rma" className="font-extrabold">Your {rma.kind} request</h2>
          <p className="mt-1 text-sm">Status: <strong>{({ requested: "Waiting for review", approved: "Approved: please send the items back", rejected: "Not approved", received: "Items received", refunded: "Refunded" } as Record<string, string>)[rma.state]}</strong></p>
          {rma.note && <p className="mt-1 text-sm text-muted">{rma.note}</p>}
        </section>
      ) : ["fulfilled", "completed"].includes(o.state) && (
        <details className="card mt-6">
          <summary className="cursor-pointer font-extrabold">Return or exchange something</summary>
          <p className="mt-2 text-sm text-muted">{rma?.state === "rejected" ? `Your last request was not approved${rma.note ? `: ${rma.note}` : ""}. You can send a new one.` : "Tell us what went wrong and we will help."}</p>
          <div className="mt-3 max-w-md">
            <AcctForm action={returnAction.bind(null, sub, token)} submit="Send request" fields={[{ name: "reason", label: "What is the problem?", required: true, maxLength: 1000 }]}>
              <label className="field"><span>What would you like?</span><select className="input" name="kind" defaultValue="return"><option value="return">Return for a refund</option><option value="exchange">Exchange</option></select></label>
            </AcctForm>
          </div>
        </details>
      ))}
      {guest && (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm"><strong>Shopping here again?</strong> Create an account to see all your orders in one place and check out faster.</p>
          <Link href={`/s/${sub}/account/register?next=${encodeURIComponent(`/s/${sub}/account`)}`} className="btn btn-secondary">{t(L, "createAccount")}</Link>
        </div>
      )}
      <p className="mt-6 flex flex-wrap justify-center gap-2"><Link href={`/s/${sub}`} className="btn btn-secondary">{t(L, "continueShopping")}</Link>{s.settings.contactEmail && <a href={`mailto:${s.settings.contactEmail}?subject=${encodeURIComponent(`Order #${o.orderNo}`)}`} className="btn btn-secondary">Contact the shop</a>}</p>
    </div>
  );
}
