import { TOGGLES } from "./catalog";

/**
 * Handler registry (SRS 7.3). Every catalogue toggle has a registered handler id.
 * `IMPLEMENTED` lists toggles whose behaviour exists in code; the rest stay
 * "planned" and are reported honestly in the explorer and in launch counts.
 */
export const REGISTERED_HANDLERS: ReadonlySet<string> = new Set(TOGGLES.map((d) => d.handler));

// Toggles with working behaviour in code. Everything else is registered but shown as "coming soon".
export const IMPLEMENTED: ReadonlySet<string> = new Set<string>([
  "F-001", "F-005", "F-019", "F-026", "F-027", "F-029", "F-030", "F-037", "F-038", "F-041", "F-042",
  "F-052", "F-053", "F-063", "F-065", "F-069", "F-073", "F-074", "F-075", "F-085", "F-086", "F-087",
  "F-092", "F-107", "F-108", "F-109", "F-113", "F-126", "F-137", "F-139", "F-140",
]);
