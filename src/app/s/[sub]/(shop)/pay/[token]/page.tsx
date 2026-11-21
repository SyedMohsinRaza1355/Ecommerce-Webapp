import { notFound, redirect } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { findOrderByToken } from "@/lib/commerce/orders";
import { fmtMoney, t } from "@/lib/i18n";
import { Icon } from "@/components/Icons";
import { payAction } from "../../actions";

export const metadata = { title: "Payment", robots: { index: false } };

/**
 * Stand-in for a payment provider's hosted page (DEC-02). No card fields exist here:
 * a real gateway would collect card data on its own domain and report the result by signed webhook.
 */
export default async function PayPage({ params }: { params: Promise<{ sub: string; token: string }> }) {
  const { sub, token } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  const o = await findOrderByToken(s.ctx, token);
  if (!o) notFound();
  const L = s.locale;
  if (o.payment.state !== "requires_payment") redirect(`/s/${sub}/order/${token}`);

  return (
    <div className="mx-auto max-w-md">
      <div className="card pop-in text-center">
        <span className="icon-chip mx-auto">{Icon.lock}</span>
        <h1 className="mt-4 text-xl font-extrabold">{t(L, "paymentPage")}</h1>
        <p className="mt-1 text-sm text-muted">Test gateway: no real card or money is used.</p>
        <p className="mt-5 text-sm text-muted">{t(L, "orderNumber")} #{o.orderNo}</p>
        <p className="text-4xl font-extrabold">{fmtMoney(o.totalMinor, o.currency, L)}</p>
        <form action={payAction.bind(null, sub, token, "succeeded")} className="mt-6">
          <button className="btn btn-primary w-full">{t(L, "simulateSuccess")}</button>
        </form>
        <form action={payAction.bind(null, sub, token, "failed")} className="mt-3">
          <button className="btn btn-secondary w-full">{t(L, "simulateFail")}</button>
        </form>
      </div>
    </div>
  );
}
