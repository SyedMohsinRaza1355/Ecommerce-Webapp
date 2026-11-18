import { CATALOG, TOGGLES } from "./catalog";
import type { Effective, EffectiveSource, EvalInput, ToggleDef } from "./types";

/**
 * SRS 7.1 / DEC-09 precedence, first match wins:
 *  1 kill switch (forced on or off)   2 instance lock   3 instance override
 *  4 not in plan => Off               5 owner choice
 *  6 plan default   7 industry pack default   8 catalogue default
 * Finally a toggle that is On resolves Off if any prerequisite group has no On member.
 */
export function evaluateToggles(input: EvalInput = {}, defs: readonly ToggleDef[] = TOGGLES): Map<string, Effective> {
  const byId = defs === TOGGLES ? CATALOG : new Map(defs.map((d) => [d.id, d]));
  const base = new Map<string, { value: boolean; source: EffectiveSource }>();

  for (const d of defs) {
    const id = d.id;
    let r: { value: boolean; source: EffectiveSource };
    if (input.killSwitch && id in input.killSwitch) r = { value: input.killSwitch[id], source: "kill_switch" };
    else if (input.locks && id in input.locks) r = { value: input.locks[id], source: "instance_lock" };
    else if (input.overrides && id in input.overrides) r = { value: input.overrides[id], source: "instance_override" };
    else if (input.planIncludes && !input.planIncludes.has(id)) r = { value: false, source: "not_in_plan" };
    else if (input.owner && id in input.owner) r = { value: input.owner[id], source: "owner" };
    else if (input.planDefaults && id in input.planDefaults) r = { value: input.planDefaults[id], source: "plan_default" };
    else if (input.packDefaults && id in input.packDefaults) r = { value: input.packDefaults[id], source: "pack_default" };
    else r = { value: d.default, source: "catalog_default" };
    base.set(id, r);
  }

  const memo = new Map<string, Effective>();
  const resolving = new Set<string>();
  const resolve = (id: string): Effective => {
    const done = memo.get(id);
    if (done) return done;
    const def = byId.get(id);
    const b = base.get(id);
    if (!def || !b) return { id, enabled: false, requested: false, source: "unknown" }; // fail closed
    if (resolving.has(id)) return { id, enabled: false, requested: b.value, source: b.source }; // cycle guard
    resolving.add(id);
    let enabled = b.value;
    const blockedBy: string[] = [];
    if (b.value) {
      for (const group of def.requires) {
        if (!group.some((p) => resolve(p).enabled)) blockedBy.push(group.join(" or "));
      }
      if (blockedBy.length) enabled = false;
    }
    resolving.delete(id);
    const eff: Effective = { id, enabled, requested: b.value, source: b.source, ...(blockedBy.length ? { blockedBy } : {}) };
    memo.set(id, eff);
    return eff;
  };

  const out = new Map<string, Effective>();
  for (const d of defs) out.set(d.id, resolve(d.id));
  return out;
}

/** Unknown toggle ids always evaluate Off (fail closed). */
export function isEnabled(map: ReadonlyMap<string, Effective>, id: string): boolean {
  return map.get(id)?.enabled ?? false;
}
