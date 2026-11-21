import { loadStore } from "@/lib/commerce/load";
import { listPublished } from "@/lib/commerce/store";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** Per-store sitemap: published products only, scoped to this store (F-092). */
export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-092")?.enabled === false) return new Response("Not found", { status: 404 });
  const origin = new URL(req.url).origin;
  const { items } = await listPublished(s.ctx, { pageSize: 60 });
  const urls = [`${origin}/s/${sub}`, `${origin}/s/${sub}/products`, ...items.map((p) => `${origin}/s/${sub}/product/${p.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
