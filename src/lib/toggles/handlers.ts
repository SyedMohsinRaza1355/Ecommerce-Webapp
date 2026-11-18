import { TOGGLES } from "./catalog";

/**
 * Handler registry (SRS 7.3). Every catalogue toggle has a registered handler id.
 * `IMPLEMENTED` lists toggles whose behaviour exists in code; the rest stay
 * "planned" and are reported honestly in the explorer and in launch counts.
 */
export const REGISTERED_HANDLERS: ReadonlySet<string> = new Set(TOGGLES.map((d) => d.handler));

// Phase 1 delivers the engine plus identity/RBAC/audit primitives only.
export const IMPLEMENTED: ReadonlySet<string> = new Set<string>([
  "F-087", // default subdomain (tenant resolution)
  "F-052", // staff accounts (identity primitives)
  "F-107", // staff roles and permissions (RBAC)
  "F-108", // staff activity log (audit)
]);
