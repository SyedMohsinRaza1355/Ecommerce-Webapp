import { loadStore } from "@/lib/commerce/load";
import { products } from "@/lib/commerce/store";
import { originOf } from "@/lib/commerce/orders";

export const dynamic = "force-dynamic";

const ENT: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[<>&'"]/g, (c) => ENT[c]);

/** Product feed for Google Merchant Center and marketplaces (F-106). Published products only. */
export async function GET(_req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-106")?.enabled !== true) return new Response("Not found", { status: 404 });
  const rows = await (await products.collection(s.ctx)).find(products.scope(s.ctx, { status: "published" } as never)).sort({ createdAt: -1 }).limit(5000).toArray();
  const origin = originOf();
  const abs = (u: string) => (u.startsWith("/") ? `${origin}${u}` : u);
  const items = rows.map((p) => {
    const inStock = !s.feat.stockTracking || !p.trackStock || p.stock > 0 || p.backorder;
    return `<item><g:id>${esc(String(p._id))}</g:id><title>${esc(p.name)}</title><description>${esc((p.description || p.name).slice(0, 4000))}</description><link>${esc(`${origin}/s/${sub}/product/${p.slug}`)}</link>${p.imageUrl ? `<g:image_link>${esc(abs(p.imageUrl))}</g:image_link>` : ""}<g:availability>${inStock ? "in_stock" : "out_of_stock"}</g:availability><g:price>${(p.priceMinor / 100).toFixed(2)} ${s.settings.currency}</g:price><g:condition>new</g:condition>${p.sku ? `<g:mpn>${esc(p.sku)}</g:mpn>` : ""}</item>`;
  }).join("");
  const title = s.settings.branding.storeName || s.instance.name;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${esc(title)}</title><link>${esc(`${origin}/s/${sub}`)}</link><description>${esc(s.settings.branding.tagline || "Products")}</description>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" } });
}
