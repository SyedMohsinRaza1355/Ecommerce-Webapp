"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/ratelimit";
import { findPlatformUserByEmail } from "@/lib/platform/users";
import { appendAudit } from "@/lib/audit/log";

export type FormState = { error?: string } | undefined;

// Pre-computed bcrypt hash so unknown emails cost the same time as known ones.
const DUMMY_HASH = "$2b$12$JGGTdxtQhWFC5TBm.BE7x.ZjWZBcVDJdMlBM5q38AgBxgONjKDkl2";

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();

  const rl = await rateLimit(`login:${ip}:${email}`, 5, 60_000);
  if (!rl.ok) return { error: `Too many attempts. Try again in ${rl.retryAfterSec} seconds.` };
  if (!email || !password) return { error: "Enter your email and password." };

  const user = await findPlatformUserByEmail(email);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await appendAudit({ actorId: email || "unknown", actorRole: "unknown", instanceId: null, action: "auth.login", outcome: "failure" }).catch(() => {});
    return { error: "That email and password do not match." };
  }

  const token = await signSession({ userId: user._id, role: "super_admin", instanceId: null }, env().sessionSecret);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  await appendAudit({ actorId: user._id, actorRole: "super_admin", instanceId: null, action: "auth.login", outcome: "success" }).catch(() => {});
  redirect("/admin");
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/admin/login");
}
