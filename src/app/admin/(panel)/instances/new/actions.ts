"use server";

import { requireSuperAdmin } from "@/lib/auth/current";
import { provisionInstance } from "@/lib/platform/provision";

export type CreateState =
  | undefined
  | { error: string; step?: string }
  | { done: true; instanceId: string; name: string; subdomain: string; invitePath: string; expiresAt: string };

export async function createStoreAction(_prev: CreateState, form: FormData): Promise<CreateState> {
  const actor = await requireSuperAdmin();
  const input = {
    name: String(form.get("name") ?? ""),
    subdomain: String(form.get("subdomain") ?? ""),
    packId: String(form.get("packId") ?? ""),
    planId: String(form.get("planId") ?? ""),
    ownerEmail: String(form.get("ownerEmail") ?? ""),
  };
  const r = await provisionInstance(actor, input);
  if (!r.ok) return { error: r.message, step: r.step };
  return {
    done: true,
    instanceId: r.instanceId,
    name: input.name.trim(),
    subdomain: input.subdomain.trim().toLowerCase(),
    invitePath: `/invite/${r.inviteToken}`,
    expiresAt: r.inviteExpiresAt.toISOString(),
  };
}
