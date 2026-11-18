export type Section =
  | "catalog" | "menus" | "inventory" | "orders" | "payments" | "customers"
  | "marketing" | "shipping" | "content" | "domains" | "reporting" | "operations";

/** requires = AND of groups; each group is an OR of toggle ids. Explicit, never inferred from text (ADD-006). */
export type ToggleDef = {
  id: string;
  name: string;
  section: Section;
  default: boolean;
  requires: string[][];
  handler: string;
  advanced?: boolean;
};

export type EffectiveSource =
  | "kill_switch" | "instance_lock" | "instance_override" | "owner" | "plan_default"
  | "pack_default" | "catalog_default" | "not_in_plan" | "unknown";

export type Effective = {
  id: string;
  enabled: boolean;
  /** state before the prerequisite rule was applied */
  requested: boolean;
  source: EffectiveSource;
  blockedBy?: string[];
};

export type EvalInput = {
  killSwitch?: Record<string, boolean>;
  locks?: Record<string, boolean>;
  overrides?: Record<string, boolean>;
  owner?: Record<string, boolean>;
  /** toggle ids the plan includes; undefined means no plan restriction */
  planIncludes?: ReadonlySet<string>;
  planDefaults?: Record<string, boolean>;
  packDefaults?: Record<string, boolean>;
};
