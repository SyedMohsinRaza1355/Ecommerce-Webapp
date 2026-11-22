import { guard } from "@/lib/commerce/guard";
import { listEndpoints, listApiKeys, recentDeliveries, WEBHOOK_EVENTS } from "@/lib/commerce/integrations";
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/i18n";
import { AF, ActionButton } from "@/components/admin/Forms";
import { webhookAddAction, webhookOpAction, webhookReplayAction, apiKeyCreateAction, apiKeyRevokeAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Integrations" };

const EVENT_TEXT: Record<(typeof WEBHOOK_EVENTS)[number], string> = { "order.created": "A new order is placed", "order.paid": "An order is paid", "order.status": "An order changes status", "order.refunded": "A refund is issued" };

export default async function IntegrationsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "settings.commerce");
  const [hooks, keys, log] = await Promise.all([listEndpoints(store.ctx), listApiKeys(store.ctx), recentDeliveries(store.ctx)]);
  const origin = /^(localhost|127\.)/.test(env().baseDomain) ? `http://${env().baseDomain}` : `https://${env().baseDomain}`;
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Integrations</h1>
        <p className="text-muted">Connect your store to other tools: get a message when orders happen, or let a spreadsheet or accounting tool read your data. For technical users or their helpers.</p>
      </div>

      <section className="card" aria-labelledby="wh">
        <h2 id="wh" className="text-lg font-extrabold">Webhooks</h2>
        <p className="mt-1 text-sm text-muted">We send a signed message to your web address whenever the chosen things happen. Failed messages are retried several times, and you can send any of them again.</p>
        {hooks.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-xl ring-1 ring-line">
            {hooks.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0"><p className="break-all font-mono text-sm" dir="ltr">{h.url}</p><p className="text-xs text-muted">{h.events.join(", ")} <span className={`badge ms-2 ${h.active ? "badge-green" : "badge-slate"}`}>{h.active ? "On" : "Off"}</span></p></div>
                <div className="flex gap-2">
                  <ActionButton label={h.active ? "Turn off" : "Turn on"} run={webhookOpAction.bind(null, sub, h.id, h.active ? "disable" : "enable")} />
                  <ActionButton label="Remove" danger confirmText="Remove this webhook?" run={webhookOpAction.bind(null, sub, h.id, "delete")} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-5 font-extrabold">Add a webhook</h3>
        <AF action={webhookAddAction.bind(null, sub)} submit="Add webhook" className="mt-2">
          <label className="field"><span>Web address (https)</span><input className="input" name="url" required dir="ltr" placeholder="https://example.com/hooks/orders" /></label>
          <fieldset className="mb-3"><legend className="mb-1 text-sm font-semibold">Tell me when</legend>
            {WEBHOOK_EVENTS.map((e) => <label key={e} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name={`ev_${e}`} defaultChecked /> {EVENT_TEXT[e]} <code className="text-xs text-muted">{e}</code></label>)}
          </fieldset>
        </AF>
        <p className="hint mt-3">Every message carries the header <code>X-Storeforge-Signature: t=timestamp,v1=hash</code>. The hash is HMAC-SHA256 of <code>timestamp.body</code> using your secret. Check it and reject old timestamps.</p>

        <h3 className="mt-6 font-extrabold">Delivery log</h3>
        {log.length === 0 ? <p className="mt-1 text-sm text-muted">Nothing sent yet.</p> : (
          <div className="mt-2 overflow-x-auto rounded-xl ring-1 ring-line">
            <table className="table">
              <thead><tr><th>When</th><th>Event</th><th>Status</th><th>Tries</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {log.map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap text-xs">{fmtDate(d.createdAt, "en")}</td><td className="text-xs">{d.event}</td>
                    <td><span className={`badge ${d.status === "sent" ? "badge-green" : d.status === "dead" ? "badge-red" : "badge-amber"}`}>{d.status === "dead" ? "failed for good" : d.status}</span>{d.lastError && <p className="text-xs text-muted">{d.lastError}</p>}</td>
                    <td>{d.attempts}</td>
                    <td className="text-end"><ActionButton label="Send again" run={webhookReplayAction.bind(null, sub, d.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="ak">
        <h2 id="ak" className="text-lg font-extrabold">API keys (read only)</h2>
        <p className="mt-1 text-sm text-muted">A key lets another program read your products and orders. It can never change anything. Keep it secret like a password.</p>
        {keys.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-xl ring-1 ring-line">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div><p className="font-semibold">{k.name} {k.revoked && <span className="badge badge-slate ms-1">Revoked</span>}</p><p className="font-mono text-xs text-muted" dir="ltr">{k.prefix}... {k.lastUsedAt ? `last used ${fmtDate(k.lastUsedAt, "en")}` : "never used"}</p></div>
                {!k.revoked && <ActionButton label="Revoke" danger confirmText="Revoke this key? Anything using it stops working." run={apiKeyRevokeAction.bind(null, sub, k.id)} />}
              </li>
            ))}
          </ul>
        )}
        <AF action={apiKeyCreateAction.bind(null, sub)} submit="Create key" className="mt-4">
          <label className="field"><span>What is it for?</span><input className="input" name="name" required maxLength={40} placeholder="Accounting sheet" /></label>
        </AF>
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-line">
          <p className="font-semibold">How to use a key</p>
          <pre className="mt-1 overflow-x-auto text-xs" dir="ltr">{`curl -H "Authorization: Bearer YOUR_KEY" ${origin}/api/v1/orders?limit=20
curl -H "Authorization: Bearer YOUR_KEY" ${origin}/api/v1/orders/1001
curl -H "Authorization: Bearer YOUR_KEY" ${origin}/api/v1/products`}</pre>
          <p className="mt-1 text-xs text-muted">Up to 120 requests a minute. Add <code>?before=2026-11-01T00:00:00Z</code> to see older items.</p>
        </div>
      </section>
    </div>
  );
}
