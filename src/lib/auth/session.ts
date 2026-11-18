import { SignJWT, jwtVerify } from "jose";
import type { Actor, Role } from "./rbac";
import { ROLES } from "./rbac";

const ISSUER = "ecom-platform";
export const SESSION_COOKIE = "session";

function key(secret: string) {
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(actor: Actor, secret: string, ttlSeconds = 60 * 60 * 8): Promise<string> {
  return new SignJWT({ role: actor.role, iid: actor.instanceId, imp: actor.impersonating === true })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(actor.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

/** Returns null for any invalid, expired or tampered token (fail closed). */
export async function verifySession(token: string | undefined, secret: string): Promise<Actor | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, algorithms: ["HS256"] });
    const role = payload.role as Role;
    if (!payload.sub || !ROLES.includes(role)) return null;
    const iid = typeof payload.iid === "string" ? payload.iid : null;
    return { userId: payload.sub, role, instanceId: iid, impersonating: payload.imp === true };
  } catch {
    return null;
  }
}
