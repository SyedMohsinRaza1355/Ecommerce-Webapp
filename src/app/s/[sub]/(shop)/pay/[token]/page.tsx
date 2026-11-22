import { notFound, redirect } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { findOrderByToken } from "@/lib/commerce/orders";
import { fmtMoney, t } from "@/lib/i18n";
import { Icon } from "@/components/Icons";
import AcctForm from "@/components/store/AcctForm";
import { payAction, stripePayAction, reportPaymentAction } from "../../actions";

export const metadata = { title: "Payment", robots: { index: false } };

export default async function PayPage({ params, searchParams }: { params: Promise<{ sub: string; token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { sub, token } = await params;
  const { error } = await searchParams;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  const o = await findOrderByToken(s.ctx, token);
  if (!o) notFound();
  const L = s.locale;
  if (o.payment.state !== "requires_payment") redirect(`/s/${sub}/order/${token}`);
  const m = o.payment.manual;

  return (
    <div className="mx-auto max-w-md">
      <div className="card pop-in text-center">
        <span className="icon-chip mx-auto">{Icon.lock}</span>
        <h1 className="mt-4 text-xl font-extrabold">{m ? `Pay with ${m.label}` : t(L, "paymentPage")}</h1>
        <p className="mt-5 text-sm text-muted">{t(L, "orderNumber")} #{o.orderNo}</p>
        <p className="text-4xl font-extrabold">{fmtMoney(o.totalMinor, o.currency, L)}</p>
        {error && <p role="alert" className="err mt-4">{error}</p>}

        {o.payment.provider === "stripe" && (
          <>
            <p className="mt-2 text-sm text-muted">You will be taken to Stripe&apos;s secure page. Your card details never touch this store.</p>
            <form action={stripePayAction.bind(null, sub, token)} className="mt-6"><button className="btn btn-primary w-full">Pay securely with card</button></form>
          </>
        )}

        {o.payment.provider === "test" && (
          <>
            <p className="mt-1 text-sm text-muted">Test gateway: no real card or money is used.</p>
            <form action={payAction.bind(null, sub, token, "succeeded")} className="mt-6"><button className="btn btn-primary w-full">{t(L, "simulateSuccess")}</button></form>
            <form action={payAction.bind(null, sub, token, "failed")} className="mt-3"><button className="btn btn-secondary w-full">{t(L, "simulateFail")}</button></form>
          </>
        )}

        {m && (
          <div className="mt-4 text-start">
            <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-line">
              <p className="text-sm text-muted">Send exactly <strong>{fmtMoney(o.totalMinor, o.currency, L)}</strong> to:</p>
              <p className="mt-1 font-extrabold">{m.accountTitle}</p>
              <p className="font-mono text-lg" dir="ltr">{m.accountNumber}</p>
              <p className="mt-2 text-sm">Reference: <strong>Order #{o.orderNo}</strong></p>
              {m.instructions && <p className="mt-2 text-sm text-muted">{m.instructions}</p>}
            </div>
            <p className="mt-4 text-sm">After you pay, enter the transaction number from your receipt so we can match it.</p>
            {m.reference ? (
              <p role="status" className="ok mt-3">We have your reference <strong dir="ltr">{m.reference}</strong>. We will confirm your payment shortly and email you.</p>
            ) : null}
            <div className="mt-3">
              <AcctForm action={reportPaymentAction.bind(null, sub, token)} submit={m.reference ? "Update reference" : "I have paid"} fields={[{ name: "reference", label: "Transaction or reference number", required: true, maxLength: 60, dir: "ltr" }]} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
