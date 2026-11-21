import Link from "next/link";
import { guard } from "@/lib/commerce/guard";
import { authorize } from "@/lib/auth/rbac";
import { products } from "@/lib/commerce/store";
import { fmtMoney } from "@/lib/i18n";
import { Icon } from "@/components/Icons";

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
        <div className="card reveal reveal-2 mt-5 overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p._id}>
                  <td className="font-semibold">{p.name}</td>
                  <td>{fmtMoney(p.priceMinor, store.settings.currency, "en")}</td>
                  <td>{p.trackStock ? <span className={p.stock === 0 ? "badge badge-red" : p.stock <= 5 ? "badge badge-amber" : ""}>{p.stock}</span> : <span className="text-muted">Not tracked</span>}</td>
                  <td><span className={`badge ${p.status === "published" ? "badge-green" : "badge-slate"}`}>{p.status}</span></td>
                  <td className="text-end">{can && <Link className="btn btn-secondary" href={`${b}/products/${p._id}`}>Edit</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
