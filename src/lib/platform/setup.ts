import { platformDb } from "@/lib/db/client";
import { migrate, PLATFORM_MIGRATIONS } from "@/lib/db/migrations";

const g = globalThis as unknown as { __platformReady?: Map<string, Promise<unknown>> };

/** Make sure platform indexes exist (once per process and database name). */
export async function ensurePlatform(): Promise<void> {
  const db = await platformDb();
  g.__platformReady ??= new Map();
  let p = g.__platformReady.get(db.databaseName);
  if (!p) {
    p = migrate(db, PLATFORM_MIGRATIONS).catch((e) => {
      g.__platformReady?.delete(db.databaseName);
      throw e;
    });
    g.__platformReady.set(db.databaseName, p);
  }
  await p;
}
