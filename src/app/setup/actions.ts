"use server";

import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/auth/ratelimit";
import { validatePasswordStrength } from "@/lib/auth/password";
import { countSuperAdmins, createSuperAdmin } from "@/lib/platform/users";
import { appendAudit } from "@/lib/audit/log";

export type SetupState = { error?: string } | undefined;

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** One-time bootstrap. Requires SETUP_KEY and only works while no Super Admin exists. */
export async function setupAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!rateLimit(`setup:${ip}`, 5, 60_000).ok) return { error: "Too many attempts. Wait a minute and try again." };

  const key = process.env.SETUP_KEY ?? "";
  if (!key) return { error: "Setup is not enabled on this server." };
  if (!same(String(form.get("setupKey") ?? ""), key)) return { error: "The setup key is not correct." };
  if ((await countSuperAdmins()) > 0) return { error: "A Super Admin already exists. Please sign in." };

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  const weak = validatePasswordStrength(password);
  if (weak) return { error: weak };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords do not match." };

  const user = await createSuperAdmin(email, password);
  await appendAudit({ actorId: user._id, actorRole: "super_admin", instanceId: null, action: "setup.create_super_admin", outcome: "success" }).catch(() => {});
  redirect("/admin/login");
}
