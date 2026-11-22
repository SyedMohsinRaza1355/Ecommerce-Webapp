import { guard } from "@/lib/commerce/guard";
import { products } from "@/lib/commerce/store";
import { posSaleAction } from "@/app/s/[sub]/admin/actions";
import PosTill from "@/components/admin/PosTill";

export const metadata = { title: "Till" };

export default async function PosPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store, staff } = await guard(sub, "pos.sell");
  const rows = await products.find(store.ctx, { status: "published" } as never, 400);
  const tracked = store.feat.stockTracking;
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Till</h1>
      <p className="mb-4 text-muted">Sales at the counter. Each sale is paid on the spot, reduces stock, and appears in Orders and Reports.</p>
      <PosTill
        sub={sub} currency={store.settings.currency} taxPercent={store.feat.tax ? store.settings.taxBps / 100 : 0}
        canDiscount={["store_owner", "manager", "super_admin"].includes(staff.actor.role)}
        products={rows.map((p) => ({ id: p._id, name: p.name, priceMinor: p.priceMinor, stock: tracked && p.trackStock && !(store.feat.backorders && p.backorder) ? p.stock : null, categoryName: "" }))}
        sale={posSaleAction.bind(null, sub)}
      />
    </div>
  );
}
