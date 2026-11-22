import { handleStripeWebhook } from "@/lib/commerce/payflow";
import { platformDb } from "@/lib/db/client";
import { rateLimit } from "@/lib/auth/ratelimit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
const MAX_BYTES = 256 * 1024;

/** Stripe calls this for one store. The signature is checked with that store's own signing secret. */
export async function POST(req: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const { instanceId } = await params;
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!(await rateLimit(`wh-stripe:${ip}`, 300, 60_000)).ok) return Response.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ ok: false, reason: "too_large" }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ ok: false, reason: "too_large" }, { status: 413 });
  const name = async (id: string) => (await (await platformDb()).collection<{ _id: string; name: string }>("instances").findOne({ _id: id }, { projection: { name: 1 } }))?.name ?? "Our store";
  const r = await handleStripeWebhook(instanceId, raw, req.headers.get("stripe-signature"), name);
  log(r.status >= 400 ? "warn" : "info", "stripe_webhook", { status: r.status, reason: r.body.reason, duplicate: r.body.duplicate });
  return Response.json(r.body, { status: r.status });
}

export function GET() {
  return Response.json({ ok: false, reason: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
}
