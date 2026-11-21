import type { Db } from "mongodb";
import { getClient } from "@/lib/db/client";
import { migrate, TENANT_MIGRATIONS } from "@/lib/db/migrations";
import { assertTenantContext, type TenantContext } from "./context";

const g = globalThis as unknown as { __tenantSchema?: Map<string, Promise<unknown>> };

/** Tenant database for a verified context; migrations run once per process per database. */
export async function tenantDb(ctx: TenantContext): Promise<Db> {
  assertTenantContext(ctx);
  const db = (await getClient()).db(ctx.dbName);
  g.__tenantSchema ??= new Map();
  let p = g.__tenantSchema.get(ctx.dbName);
  if (!p) {
    p = migrate(db, TENANT_MIGRATIONS).catch((e) => {
      g.__tenantSchema?.delete(ctx.dbName);
      throw e;
    });
    g.__tenantSchema.set(ctx.dbName, p);
  }
  await p;
  return db;
}
