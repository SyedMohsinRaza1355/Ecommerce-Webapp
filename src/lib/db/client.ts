import { MongoClient, type Db } from "mongodb";
import { env, requireEnv } from "@/lib/env";

// One MongoClient per process/cluster; tenants are selected via client.db(name)
// so connection count does not grow with tenant count (SRS 10.2).
const g = globalThis as unknown as { __mongo?: Promise<MongoClient> };

export function getClient(): Promise<MongoClient> {
  if (!g.__mongo) {
    const client = new MongoClient(requireEnv("mongoUri"), {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    });
    g.__mongo = client.connect().catch((e) => {
      g.__mongo = undefined;
      throw e;
    });
  }
  return g.__mongo;
}

export async function platformDb(dbName = env().platformDb): Promise<Db> {
  return (await getClient()).db(dbName);
}

export async function closeClient(): Promise<void> {
  if (g.__mongo) {
    const c = await g.__mongo;
    g.__mongo = undefined;
    await c.close();
  }
}
