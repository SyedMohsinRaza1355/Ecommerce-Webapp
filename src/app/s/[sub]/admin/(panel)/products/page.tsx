import Link from "next/link";
import { guard } from "@/lib/commerce/guard";
import { authorize } from "@/lib/auth/rbac";
import { products, categories } from "@/lib/commerce/store";
import { fmtMoney } from "@/lib/i18n";
import { Icon } from "@/components/Icons";
import BulkProducts from "@/components/admin/BulkProducts";
import { bulkProductsAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Products" };

export default async function ProductsAdmin({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ q?: string; status?: string; saved?: string }> }) {
  const { sub } = await params;
  const sp = await searchParams;
  const { store, staff } = await guard(sub, "inventory.view");
  const can = authorize(staff.actor, "catalog.manage", store.ctx).allow;
  const b = `/s/${sub}/admin`;
  const col = await products.collection(store.ctx);
  const filter: Record<string, unknown> = {};
  if (sp.status === "draft" || sp.status === "published") filter.status = sp.status;
  if (sp.q) filter.name = { $regex: sp.q.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const rows = await col.find(products.scope(store.ctx, filter as never)).sort({ updatedAt: -1 }).limit(200).toArray();
  const catName = new Map((await categories.find(store.ctx, {}, 200)).map((c) => [c._id, c.name]));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="reveal text-2xl font-extrabold tracking-tight">Products</h1>
        {can && <Link href={`${b}/products/new`} className="btn btn-primary">{Icon.plus} Add product</Link>}
      </div>
      {sp.saved && <p role="status" className="ok pop-in mt-3">Saved.</p>}
      <form method="get" className="card reveal reveal-1 mt-5 flex flex-wrap items-end gap-3">
        <label className="field mb-0"><span>Search</span><input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Product name" /></label>
        <label className="field mb-0"><span>Status</span>
          <select className="input" name="status" defaultValue={sp.status ?? ""}><option value="">All</option><option value="published">Published</option><option value="draft">Draft</option></select>
        </label>
        <button className="btn btn-secondary">Filter</button>
      </form>
      {rows.length === 0 ? (
        <div className="card pop-in mt-6 text-center">
          <span className="icon-chip mx-auto">{Icon.box}</span>
          <h2 className="mt-3 font-bold">No products yet</h2>
          <p className="text-sm text-muted">Add your first product so customers can start ordering.</p>
          {can && <Link href={`${b}/products/new`} className="btn btn-primary mt-4">Add your first product</Link>}
        </div>
      ) : (
        <div className="mt-5"><BulkProducts rows={rows.map((p) => ({ id: p._id, name: p.name, price: fmtMoney(p.priceMinor, store.settings.currency, "en"), stock: p.stock, trackStock: p.trackStock, status: p.status, imageUrl: p.imageUrl || undefined, category: catName.get(p.categoryId ?? "") }))} can={can} bulk={store.eff.get("F-115")?.enabled === true} base={`${b}/products`} action={bulkProductsAction.bind(null, sub)} /></div>
      )}
    </div>
  );
}
