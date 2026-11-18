"use client";

import { useMemo, useState } from "react";
import { evaluateToggles } from "@/lib/toggles/evaluate";
import { dependentsOf } from "@/lib/toggles/graph";
import type { ToggleDef } from "@/lib/toggles/types";

type Mode = "default" | "lock_on" | "lock_off" | "override_on" | "override_off" | "kill_off";

const ADMIN_MODES: { value: Mode; label: string }[] = [
  { value: "default", label: "No Super Admin rule" },
  { value: "override_on", label: "Override: force on" },
  { value: "override_off", label: "Override: force off" },
  { value: "lock_on", label: "Lock: on (owner can't change)" },
  { value: "lock_off", label: "Lock: off (owner can't change)" },
  { value: "kill_off", label: "Kill switch: off everywhere" },
];

const LABELS: Record<string, string> = {
  catalog: "Catalog", menus: "Menus", inventory: "Inventory", orders: "Orders", payments: "Payments",
  customers: "Customers", marketing: "Marketing", shipping: "Shipping", content: "Content", domains: "Domains",
  reporting: "Reporting", operations: "Operations",
};

export default function Explorer({ defs, implemented }: { defs: ToggleDef[]; implemented: string[] }) {
  const [owner, setOwner] = useState<Record<string, boolean>>({});
  const [admin, setAdmin] = useState<Record<string, Mode>>({});
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [sim, setSim] = useState(false);
  const [excludePlan, setExcludePlan] = useState(false);

  const impl = useMemo(() => new Set(implemented), [implemented]);
  const sections = useMemo(() => Array.from(new Set(defs.map((d) => d.section))), [defs]);

  const eff = useMemo(() => {
    const locks: Record<string, boolean> = {};
    const overrides: Record<string, boolean> = {};
    const killSwitch: Record<string, boolean> = {};
    for (const [id, m] of Object.entries(admin)) {
      if (m === "lock_on") locks[id] = true;
      if (m === "lock_off") locks[id] = false;
      if (m === "override_on") overrides[id] = true;
      if (m === "override_off") overrides[id] = false;
      if (m === "kill_off") killSwitch[id] = false;
    }
    const planIncludes = excludePlan ? new Set(defs.filter((d) => !d.advanced).map((d) => d.id)) : undefined;
    return evaluateToggles({ owner, locks, overrides, killSwitch, planIncludes }, defs);
  }, [owner, admin, excludePlan, defs]);

  const rows = defs.filter(
    (d) =>
      (section === "all" || d.section === section) &&
      (!query || d.id.toLowerCase().includes(query.toLowerCase()) || d.name.toLowerCase().includes(query.toLowerCase())),
  );
  const onCount = [...eff.values()].filter((e) => e.enabled).length;

  return (
    <div className="mt-8">
      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <label className="field mb-0 grow sm:max-w-xs">
            <span>Search features</span>
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try: variants, F-014, refunds" />
          </label>
          <div className="ms-auto flex items-center gap-4">
            <p className="text-sm" aria-live="polite"><strong className="text-lg">{onCount}</strong> <span className="text-muted">of {defs.length} on</span></p>
            <button className="btn btn-secondary" onClick={() => { setOwner({}); setAdmin({}); }}>Reset</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Sections">
          {["all", ...sections].map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
              className={`badge cursor-pointer px-3 py-1.5 text-sm transition ${section === s ? "badge-indigo ring-2 ring-indigo-300" : "badge-slate hover:bg-slate-300"}`}
            >
              {s === "all" ? "All" : LABELS[s] ?? s}
            </button>
          ))}
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm">
          <span className="switch">
            <input type="checkbox" checked={sim} onChange={(e) => setSim(e.target.checked)} />
            <span className="track" /><span className="thumb" />
          </span>
          Simulator: show Super Admin controls and plan limits
        </label>
        {sim && (
          <label className="pop-in mt-3 flex cursor-pointer items-center gap-3 text-sm">
            <span className="switch">
              <input type="checkbox" checked={excludePlan} onChange={(e) => setExcludePlan(e.target.checked)} />
              <span className="track" /><span className="thumb" />
            </span>
            Pretend the plan excludes advanced features
          </label>
        )}
      </div>

      <ul className="mt-6 grid gap-3 md:grid-cols-2" key={`${section}-${query}`}>
        {rows.map((d, i) => {
          const e = eff.get(d.id)!;
          const deps = dependentsOf(d.id, defs);
          const mode = admin[d.id] ?? "default";
          const locked = mode.startsWith("lock") || mode === "kill_off";
          const checked = owner[d.id] ?? e.requested;
          return (
            <li key={d.id} className="card hover-lift reveal" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
              <div className="flex items-start gap-3">
                <label className="switch mt-1" title={locked ? "Locked by Super Admin" : "Turn on or off"}>
                  <input
                    type="checkbox"
                    aria-label={`${d.name}`}
                    checked={checked}
                    disabled={locked}
                    onChange={(ev) => setOwner((o) => ({ ...o, [d.id]: ev.target.checked }))}
                  />
                  <span className="track" /><span className="thumb" />
                </label>
                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold leading-tight">{d.name}</h3>
                    {locked && <span className="badge badge-amber" title="Locked by Super Admin">Locked</span>}
                    {d.advanced && <span className="badge badge-slate">Advanced</span>}
                    {impl.has(d.id) ? <span className="badge badge-green">Available</span> : <span className="badge badge-amber">Coming soon</span>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted">{d.id}{deps.length > 0 && ` · needed by ${deps.length}`}</p>
                  <p className="mt-2 text-sm">
                    <span className={`badge ${e.enabled ? "badge-green" : "badge-red"}`}>{e.enabled ? "On" : "Off"}</span>
                    <span className="ms-2 text-xs text-muted">{e.source.replace(/_/g, " ")}</span>
                  </p>
                  {e.blockedBy && (
                    <p className="err">
                      Turn on {e.blockedBy.join(", ")} first.{" "}
                      <button
                        className="underline"
                        onClick={() => setOwner((o) => ({ ...o, ...Object.fromEntries(e.blockedBy!.flatMap((g) => g.split(" or ").slice(0, 1)).map((id) => [id, true])) }))}
                      >
                        Turn it on for me
                      </button>
                    </p>
                  )}
                  {sim && (
                    <label className="pop-in mt-3 block text-xs">
                      <span className="mb-1 block font-semibold text-muted">Super Admin rule</span>
                      <select
                        aria-label={`Super Admin rule for ${d.id}`}
                        className="input min-h-0 py-1.5 text-sm"
                        value={mode}
                        onChange={(ev) => setAdmin((a) => ({ ...a, [d.id]: ev.target.value as Mode }))}
                      >
                        {ADMIN_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="card mt-6 text-center text-muted">No features match that search.</p>}
    </div>
  );
}
