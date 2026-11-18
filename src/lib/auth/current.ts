import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { SESSION_COOKIE, verifySession } from "./session";
import type { Actor } from "./rbac";

export async function getActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const secret = env().sessionSecret;
  if (!secret) return null;
  return verifySession(token, secret);
}

/** Server-side gate for every Super Admin page and action (never just hidden UI). */
export async function requireSuperAdmin(): Promise<Actor> {
  const actor = await getActor();
  if (!actor || actor.role !== "super_admin") redirect("/admin/login");
  return actor;
}
