"use client";

import { useMemo, useState } from "react";
import { evaluateToggles } from "@/lib/toggles/evaluate";
import { dependentsOf } from "@/lib/toggles/graph";
import type { ToggleDef } from "@/lib/toggles/types";

type Mode = "default" | "owner_on" | "owner_off" | "lock_on" | "lock_off" | "override_on" | "override_off" | "kill_off" | "kill_on";

const MODES: { value: Mode; label: string }[] = [
  { value: "default", label: "Default (no setting)" },
  { value: "owner_on", label: "Owner turns on" },
  { value: "owner_off", label: "Owner turns off" },
  { value: "override_on", label: "Super Admin override: on" },
  { value: "override_off", label: "Super Admin override: off" },
  { value: "lock_on", label: "Super Admin lock: on" },
  { value: "lock_off", label: "Super Admin lock: off" },
  { value: "kill_off", label: "Global kill switch: off" },
  { value: "kill_on", label: "Global kill switch: on" },
];

export default function Explorer({ defs, implemented }: { defs: ToggleDef[]; implemented: string[] }) {
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [excludePlan, setExcludePlan] = useState(false);

  const impl = useMemo(() => new Set(implemented), [implemented]);
  const sections = useMemo(() => ["all", ...Array.from(new Set(defs.map((d) => d.section)))], [defs]);

  const eff = useMemo(() => {
    const owner: Record<string, boolean> = {};
    const locks: Record<string, boolean> = {};
    const overrides: Record<string, boolean> = {};
    const killSwitch: Record<string, boolean> = {};
    for (const [id, m] of Object.entries(modes)) {
      if (m === "owner_on") owner[id] = true;
      if (m === "owner_off") owner[id] = false;
      if (m === "lock_on") locks[id] = true;
      if (m === "lock_off") locks[id] = false;
      if (m === "override_on") overrides[id] = true;
      if (m === "override_off") overrides[id] = false;
      if (m === "kill_on") killSwitch[id] = true;
      if (m === "kill_off") killSwitch[id] = false;
    }
    // Demo plan: a "Starter" plan that excludes advanced toggles.
    const planIncludes = excludePlan ? new Set(defs.filter((d) => !d.advanced).map((d) => d.id)) : undefined;
    return evaluateToggles({ owner, locks, overrides, killSwitch, planIncludes }, defs);
  }, [modes, excludePlan, defs]);

  const rows = defs.filter(
    (d) =>
      (section === "all" || d.section === section) &&
      (!query || d.id.toLowerCase().includes(query.toLowerCase()) || d.name.toLowerCase().includes(query.toLowerCase())),
  );
  const onCount = [...eff.values()].filter((e) => e.enabled).length;

  function set(id: string, mode: Mode) {
    setModes((m) => ({ ...m, [id]: mode }));
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block font-medium">Search</span>
          <input className="rounded border px-2 py-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="F-014 or modifiers" />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Section</span>
          <select className="rounded border px-2 py-2" value={section} onChange={(e) => setSection(e.target.value)}>
            {sections.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={excludePlan} onChange={(e) => setExcludePlan(e.target.checked)} />
          Simulate a plan that excludes advanced toggles
        </label>
        <button className="rounded border px-3 py-2 text-sm" onClick={() => setModes({})}>Reset all</button>
        <p className="text-sm" aria-live="polite">{onCount} of {defs.length} effectively on</p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-2">ID</th>
              <th className="pr-2">Feature</th>
              <th className="pr-2">Needs</th>
              <th className="pr-2">Setting</th>
              <th className="pr-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const e = eff.get(d.id)!;
              const deps = dependentsOf(d.id, defs);
              return (
                <tr key={d.id} className="border-b align-top">
                  <td className="py-2 pr-2 font-mono">{d.id}</td>
                  <td className="pr-2">
                    {d.name}
                    {d.advanced && <span className="ml-2 rounded bg-gray-200 px-1 text-xs">advanced</span>}
                    {impl.has(d.id) ? (
                      <span className="ml-2 rounded bg-green-100 px-1 text-xs text-green-900">built</span>
                    ) : (
                      <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900">planned</span>
                    )}
                    {deps.length > 0 && <div className="text-xs text-gray-600">Needed by {deps.length}</div>}
                  </td>
                  <td className="pr-2 font-mono text-xs">{d.requires.map((g) => g.join(" or ")).join(" + ") || "none"}</td>
                  <td className="pr-2">
                    <select
                      aria-label={`Setting for ${d.id}`}
                      className="rounded border px-1 py-1"
                      value={modes[d.id] ?? "default"}
                      onChange={(ev) => set(d.id, ev.target.value as Mode)}
                    >
                      {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </td>
                  <td className="pr-2">
                    <span className={e.enabled ? "font-semibold text-green-800" : "font-semibold text-red-800"}>
                      {e.enabled ? "ON" : "OFF"}
                    </span>
                    <div className="text-xs text-gray-600">via {e.source.replace(/_/g, " ")}</div>
                    {e.blockedBy && <div className="text-xs text-red-800">Blocked: turn on {e.blockedBy.join(", ")} first</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
