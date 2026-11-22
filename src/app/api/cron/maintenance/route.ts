import { timingSafeEqual } from "node:crypto";
import { platformDb } from "@/lib/db/client";
import { issueTenantContext } from "@/lib/tenant/context";
import { processOutbox } from "@/lib/commerce/outbox";
import { expireUnpaidOrders } from "@/lib/commerce/orders";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false; // not configured: closed, never open
  const given = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

/** Daily housekeeping for every store: resend queued emails and release stock held by unpaid orders. Vercel Cron calls it. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ ok: false, reason: "not_configured" }, { status: 503 });
  if (!authorised(req)) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const stores = await (await platformDb()).collection<{ _id: string }>("instances").find({ status: { $ne: "deleted" } } as never).project({ _id: 1 }).limit(500).toArray();
  let emails = 0, expired = 0, failed = 0;
  for (const s of stores) {
    if (Date.now() - started > 50_000) break; // leave room to finish; the next run continues
    try {
      const ctx = issueTenantContext(String(s._id));
      emails += (await processOutbox(ctx, { limit: 50 })).sent;
      expired += await expireUnpaidOrders(ctx);
    } catch (e) {
      failed++;
      log("error", "cron_store_failed", { instance: String(s._id), message: (e as Error).message });
    }
  }
  log("info", "cron_maintenance", { stores: stores.length, emails, expired, failed });
  return Response.json({ ok: true, stores: stores.length, emails, expired, failed });
}
