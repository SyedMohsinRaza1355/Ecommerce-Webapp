import { handleGatewayWebhook } from "@/lib/commerce/orders";
import { rateLimit } from "@/lib/auth/ratelimit";

export const dynamic = "force-dynamic";
const MAX_BYTES = 16 * 1024;

/** Payment gateway webhook: verified HMAC signature, replay window, deduplicated, idempotent (SRS 13, NFR-09). */
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!rateLimit(`wh:${ip}`, 120, 60_000).ok) return Response.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return Response.json({ ok: false, reason: "too_large" }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ ok: false, reason: "too_large" }, { status: 413 });
  const r = await handleGatewayWebhook(raw, req.headers.get("x-gateway-signature"));
  return Response.json(r.body, { status: r.status });
}

export function GET() {
  return Response.json({ ok: false, reason: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
}
