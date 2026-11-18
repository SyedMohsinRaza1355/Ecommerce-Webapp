export const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "auth", "billing", "support", "status", "mail",
  "static", "cdn", "login", "signup", "staging", "preview", "platform",
]);

const SUB_RE = /^(?!-)(?!.*--)[a-z0-9-]{3,30}(?<!-)$/;

export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export type SubdomainCheck = { ok: true } | { ok: false; reason: string };

export function validateSubdomain(name: string): SubdomainCheck {
  if (!SUB_RE.test(name)) {
    return { ok: false, reason: "Use 3-30 lowercase letters, digits or single hyphens, not starting or ending with a hyphen." };
  }
  if (RESERVED_SUBDOMAINS.has(name)) return { ok: false, reason: "This name is reserved." };
  return { ok: true };
}

export type ParsedHost =
  | { kind: "platform" }
  | { kind: "subdomain"; subdomain: string }
  | { kind: "custom"; host: string }
  | { kind: "invalid" };

/** Classify a Host header. Never reads any other request input. */
export function parseHost(rawHost: string | null | undefined, baseDomain: string): ParsedHost {
  const host = normalizeHost(rawHost);
  const base = normalizeHost(baseDomain);
  if (!host || host.length > 253 || /[^a-z0-9.-]/.test(host)) return { kind: "invalid" };
  if (host === base) return { kind: "platform" };
  if (host.endsWith(`.${base}`)) {
    const sub = host.slice(0, -(base.length + 1));
    if (sub.includes(".")) return { kind: "invalid" };
    if (RESERVED_SUBDOMAINS.has(sub)) return { kind: "platform" };
    if (!validateSubdomain(sub).ok) return { kind: "invalid" };
    return { kind: "subdomain", subdomain: sub };
  }
  return { kind: "custom", host };
}
