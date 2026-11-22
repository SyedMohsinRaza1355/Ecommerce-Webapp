import { platformDb } from "@/lib/db/client";
import { issueTenantContext, type TenantContext } from "@/lib/tenant/context";
import { getEffectiveToggles } from "@/lib/toggles/service";
import { rateLimit } from "@/lib/auth/ratelimit";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import { instanceIdFromKey, verifyApiKey } from "./integrations";

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

export const apiError = (status: number, code: string, message: string, extra: Record<string, string> = {}) => json({ error: { code, message } }, status, extra);
export { json as apiJson };

/** Resolves the store from a Bearer key, checks the key, the feature and the rate limit. Same answer for "no such store" and "wrong key". */
export async function authenticateApi(req: Request): Promise<{ ctx: TenantContext; instance: InstanceRecord } | Response> {
  const m = /^Bearer\s+(\S{20,200})$/.exec(req.headers.get("authorization") ?? "");
  const key = m?.[1] ?? "";
  const iid = instanceIdFromKey(key);
  const bad = () => apiError(401, "invalid_key", "Missing or invalid API key. Send it as: Authorization: Bearer <key>", { "www-authenticate": "Bearer" });
  if (!iid) return bad();
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!(await rateLimit(`api-ip:${ip}`, 300, 60_000)).ok) return apiError(429, "rate_limited", "Too many requests.", { "retry-after": "60" });
  const instance = await (await platformDb()).collection<InstanceRecord>("instances").findOne({ _id: iid });
  if (!instance) return bad();
  const ctx = issueTenantContext(instance._id);
  if (!(await verifyApiKey(ctx, key))) return bad();
  if (!(await rateLimit(`api:${instance._id}`, 120, 60_000)).ok) return apiError(429, "rate_limited", "Too many requests for this store. Limit: 120 per minute.", { "retry-after": "60" });
  if (instance.status === "suspended") return apiError(403, "store_suspended", "This store is suspended.");
  const eff = await getEffectiveToggles(instance);
  if (eff.get("F-100")?.enabled !== true) return apiError(403, "feature_off", "The API is turned off for this store.");
  return { ctx, instance };
}
