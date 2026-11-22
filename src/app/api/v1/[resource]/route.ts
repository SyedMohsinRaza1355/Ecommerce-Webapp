import { authenticateApi, apiError, apiJson } from "@/lib/commerce/api";
import { orders } from "@/lib/commerce/orders";
import { products } from "@/lib/commerce/store";
import { orderPayload } from "@/lib/commerce/integrations";
import { getSettings } from "@/lib/commerce/store";

export const dynamic = "force-dynamic";

/** Read-only REST API (F-100): GET /api/v1/products and GET /api/v1/orders, newest first, paged with ?before=<date>. */
export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const a = await authenticateApi(req);
  if (a instanceof Response) return a;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if (before && Number.isNaN(+before)) return apiError(400, "bad_request", "before must be a date like 2026-11-22T10:00:00Z");
  const dateFilter = before ? { createdAt: { $lt: before } } : {};
  if (resource === "products") {
    const [rows, settings] = await Promise.all([(await products.collection(a.ctx)).find(products.scope(a.ctx, dateFilter as never)).sort({ createdAt: -1 }).limit(limit).toArray(), getSettings(a.ctx)]);
    return apiJson({
      data: rows.map((p) => ({ id: p._id, name: p.name, slug: p.slug, description: p.description, price: p.priceMinor / 100, compareAtPrice: p.compareAtMinor ? p.compareAtMinor / 100 : null, currency: settings.currency, stock: p.trackStock ? p.stock : null, status: p.status, imageUrl: p.imageUrl || null, categoryId: p.categoryId ?? null, createdAt: p.createdAt })),
      next: rows.length === limit ? rows[rows.length - 1].createdAt : null,
    });
  }
  if (resource === "orders") {
    const status = url.searchParams.get("status");
    const filter: Record<string, unknown> = { ...dateFilter, ...(status ? { state: status } : {}) };
    const rows = await (await orders.collection(a.ctx)).find(orders.scope(a.ctx, filter as never)).sort({ createdAt: -1 }).limit(limit).toArray();
    return apiJson({ data: rows.map((o) => ({ id: o._id, ...orderPayload(o) })), next: rows.length === limit ? rows[rows.length - 1].createdAt : null });
  }
  return apiError(404, "not_found", "Unknown resource. Use products or orders.");
}
