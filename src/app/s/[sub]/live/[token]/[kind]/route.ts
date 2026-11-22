import { createHmac, timingSafeEqual } from "node:crypto";
import { loadStore } from "@/lib/commerce/load";
import { exportCsv } from "@/lib/commerce/extras";
import { rateLimit } from "@/lib/auth/ratelimit";

export const dynamic = "force-dynamic";

export const liveToken = (instanceId: string, version: number) =>
  createHmac("sha256", process.env.SESSION_SECRET || "dev").update(`live:${instanceId}:${version}`).digest("base64url");

/** Live CSV link for Google Sheets IMPORTDATA (F-104). The secret in the address is the key; owners can replace it. */
export async function GET(req: Request, { params }: { params: Promise<{ sub: string; token: string; kind: string }> }) {
  const { sub, token, kind } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-104")?.enabled !== true || !["orders", "products", "ledger"].includes(kind)) return new Response("Not found", { status: 404 });
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!(await rateLimit(`live:${s.instance._id}:${ip}`, 60, 60_000)).ok) return new Response("Slow down", { status: 429 });
  const want = Buffer.from(liveToken(String(s.instance._id), s.settings.feedVersion ?? 1)), got = Buffer.from(token);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return new Response("Not found", { status: 404 });
  return new Response(await exportCsv(s.ctx, kind as "orders"), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
