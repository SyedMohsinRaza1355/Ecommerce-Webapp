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
  {
    version: 2,
    name: "commerce collections and indexes",
    async up(db) {
      await db.collection("categories").createIndex({ instanceId: 1, slug: 1 }, { unique: true });
      await db.collection("products").createIndex({ instanceId: 1, status: 1, createdAt: -1 });
      await db.collection("products").createIndex({ instanceId: 1, categoryId: 1 });
      await db.collection("orders").createIndex({ instanceId: 1, orderNo: 1 }, { unique: true });
      await db.collection("orders").createIndex({ instanceId: 1, idempotencyKey: 1 }, { unique: true });
      await db.collection("orders").createIndex({ trackingHash: 1 }, { unique: true });
      await db.collection("orders").createIndex({ instanceId: 1, createdAt: -1 });
      await db.collection("payment_events").createIndex({ instanceId: 1, eventId: 1 }, { unique: true });
      await db.collection("carts").createIndex({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });
      await db.collection("outbox").createIndex({ instanceId: 1, status: 1, nextAttemptAt: 1 });
      await db.collection("emails").createIndex({ instanceId: 1, sentAt: -1 });
      await db.collection("activity").createIndex({ instanceId: 1, at: -1 });
      await db.collection("discounts").createIndex({ instanceId: 1, code: 1 }, { unique: true });
    },
  },
];

export const _TENANT_V3: Migration = {
  version: 3,
  name: "customer accounts, reviews, newsletter, pages, messages",
  async up(db) {
    await db.collection("customers").createIndex({ instanceId: 1, email: 1 }, { unique: true });
    await db.collection("customer_tokens").createIndex({ hash: 1 }, { unique: true });
    await db.collection("customer_tokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection("orders").createIndex({ instanceId: 1, customerId: 1 }, { sparse: true });
    await db.collection("reviews").createIndex({ instanceId: 1, productId: 1, createdAt: -1 });
    await db.collection("reviews").createIndex({ instanceId: 1, productId: 1, customerId: 1 }, { unique: true });
    await db.collection("newsletter").createIndex({ instanceId: 1, email: 1 }, { unique: true });
    await db.collection("pages").createIndex({ instanceId: 1, slug: 1 }, { unique: true });
    await db.collection("contact_messages").createIndex({ instanceId: 1, createdAt: -1 });
    await db.collection("payment_config").createIndex({ instanceId: 1 });
  },
};
TENANT_MIGRATIONS.push(_TENANT_V3);

export const _TENANT_V4: Migration = {
  version: 4,
  name: "staff password reset and point-of-sale",
  async up(db) {
    await db.collection("staff_tokens").createIndex({ hash: 1 }, { unique: true });
    await db.collection("staff_tokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection("orders").createIndex({ instanceId: 1, source: 1, createdAt: -1 }, { sparse: true });
  },
};
TENANT_MIGRATIONS.push(_TENANT_V4);

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
  {
    version: 2,
    name: "payment intent routing",
    async up(db) {
      await db.collection("payment_intents").createIndex({ instanceId: 1, orderId: 1 });
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
