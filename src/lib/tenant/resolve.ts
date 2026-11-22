import { headers } from "next/headers";
import { env } from "@/lib/env";
import { platformDb } from "@/lib/db/client";
import { issueTenantContext, type TenantContext } from "./context";
import { parseHost } from "./host";

export type InstanceStatus = "active" | "suspended" | "provisioning" | "provisioning_failed" | "terminated";

export type InstanceRecord = {
  _id: string; // instanceId
  name: string;
  subdomain: string;
  status: InstanceStatus;
  planId: string;
  industryPack?: string;
  /** shown in the public store directory when the owner opts in */
  listed?: boolean;
  customDomains?: { host: string; verified: boolean }[];
  toggleLocks?: Record<string, boolean>;
  toggleOverrides?: Record<string, boolean>;
  configVersion?: number;
};

export type Resolution =
  | { type: "platform" }
  | { type: "not_found" }
  | { type: "suspended"; name: string }
  | { type: "ok"; ctx: TenantContext; instance: InstanceRecord };

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: InstanceRecord | null }>();

export function clearResolutionCache() {
  cache.clear();
}

async function lookup(parsed: ReturnType<typeof parseHost>): Promise<InstanceRecord | null> {
  const key = parsed.kind === "subdomain" ? `s:${parsed.subdomain}` : parsed.kind === "custom" ? `c:${parsed.host}` : "";
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const db = await platformDb();
  const filter =
    parsed.kind === "subdomain"
      ? { subdomain: parsed.subdomain }
      : { customDomains: { $elemMatch: { host: parsed.kind === "custom" ? parsed.host : "", verified: true } } };
  const doc = (await db.collection<InstanceRecord>("instances").findOne(filter)) ?? null;
  cache.set(key, { at: Date.now(), value: doc });
  return doc;
}

/** Resolve a Host header to a tenant. Fails closed for anything unknown. */
export async function resolveHost(rawHost: string | null | undefined, baseDomain = env().baseDomain): Promise<Resolution> {
  const parsed = parseHost(rawHost, baseDomain);
  if (parsed.kind === "platform") return { type: "platform" };
  if (parsed.kind === "invalid") return { type: "not_found" };
  const instance = await lookup(parsed);
  if (!instance) return { type: "not_found" };
  if (instance.status === "suspended") return { type: "suspended", name: instance.name };
  if (instance.status !== "active") return { type: "not_found" };
  return { type: "ok", ctx: issueTenantContext(instance._id), instance };
}

/** For route handlers / server components: tenant comes only from the Host header. */
export async function resolveRequestTenant(): Promise<Resolution> {
  const h = await headers();
  return resolveHost(h.get("host"));
}

/**
 * Preview resolution for environments without wildcard DNS (e.g. *.vercel.app).
 * The subdomain comes from a route segment on the PLATFORM host and is validated
 * against the registry; it grants no privileges and never reaches the data layer
 * as a raw tenant id.
 */
export async function resolvePreview(subdomain: string): Promise<Resolution> {
  const parsed = parseHost(`${subdomain}.${env().baseDomain}`, env().baseDomain);
  if (parsed.kind !== "subdomain") return { type: "not_found" };
  const instance = await lookup(parsed);
  if (!instance) return { type: "not_found" };
  if (instance.status === "suspended") return { type: "suspended", name: instance.name };
  if (instance.status !== "active") return { type: "not_found" };
  return { type: "ok", ctx: issueTenantContext(instance._id), instance };
}
