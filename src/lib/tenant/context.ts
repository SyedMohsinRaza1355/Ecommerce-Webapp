// TenantContext is immutable and can only be issued by server code that has
// verified the instance (host resolution or an authenticated job). A WeakSet
// makes forged object literals fail at runtime; the brand makes them fail at
// compile time (SRS 8.4, ADD-028).
declare const brand: unique symbol;

export type TenantContext = Readonly<{
  instanceId: string;
  dbName: string;
  [brand]: true;
}>;

const issued = new WeakSet<object>();
const ID_RE = /^[a-z0-9]{12}$/;

export function dbNameFor(instanceId: string): string {
  if (!ID_RE.test(instanceId)) throw new Error("Invalid instance id");
  return `tenant_${instanceId}`;
}

/** Only call from verified server paths (resolver, job runner, tests). */
export function issueTenantContext(instanceId: string, dbPrefix = ""): TenantContext {
  const ctx = Object.freeze({
    instanceId,
    dbName: `${dbPrefix}${dbNameFor(instanceId)}`,
  }) as unknown as TenantContext;
  issued.add(ctx);
  return ctx;
}

export function assertTenantContext(ctx: unknown): asserts ctx is TenantContext {
  if (!ctx || typeof ctx !== "object" || !issued.has(ctx)) {
    throw new Error("TenantContext missing or forged");
  }
}

export function newInstanceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}
