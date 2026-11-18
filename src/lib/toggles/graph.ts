import type { ToggleDef } from "./types";

export type GraphIssue = { kind: "unknown_prereq" | "cycle" | "duplicate_id" | "no_handler"; detail: string };

/** Validate the catalogue: unique ids, known prerequisites, no cycles, handler registered (SRS 7.3). */
export function validateCatalog(defs: readonly ToggleDef[], registeredHandlers?: ReadonlySet<string>): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, ToggleDef>();
  for (const d of defs) {
    if (byId.has(d.id)) issues.push({ kind: "duplicate_id", detail: d.id });
    byId.set(d.id, d);
    if (registeredHandlers && !registeredHandlers.has(d.handler)) issues.push({ kind: "no_handler", detail: d.id });
  }
  for (const d of defs) {
    for (const g of d.requires) for (const p of g) {
      if (!byId.has(p)) issues.push({ kind: "unknown_prereq", detail: `${d.id} -> ${p}` });
    }
  }
  // cycle detection by DFS colouring (any member of any OR group counts as an edge)
  const colour = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string) => {
    colour.set(id, 1);
    stack.push(id);
    for (const g of byId.get(id)?.requires ?? []) for (const p of g) {
      if (!byId.has(p)) continue;
      const c = colour.get(p);
      if (c === 1) issues.push({ kind: "cycle", detail: [...stack.slice(stack.indexOf(p)), p].join(" -> ") });
      else if (!c) visit(p);
    }
    stack.pop();
    colour.set(id, 2);
  };
  for (const d of defs) if (!colour.has(d.id)) visit(d.id);
  return issues;
}

/** Toggles that (directly or transitively) need `id`: for the "turn off dependents too?" prompt. */
export function dependentsOf(id: string, defs: readonly ToggleDef[]): string[] {
  const out = new Set<string>();
  const walk = (target: string) => {
    for (const d of defs) {
      if (out.has(d.id)) continue;
      if (d.requires.some((g) => g.includes(target))) {
        out.add(d.id);
        walk(d.id);
      }
    }
  };
  walk(id);
  return [...out].sort();
}
