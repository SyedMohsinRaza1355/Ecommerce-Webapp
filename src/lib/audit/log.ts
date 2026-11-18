import { platformDb } from "@/lib/db/client";

const SENSITIVE = /pass(word)?|token|secret|card|cvv|authorization|cookie|api[-_]?key/i;

/** Deep-redact secrets/PII-like keys before anything is logged or audited (ADD-040). */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6) return "[truncated]" as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

export type AuditEntry = {
  actorId: string;
  actorRole: string;
  instanceId: string | null;
  action: string;
  target?: string;
  outcome: "success" | "denied" | "failure";
  requestId?: string;
  before?: unknown;
  after?: unknown;
};

/**
 * Append-only: this module exposes insert only. Nothing in the app updates or
 * deletes audit entries; production must also grant the app role insert/find only.
 */
export async function appendAudit(entry: AuditEntry, dbName?: string): Promise<void> {
  const db = await platformDb(dbName);
  await db.collection("audit_log").insertOne({
    ...entry,
    before: redact(entry.before),
    after: redact(entry.after),
    at: new Date(),
  });
}
