import { describe, it, expect } from "vitest";
import { TOGGLES, CATALOG } from "./catalog";
import { evaluateToggles, isEnabled } from "./evaluate";
import { validateCatalog, dependentsOf } from "./graph";
import { REGISTERED_HANDLERS } from "./handlers";
import type { ToggleDef } from "./types";

describe("catalogue", () => {
  it("has exactly 145 toggles F-001..F-145 with no gaps", () => {
    expect(TOGGLES).toHaveLength(145);
    for (let i = 1; i <= 145; i++) expect(CATALOG.has(`F-${String(i).padStart(3, "0")}`)).toBe(true);
  });

  it("passes graph validation (unique ids, known prerequisites, no cycles, handlers registered)", () => {
    expect(validateCatalog(TOGGLES, REGISTERED_HANDLERS)).toEqual([]);
  });

  it.each(TOGGLES.map((d) => [d.id, d] as const))("%s has default state, prerequisites and handler", (_id, d) => {
    expect(typeof d.default).toBe("boolean");
    expect(d.requires.every((g) => g.length > 0)).toBe(true);
    expect(REGISTERED_HANDLERS.has(d.handler)).toBe(true);
    expect(d.name.length).toBeGreaterThan(2);
  });

  it("with no inputs, every default-on toggle whose prerequisites are on evaluates On", () => {
    const eff = evaluateToggles();
    expect(isEnabled(eff, "F-001")).toBe(true);
    expect(isEnabled(eff, "F-003")).toBe(false); // default off
    expect(isEnabled(eff, "F-026")).toBe(true); // OR group satisfied by F-037
  });
});

describe("graph validation", () => {
  const mk = (id: string, ...req: string[][]): ToggleDef => ({
    id, name: id, section: "catalog", default: true, requires: req, handler: `handler.${id}`,
  });
  it("detects a cycle", () => {
    const issues = validateCatalog([mk("A", ["B"]), mk("B", ["A"])]);
    expect(issues.some((i) => i.kind === "cycle")).toBe(true);
  });
  it("detects unknown prerequisites, duplicates and missing handlers", () => {
    expect(validateCatalog([mk("A", ["Z"])]).some((i) => i.kind === "unknown_prereq")).toBe(true);
    expect(validateCatalog([mk("A"), mk("A")]).some((i) => i.kind === "duplicate_id")).toBe(true);
    expect(validateCatalog([mk("A")], new Set()).some((i) => i.kind === "no_handler")).toBe(true);
  });
  it("lists transitive dependents", () => {
    const deps = dependentsOf("F-001", TOGGLES);
    expect(deps).toContain("F-002");
    expect(deps).toContain("F-021"); // via F-002
    expect(deps).not.toContain("F-005");
  });
});

describe("precedence (SRS 7.1 / DEC-09)", () => {
  it("kill switch outranks lock, override and owner", () => {
    const e = evaluateToggles({
      killSwitch: { "F-053": false }, locks: { "F-053": true }, overrides: { "F-053": true }, owner: { "F-053": true },
    });
    expect(e.get("F-053")).toMatchObject({ enabled: false, source: "kill_switch" });
  });
  it("kill switch can force ON as well as OFF (forced-on and forced-off are separate)", () => {
    const e = evaluateToggles({ killSwitch: { "F-058": true } });
    expect(e.get("F-058")).toMatchObject({ enabled: true, source: "kill_switch" });
  });
  it("lock outranks override and owner", () => {
    const e = evaluateToggles({ locks: { "F-058": true }, overrides: { "F-058": false }, owner: { "F-058": false } });
    expect(e.get("F-058")).toMatchObject({ enabled: true, source: "instance_lock" });
  });
  it("override outranks owner", () => {
    const e = evaluateToggles({ overrides: { "F-058": true }, owner: { "F-058": false } });
    expect(e.get("F-058")).toMatchObject({ enabled: true, source: "instance_override" });
  });
  it("owner choice applies only when the plan includes the toggle", () => {
    const inPlan = evaluateToggles({ planIncludes: new Set(["F-058"]), owner: { "F-058": true } });
    expect(inPlan.get("F-058")).toMatchObject({ enabled: true, source: "owner" });
    const outOfPlan = evaluateToggles({ planIncludes: new Set(["F-001"]), owner: { "F-058": true } });
    expect(outOfPlan.get("F-058")).toMatchObject({ enabled: false, source: "not_in_plan" });
  });
  it("falls back plan default, then pack default, then catalogue default", () => {
    expect(evaluateToggles({ planDefaults: { "F-058": true }, packDefaults: { "F-058": false } }).get("F-058")?.source).toBe("plan_default");
    expect(evaluateToggles({ packDefaults: { "F-058": true } }).get("F-058")).toMatchObject({ enabled: true, source: "pack_default" });
    expect(evaluateToggles().get("F-058")?.source).toBe("catalog_default");
  });
  it("a locked-on toggle outside the plan stays on (lock outranks plan)", () => {
    const e = evaluateToggles({ planIncludes: new Set(), locks: { "F-058": true } });
    expect(e.get("F-058")?.enabled).toBe(true);
  });
});

describe("prerequisites", () => {
  it("resolves Off and names the blocker when a prerequisite is Off", () => {
    const e = evaluateToggles({ owner: { "F-014": true } }); // needs F-003 (default off)
    expect(e.get("F-014")).toMatchObject({ enabled: false, requested: true, blockedBy: ["F-003"] });
  });
  it("is satisfied once the prerequisite chain is on", () => {
    const e = evaluateToggles({ owner: { "F-014": true, "F-003": true } });
    expect(e.get("F-014")?.enabled).toBe(true);
  });
  it("propagates transitively: turning F-001 off disables F-002 and F-021", () => {
    const e = evaluateToggles({ locks: { "F-001": false }, owner: { "F-021": true } });
    expect(e.get("F-002")?.enabled).toBe(false);
    expect(e.get("F-021")?.enabled).toBe(false);
  });
  it("OR groups: F-026 needs F-037 or F-038", () => {
    const both = evaluateToggles({ locks: { "F-037": false } });
    expect(both.get("F-026")?.enabled).toBe(false);
    const viaCod = evaluateToggles({ locks: { "F-037": false, "F-038": true, "F-017": true } });
    expect(viaCod.get("F-026")?.enabled).toBe(true);
  });
  it("unknown toggle ids fail closed", () => {
    expect(isEnabled(evaluateToggles(), "F-999")).toBe(false);
  });
  it("is deterministic", () => {
    const input = { owner: { "F-003": true, "F-014": true } };
    expect([...evaluateToggles(input)]).toEqual([...evaluateToggles(input)]);
  });
});
