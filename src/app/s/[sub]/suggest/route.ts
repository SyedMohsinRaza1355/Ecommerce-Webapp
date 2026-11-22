import { loadStore } from "@/lib/commerce/load";
import { products } from "@/lib/commerce/store";
import { rankProducts } from "@/lib/commerce/search";
import { rateLimit } from "@/lib/auth/ratelimit";

export const dynamic = "force-dynamic";

/** Search-as-you-type suggestions for the shop's search box. Public, read-only, rate limited. */
export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-138")?.enabled === false) return Response.json([], { status: 404 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 40);
  if (q.trim().length < 2) return Response.json([]);
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!(await rateLimit(`suggest:${s.instance._id}:${ip}`, 90, 60_000)).ok) return Response.json([], { status: 429 });
  const rows = await (await products.collection(s.ctx)).find(products.scope(s.ctx, { status: "published" } as never)).project({ name: 1, slug: 1 }).limit(500).toArray();
  const hits = rankProducts(rows.map((r) => ({ name: String(r.name), slug: String(r.slug) })), q).map((h) => ({ name: h.name, href: `/s/${sub}/product/${h.slug}` }));
  return Response.json(hits, { headers: { "cache-control": "private, max-age=20" } });
}
