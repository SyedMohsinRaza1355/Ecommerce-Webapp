import { platformDb } from "@/lib/db/client";

// Rate limiting must hold across serverless instances, so counters live in the database
// (atomic $inc on a per-window document with a TTL index). If the database is unreachable
// the limiter falls back to a per-process sliding window rather than failing open.
const hits = new Map<string, number[]>();
const g = globalThis as unknown as { __rlIndex?: Promise<unknown> };

function memory(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return { ok: true, retryAfterSec: 0 };
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterSec: number }> {
  if (!process.env.MONGODB_URI) return memory(key, limit, windowMs);
  try {
    const db = await platformDb();
    const col = db.collection<{ _id: string; n: number; expiresAt: Date }>("rate_limits");
    g.__rlIndex ??= col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => undefined);
    await g.__rlIndex;
    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    const doc = await col.findOneAndUpdate(
      { _id: `${key}:${bucket}` },
      { $inc: { n: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) } },
      { upsert: true, returnDocument: "after" },
    );
    const n = doc?.n ?? 1;
    return n <= limit ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000)) };
  } catch {
    return memory(key, limit, windowMs);
  }
}

export async function resetRateLimits(): Promise<void> {
  hits.clear();
  if (process.env.MONGODB_URI) {
    try {
      await (await platformDb()).collection("rate_limits").deleteMany({});
    } catch {
      /* nothing to reset */
    }
  }
}
