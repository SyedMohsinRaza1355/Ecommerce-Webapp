import { platformDb } from "@/lib/db/client";
import { authorize, type Actor } from "@/lib/auth/rbac";
import { appendAudit } from "@/lib/audit/log";
import { CATALOG } from "@/lib/toggles/catalog";
import { clearToggleCache } from "@/lib/toggles/service";
import { clearResolutionCache } from "@/lib/tenant/resolve";

type Flags = { _id: string; killSwitch?: Record<string, boolean> };

export async function getKillSwitch(): Promise<Record<string, boolean>> {
  return (await (await platformDb()).collection<Flags>("global_flags").findOne({ _id: "global" }))?.killSwitch ?? {};
}

/** Platform-wide emergency switch for one feature: forced off or on for every store, no deploy (SA-13). */
export async function setKillSwitch(actor: Actor, toggleId: string, mode: "off" | "on" | "clear"): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!authorize(actor, "killswitch.set").allow) return { ok: false, message: "Not allowed." };
  if (!CATALOG.has(toggleId)) return { ok: false, message: "Unknown feature." };
  const col = (await platformDb()).collection<Flags>("global_flags");
  const before = (await getKillSwitch())[toggleId] ?? null;
  if (mode === "clear") await col.updateOne({ _id: "global" }, { $unset: { [`killSwitch.${toggleId}`]: "" } }, { upsert: true });
  else await col.updateOne({ _id: "global" }, { $set: { [`killSwitch.${toggleId}`]: mode === "on" } }, { upsert: true });
  clearToggleCache();
  clearResolutionCache();
  await appendAudit({ actorId: actor.userId, actorRole: actor.role, instanceId: null, action: `killswitch.${mode}`, target: toggleId, outcome: "success", before: { value: before }, after: { mode } });
  return { ok: true };
}
