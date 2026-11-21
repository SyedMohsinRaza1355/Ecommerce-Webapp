"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getClient, platformDb } from "@/lib/db/client";
import { issueTenantContext } from "@/lib/tenant/context";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/ratelimit";
import { hashToken, type Invite } from "@/lib/platform/provision";
import { appendAudit } from "@/lib/audit/log";

export type AcceptState = { error?: string } | undefined;

export async function acceptInviteAction(token: string, _prev: AcceptState, form: FormData): Promise<AcceptState> {
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!rateLimit(`invite:${ip}`, 10, 60_000).ok) return { error: "Too many attempts. Wait a minute and try again." };

  const password = String(form.get("password") ?? "");
  const weak = validatePasswordStrength(password);
  if (weak) return { error: weak };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords do not match." };

  const db = await platformDb();
  // single-use: claim the invite atomically so a link cannot be used twice
  const claimed = await db.collection<Invite>("invites").findOneAndUpdate(
    { _id: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!claimed) return { error: "This link has expired or was already used. Ask your administrator for a new one." };

  const ctx = issueTenantContext(claimed.instanceId);
  const tdb = (await getClient()).db(ctx.dbName);
  try {
    await tdb.collection("users").insertOne({
      _id: crypto.randomUUID() as never,
      instanceId: claimed.instanceId,
      email: claimed.email,
      passwordHash: await hashPassword(password),
      role: claimed.role,
      createdAt: new Date(),
    });
  } catch {
    await db.collection<Invite>("invites").updateOne({ _id: claimed._id }, { $set: { usedAt: null } });
    return { error: "We could not finish setting up your account. Please try the link again." };
  }
  await appendAudit({ actorId: claimed.email, actorRole: claimed.role, instanceId: claimed.instanceId, action: "invite.accept", outcome: "success" }).catch(() => undefined);
  redirect("/invite/done");
}
