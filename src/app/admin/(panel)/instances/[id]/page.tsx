import Link from "next/link";
import { notFound } from "next/navigation";
import { platformDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { listPlans } from "@/lib/platform/plans";
import { PACK_BY_ID } from "@/catalog/packs";
import { TOGGLES } from "@/lib/toggles/catalog";
import { getEffectiveToggles } from "@/lib/toggles/service";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import { PlanControl, StatusControl, InviteControl, ImpersonateControl } from "./Controls";
import RuleSelect from "./RuleSelect";

export const metadata = { title: "Store | Storeforge Super Admin" };

const STATUS: Record<string, string> = { active: "badge-green", suspended: "badge-red", provisioning: "badge-amber", provisioning_failed: "badge-red", terminated: "badge-slate" };

export default async function StoreDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; ruled?: string }> }) {
  const { id } = await params;
  const { q = "", ruled = "" } = await searchParams;
  if (!/^[a-z0-9]{12}$/.test(id)) notFound();
  const db = await platformDb();
  const inst = await db.collection<InstanceRecord>("instances").findOne({ _id: id });
  if (!inst) notFound();
  const plans = await listPlans();
  const eff = await getEffectiveToggles(inst);
  const pack = inst.industryPack ? PACK_BY_ID.get(inst.industryPack) : undefined;
  const on = [...eff.values()].filter((e) => e.enabled).length;

  const ruleOf = (tid: string) =>
    inst.toggleLocks && tid in inst.toggleLocks ? (inst.toggleLocks[tid] ? "lock_on" : "lock_off")
    : inst.toggleOverrides && tid in inst.toggleOverrides ? (inst.toggleOverrides[tid] ? "override_on" : "override_off")
    : "none";

  const rows = TOGGLES.filter(
    (t) => (!q || t.id.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase())) && (ruled !== "1" || ruleOf(t.id) !== "none"),
  );

  return (
    <div>
      <Link href="/admin/instances" className="text-sm text-muted underline">All stores</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="reveal text-2xl font-extrabold tracking-tight">{inst.name}</h1>
        <span className={`badge ${STATUS[inst.status] ?? "badge-slate"}`}>{inst.status.replace(/_/g, " ")}</span>
      </div>
      <p className="font-mono text-sm text-muted">{inst.subdomain}.{env().baseDomain}</p>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <div className="card reveal reveal-1">
          <h2 className="font-bold">Overview</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Industry pack</dt><dd className="font-semibold">{pack?.name ?? "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Features on</dt><dd className="font-semibold">{on} / {TOGGLES.length}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Settings version</dt><dd className="font-semibold">{inst.configVersion ?? 0}</dd></div>
          </dl>
          <Link className="btn btn-secondary mt-4" href={`/s/${inst.subdomain}`} target="_blank">Preview store</Link>
        </div>
        <div className="card reveal reveal-2">
          <h2 className="font-bold">Plan</h2>
          <div className="mt-3"><PlanControl id={id} planId={inst.planId} plans={plans.map((p) => ({ id: p._id, name: p.name }))} /></div>
        </div>
        <div className="card reveal reveal-3">
          <h2 className="font-bold">Status</h2>
          <p className="mb-3 mt-1 text-sm text-muted">Suspending shows customers a notice and keeps all data.</p>
          <StatusControl id={id} status={inst.status} />
        </div>
      </div>

      <div className="card reveal reveal-4 mt-5">
        <h2 className="font-bold">Owner access</h2>
        <div className="mt-3 max-w-md"><InviteControl id={id} /></div>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="card reveal reveal-5">
          <h2 className="font-bold">Support access</h2>
          <div className="mt-3"><ImpersonateControl id={id} /></div>
        </div>
        <div className="card reveal reveal-5">
          <h2 className="font-bold">Export store data</h2>
          <p className="mb-3 mt-1 text-sm text-muted">Download a JSON copy of this store&apos;s products, orders, settings and staff (without passwords). The export is logged.</p>
          <a className="btn btn-secondary" href={`/admin/instances/${id}/export`} download>Download export</a>
        </div>
      </div>

      <section className="mt-8" aria-labelledby="rules">
        <h2 id="rules" className="text-xl font-extrabold">Feature rules</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          An <strong>override</strong> sets a feature for this store only. A <strong>lock</strong> does the same and stops the owner from changing it. Changes save instantly and reach the store within a minute.
        </p>
        <form method="get" className="card mt-4 flex flex-wrap items-end gap-3">
          <label className="field mb-0"><span>Search</span><input className="input" name="q" defaultValue={q} placeholder="Feature name or F-014" /></label>
          <label className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" name="ruled" value="1" defaultChecked={ruled === "1"} /> Only features with a rule</label>
          <button className="btn btn-primary">Filter</button>
        </form>
        <div className="card mt-4 overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Feature</th><th>Result</th><th>Rule</th></tr></thead>
            <tbody>
              {rows.map((t) => {
                const e = eff.get(t.id)!;
                const r = ruleOf(t.id);
                return (
                  <tr key={t.id}>
                    <td>
                      <span className="font-semibold">{t.name}</span>
                      <span className="ms-2 font-mono text-xs text-muted">{t.id}</span>
                      {r.startsWith("lock") && <span className="badge badge-amber ms-2">Locked</span>}
                      {r.startsWith("override") && <span className="badge badge-indigo ms-2">Override</span>}
                    </td>
                    <td>
                      <span className={`badge ${e.enabled ? "badge-green" : "badge-red"}`}>{e.enabled ? "On" : "Off"}</span>
                      <span className="ms-2 text-xs text-muted">{e.source.replace(/_/g, " ")}</span>
                      {e.blockedBy && <span className="ms-2 text-xs text-red-800">needs {e.blockedBy.join(", ")}</span>}
                    </td>
                    <td className="w-48"><RuleSelect id={id} toggleId={t.id} current={r} /></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-muted">No features match.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
