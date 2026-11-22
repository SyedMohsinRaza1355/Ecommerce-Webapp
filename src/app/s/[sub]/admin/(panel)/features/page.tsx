import { guard } from "@/lib/commerce/guard";
import { featureStates, recentChanges } from "@/lib/commerce/features";
import { IMPLEMENTED } from "@/lib/toggles/handlers";
import { CATALOG } from "@/lib/toggles/catalog";
import { FeatureSwitch, ActionButton } from "@/components/admin/Forms";
import { Icon } from "@/components/Icons";
import { fmtDate } from "@/lib/i18n";
import { featureAction, undoAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Features" };

const LABEL: Record<string, string> = {
  catalog: "Catalog", menus: "Menus and service", inventory: "Inventory", orders: "Orders and checkout", payments: "Payments", customers: "Customers and accounts",
  marketing: "Marketing", shipping: "Shipping", content: "Content and branding", domains: "Domains and search", reporting: "Reporting and integrations", operations: "Operations",
};

export default async function FeaturesPage({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ q?: string; adv?: string; all?: string }> }) {
  const { sub } = await params;
  const sp = await searchParams;
  const { store } = await guard(sub, "toggle.enable");
  const [states, changes] = await Promise.all([featureStates(store.instance), recentChanges(store.ctx)]);
  const q = (sp.q ?? "").toLowerCase();
  const showAdv = sp.adv === "1";
  const showAll = sp.all === "1"; // by default owners only see features that really work
  const rows = states.filter((s) => (showAdv || !s.def.advanced) && (showAll || IMPLEMENTED.has(s.def.id)) && (!q || s.def.name.toLowerCase().includes(q) || s.def.id.toLowerCase().includes(q)));
  const builtCount = states.filter((s) => IMPLEMENTED.has(s.def.id)).length;
  const sections = Array.from(new Set(rows.map((r) => r.def.section)));
  const on = states.filter((s) => s.effective.enabled).length;

  return (
    <div>
      <h1 className="reveal text-2xl font-extrabold tracking-tight">Features</h1>
      <p className="reveal reveal-1 max-w-2xl text-muted">Switch on only what your business needs. If a feature needs another one, we tell you and can turn the whole chain on for you. Turning something off never deletes your data. <strong>{on}</strong> of {states.length} are on.</p>

      {changes.length > 0 && (
        <section className="card mt-5" aria-labelledby="und">
          <h2 id="und" className="font-extrabold">Undo recent changes</h2>
          <p className="text-sm text-muted">You can undo a change for 24 hours.</p>
          <ul className="mt-2 divide-y divide-line text-sm">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{c.keys.map((k) => CATALOG.get(k)?.name ?? k).join(", ")} <span className="text-xs text-muted">({fmtDate(c.at, "en")})</span></span>
                <ActionButton label="Undo" run={undoAction.bind(null, sub, c.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Summary">
        <span className="badge badge-green">{on} switched on</span>
        <span className="badge badge-indigo">{builtCount} ready to use</span>
        <span className="badge badge-slate">{states.length - builtCount} coming soon</span>
      </p>
      {sections.length > 1 && (
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Jump to a section">
          {sections.map((sec) => <a key={sec} href={`#s-${sec}`} className="badge badge-slate px-3 py-1.5 text-sm">{LABEL[sec] ?? sec}</a>)}
        </nav>
      )}

      <form method="get" className="card mt-5 flex flex-wrap items-end gap-3">
        <label className="field mb-0"><span>Search features</span><input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="variants, refunds, F-014" /></label>
        <label className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" name="adv" value="1" defaultChecked={showAdv} /> Show advanced capabilities</label>
        <label className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" name="all" value="1" defaultChecked={showAll} /> Also show features that are coming soon</label>
        <button className="btn btn-secondary">Apply</button>
      </form>

      {sections.map((sec) => (
        <section key={sec} className="mt-8" aria-labelledby={`s-${sec}`}>
          <h2 id={`s-${sec}`} className="text-lg font-extrabold">{LABEL[sec] ?? sec}</h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {rows.filter((r) => r.def.section === sec).map((r) => {
              const e = r.effective;
              const built = IMPLEMENTED.has(r.def.id);
              return (
                <li key={r.def.id} className="card flex items-start gap-3">
                  <FeatureSwitch
                    id={r.def.id}
                    name={r.def.name}
                    on={e.enabled}
                    requested={e.requested}
                    disabled={r.locked || r.outOfPlan}
                    title={r.locked ? "Managed by the platform administrator" : r.outOfPlan ? "Not in your plan" : undefined}
                    setFeature={featureAction.bind(null, sub)}
                  />
                  <div className="min-w-0 grow">
                    <p className="font-bold leading-tight">{r.def.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">{r.def.id}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`badge ${e.enabled ? "badge-green" : "badge-slate"}`}>{e.enabled ? "On" : "Off"}</span>
                      {r.locked && <span className="badge badge-amber inline-flex items-center gap-1">{Icon.lock} Locked by admin</span>}
                      {r.outOfPlan && <span className="badge badge-slate">Upgrade to unlock</span>}
                      {!built && <span className="badge badge-amber">Coming soon</span>}
                    </p>
                    {e.blockedBy && <p className="err mt-1">Needs: {e.blockedBy.join(", ")}. Switch it on and we will enable what is missing.</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {rows.length === 0 && <p className="card mt-6 text-center text-muted">No features match.</p>}
    </div>
  );
}
