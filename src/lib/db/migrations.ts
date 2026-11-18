import type { Db } from "mongodb";

export type Migration = { version: number; name: string; up: (db: Db) => Promise<void> };

/** Tenant database migrations. Each is idempotent so a retry after partial failure is safe. */
export const TENANT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline collections and indexes",
    async up(db) {
      await db.collection("settings").createIndex({ instanceId: 1 }, { unique: true });
      await db.collection("users").createIndex({ instanceId: 1, email: 1 }, { unique: true });
      await db.collection("products").createIndex({ instanceId: 1, slug: 1 }, { unique: true, sparse: true });
    },
  },
];

export const PLATFORM_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "platform indexes",
    async up(db) {
      await db.collection("instances").createIndex({ subdomain: 1 }, { unique: true });
      await db.collection("instances").createIndex({ "customDomains.host": 1 }, { sparse: true });
      await db.collection("plans").createIndex({ slug: 1 }, { unique: true });
      await db.collection("audit_log").createIndex({ instanceId: 1, at: -1 });
      await db.collection("audit_log").createIndex({ actorId: 1, at: -1 });
    },
  },
];

/** Applies pending migrations in order and records schemaVersion after each step (resumable). */
export async function migrate(db: Db, migrations: Migration[]): Promise<{ from: number; to: number }> {
  const meta = db.collection<{ _id: string; schemaVersion: number }>("_meta");
  const current = (await meta.findOne({ _id: "schema" }))?.schemaVersion ?? 0;
  let version = current;
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= version) continue;
    await m.up(db);
    await meta.updateOne({ _id: "schema" }, { $set: { schemaVersion: m.version } }, { upsert: true });
    version = m.version;
  }
  return { from: current, to: version };
}
