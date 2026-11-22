import { timingSafeEqual } from "node:crypto";
import { platformDb } from "@/lib/db/client";
import { issueTenantContext } from "@/lib/tenant/context";
import { processOutbox } from "@/lib/commerce/outbox";
import { expireUnpaidOrders } from "@/lib/commerce/orders";
import { processWebhooks } from "@/lib/commerce/integrations";
import { log } from "@/lib/log";
import { tenantDb } from "@/lib/tenant/schema";
import { sweepStockAlerts, sweepAbandoned } from "@/lib/commerce/growth";
import { originOf } from "@/lib/commerce/orders";

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
  const stores = await (await platformDb()).collection<{ _id: string; subdomain?: string; name?: string }>("instances").find({ status: { $ne: "deleted" } } as never).project({ _id: 1, subdomain: 1, name: 1 }).limit(500).toArray();
  let emails = 0, expired = 0, failed = 0;
  for (const s of stores) {
    if (Date.now() - started > 50_000) break; // leave room to finish; the next run continues
    try {
      const ctx = issueTenantContext(String(s._id));
      for (let n = 0; n < 8; n++) {
        const r = await processOutbox(ctx, { limit: 50 });
        emails += r.sent;
        if (r.sent + r.failed + r.dead < 50) break;
      }
      await processWebhooks(ctx, { limit: 50 });
      expired += await expireUnpaidOrders(ctx);
      if (s.subdomain) {
        const base = `${originOf()}/s/${s.subdomain}`;
        const settings = await (await tenantDb(ctx)).collection<{ branding?: { storeName?: string } }>("settings").findOne({ instanceId: ctx.instanceId });
        const storeName = settings?.branding?.storeName || s.name || "Store";
        await sweepStockAlerts(ctx, base, storeName).catch(() => 0);
        await sweepAbandoned(ctx, base, storeName).catch(() => 0);
      }
    } catch (e) {
      failed++;
      log("error", "cron_store_failed", { instance: String(s._id), message: (e as Error).message });
    }
  }
  log("info", "cron_maintenance", { stores: stores.length, emails, expired, failed });
  return Response.json({ ok: true, stores: stores.length, emails, expired, failed });
}
