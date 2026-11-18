import { platformDb } from "@/lib/db/client";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import { evaluateToggles } from "./evaluate";
import type { Effective } from "./types";

const TTL_MS = 30_000; // SRS 7.2: servers cache settings for at most 30 seconds
const cache = new Map<string, { at: number; value: Map<string, Effective> }>();

export function clearToggleCache() {
  cache.clear();
}

/** Effective toggles for an instance. Cache key includes instanceId and configVersion. */
export async function getEffectiveToggles(instance: InstanceRecord): Promise<Map<string, Effective>> {
  const key = `${instance._id}:${instance.configVersion ?? 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const db = await platformDb();
  const [plan, flags] = await Promise.all([
    db.collection<{ _id: string; includedToggles?: string[]; defaults?: Record<string, boolean> }>("plans").findOne({ _id: instance.planId }),
    db.collection<{ _id: string; killSwitch?: Record<string, boolean> }>("global_flags").findOne({ _id: "global" }),
  ]);

  const value = evaluateToggles({
    killSwitch: flags?.killSwitch,
    locks: instance.toggleLocks,
    overrides: instance.toggleOverrides,
    planIncludes: plan?.includedToggles ? new Set(plan.includedToggles) : undefined,
    planDefaults: plan?.defaults,
  });
  cache.set(`${instance._id}:${instance.configVersion ?? 0}`, { at: Date.now(), value });
  return value;
}
