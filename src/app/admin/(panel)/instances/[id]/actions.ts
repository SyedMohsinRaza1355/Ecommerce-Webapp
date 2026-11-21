"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/current";
import { changePlan, regenerateOwnerInvite, setInstanceStatus, setToggleRule, type ToggleRule } from "@/lib/platform/manage";

export type ActionState = undefined | { error: string } | { message: string } | { inviteToken: string; expiresAt: string };

const RULES: ToggleRule[] = ["none", "override_on", "override_off", "lock_on", "lock_off"];

export async function statusAction(id: string, to: "active" | "suspended", _p: ActionState, _f: FormData): Promise<ActionState> {
  const actor = await requireSuperAdmin();
  const r = await setInstanceStatus(actor, id, to);
  revalidatePath(`/admin/instances/${id}`);
  return r.ok ? { message: to === "suspended" ? "Store suspended. Its data is kept." : "Store reactivated." } : { error: r.message };
}

export async function planAction(id: string, _p: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireSuperAdmin();
  const r = await changePlan(actor, id, String(form.get("planId") ?? ""));
  revalidatePath(`/admin/instances/${id}`);
  if (!r.ok) return { error: r.message };
  return { message: r.switchedOff > 0 ? `Plan changed. ${r.switchedOff} features are now switched off (their data is kept).` : "Plan changed." };
}

export async function ruleAction(id: string, toggleId: string, form: FormData): Promise<void> {
  const actor = await requireSuperAdmin();
  const rule = String(form.get("rule") ?? "none") as ToggleRule;
  if (!RULES.includes(rule)) return;
  await setToggleRule(actor, id, toggleId, rule);
  revalidatePath(`/admin/instances/${id}`);
}

export async function inviteAction(id: string, _p: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireSuperAdmin();
  const r = await regenerateOwnerInvite(actor, id, String(form.get("ownerEmail") ?? ""));
  if (!r.ok) return { error: r.message };
  return { inviteToken: r.token, expiresAt: r.expiresAt.toISOString() };
}
