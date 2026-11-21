import { loadStore } from "@/lib/commerce/load";

export const dynamic = "force-dynamic";

/** Per-store robots.txt (F-092). Admin, checkout and order pages are never indexed. */
export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") return new Response("Not found", { status: 404 });
  const origin = new URL(req.url).origin;
  const base = req.headers.get("x-forwarded-host") ? `${origin}` : origin;
  const body = s.eff.get("F-092")?.enabled === false
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order/\nDisallow: /pay/\nDisallow: /s/${sub}/admin/\nSitemap: ${base}/s/${sub}/sitemap\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
