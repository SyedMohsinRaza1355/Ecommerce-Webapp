import Link from "next/link";
import { guard } from "@/lib/commerce/guard";
import { getPaymentConfig, MANUAL_KIND_LABEL, webhookUrlFor } from "@/lib/payments/config";
import { AF, ActionButton } from "@/components/admin/Forms";
import { connectStripeAction, disconnectStripeAction, testModeAction, manualMethodAction, manualMethodOpAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store, staff } = await guard(sub, "payments.manage");
  const cfg = await getPaymentConfig(store.ctx);
  const st = cfg.stripe;
  const b = `/s/${sub}/admin`;
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Payments</h1>
        <p className="text-muted">Connect your own accounts here. Customer payments go straight to <strong>you</strong>, never through the platform.</p>
        {staff.impersonating && <p className="err mt-2">Support sessions cannot change payment settings.</p>}
      </div>

      <section className="card" aria-labelledby="stripe-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="stripe-h" className="text-lg font-extrabold">Card payments with Stripe</h2>
          {st ? <span className={`badge ${st.livemode ? "badge-green" : "badge-amber"}`}>{st.livemode ? "Connected: live" : "Connected: test mode"}</span> : <span className="badge badge-slate">Not connected</span>}
        </div>

        {st ? (
          <div className="mt-3 space-y-3 text-sm">
            <p>Account: <strong>{st.accountName}</strong> <span className="text-muted">(key {st.keyHint})</span></p>
            <p className="text-muted">{st.livemode ? "Live mode: customers are charged real money and Stripe pays it out to your bank." : "Test mode: use Stripe's test card 4242 4242 4242 4242 with any future date and any CVC. No real money moves. Replace the key with your live key (sk_live_...) when you are ready."}</p>
            {st.webhookId ? <p className="ok">Automatic payment notifications are registered in your Stripe account.</p> : <p className="hint">{st.webhookWarning}</p>}
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Disconnect Stripe" danger confirmText="Disconnect Stripe? Customers will not be able to pay by card until you connect again." run={disconnectStripeAction.bind(null, sub)} />
            </div>
            <details className="rounded-xl bg-slate-50 p-3 ring-1 ring-line">
              <summary className="cursor-pointer font-semibold">Replace the key (for example, switch to live)</summary>
              <AF action={connectStripeAction.bind(null, sub)} submit="Connect with new key" className="mt-3">
                <label className="field"><span>Stripe secret key</span><input className="input" name="secretKey" autoComplete="off" spellCheck={false} placeholder="sk_live_..." dir="ltr" /></label>
              </AF>
            </details>
          </div>
        ) : (
          <div className="mt-3">
            <ol className="list-decimal space-y-1 ps-5 text-sm">
              <li>Create a free account at <a className="underline" href="https://dashboard.stripe.com/register" target="_blank" rel="noopener noreferrer">stripe.com</a> (or sign in).</li>
              <li>Open <a className="underline" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer">Developers, API keys</a> in Stripe.</li>
              <li>Copy the <strong>Secret key</strong> (starts with <code>sk_test_</code> to try it safely, or <code>sk_live_</code> for real payments).</li>
              <li>Paste it below and press <strong>Connect</strong>. That is all: we set up everything else for you.</li>
            </ol>
            <AF action={connectStripeAction.bind(null, sub)} submit="Connect Stripe" className="mt-4">
              <label className="field"><span>Stripe secret key</span><input className="input" name="secretKey" autoComplete="off" spellCheck={false} placeholder="sk_test_..." dir="ltr" required /><p className="hint">Stored encrypted. Nobody on the platform team can read it back.</p></label>
            </AF>
            <p className="hint mt-3">Stripe is not available to businesses registered in every country (for example Pakistan). If that is you, use the Easypaisa, JazzCash or bank transfer options below, which need no gateway.</p>
          </div>
        )}
      </section>

      {!st && (
        <section className="card" aria-labelledby="test-h">
          <h2 id="test-h" className="text-lg font-extrabold">Test payments</h2>
          <p className="mt-1 text-sm text-muted">A pretend card page so you can try the whole buying journey. No real money. Turn it off before you start selling.</p>
          <p className="mt-3 flex items-center gap-3">
            <span className={`badge ${cfg.testMode ? "badge-amber" : "badge-slate"}`}>{cfg.testMode ? "On" : "Off"}</span>
            <ActionButton label={cfg.testMode ? "Turn off" : "Turn on"} run={testModeAction.bind(null, sub, !cfg.testMode)} />
          </p>
        </section>
      )}

      <section className="card" aria-labelledby="manual-h">
        <h2 id="manual-h" className="text-lg font-extrabold">Easypaisa, JazzCash and bank transfer</h2>
        <p className="mt-1 text-sm text-muted">The customer sends the money to your account, types in the transaction number from their receipt, and you press <em>Mark as paid</em> once you see it in your account. No gateway or fees needed.</p>
        {cfg.manual.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-xl ring-1 ring-line">
            {cfg.manual.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-semibold">{m.label} <span className={`badge ms-2 ${m.enabled ? "badge-green" : "badge-slate"}`}>{m.enabled ? "Shown at checkout" : "Hidden"}</span></p>
                  <p className="text-sm text-muted">{m.accountTitle}, {m.accountNumber}</p>
                </div>
                <div className="flex gap-2">
                  <ActionButton label={m.enabled ? "Hide" : "Show"} run={manualMethodOpAction.bind(null, sub, m.id, m.enabled ? "disable" : "enable")} />
                  <ActionButton label="Remove" danger confirmText="Remove this payment method?" run={manualMethodOpAction.bind(null, sub, m.id, "remove")} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-5 font-extrabold">Add a method</h3>
        <AF action={manualMethodAction.bind(null, sub)} submit="Add method" className="mt-2">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <label className="field"><span>Type</span>
              <select className="input" name="kind" defaultValue="easypaisa">{(Object.keys(MANUAL_KIND_LABEL) as (keyof typeof MANUAL_KIND_LABEL)[]).map((k) => <option key={k} value={k}>{MANUAL_KIND_LABEL[k]}</option>)}</select>
            </label>
            <label className="field"><span>Name shown to customers (optional)</span><input className="input" name="label" maxLength={40} placeholder="e.g. Easypaisa" /></label>
            <label className="field"><span>Account holder name</span><input className="input" name="accountTitle" required maxLength={80} /></label>
            <label className="field"><span>Account or phone number</span><input className="input" name="accountNumber" required maxLength={40} dir="ltr" placeholder="0300 1234567 or IBAN" /></label>
          </div>
          <label className="field"><span>Instructions (optional)</span><input className="input" name="instructions" maxLength={400} placeholder="e.g. Send the exact total and keep the receipt." /></label>
        </AF>
      </section>

      <section className="card" aria-labelledby="cod-h">
        <h2 id="cod-h" className="text-lg font-extrabold">Cash on delivery</h2>
        <p className="mt-1 text-sm text-muted">Turn it on or off in <Link className="underline" href={`${b}/features`}>Features</Link> (search for &quot;Cash on delivery&quot;).</p>
      </section>

      {webhookUrlFor(store.instance._id) && <p className="hint">Technical detail: your Stripe notification address is <code dir="ltr">{webhookUrlFor(store.instance._id)}</code>. It is registered for you automatically.</p>}
    </div>
  );
}
