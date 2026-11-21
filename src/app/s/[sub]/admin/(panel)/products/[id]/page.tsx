import { notFound } from "next/navigation";
import { guard } from "@/lib/commerce/guard";
import { categories, products } from "@/lib/commerce/store";
import { formatMajor, money } from "@/lib/money/money";
import { ProductForm } from "@/components/admin/ProductForm";
import { ActionButton } from "@/components/admin/Forms";
import { saveProductAction, deleteProductAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Edit product" };

export default async function EditProduct({ params }: { params: Promise<{ sub: string; id: string }> }) {
  const { sub, id } = await params;
  const { store } = await guard(sub, "catalog.manage");
  const p = await products.findById(store.ctx, id);
  if (!p) notFound();
  const cats = await categories.find(store.ctx, {}, 100);
  const cur = store.settings.currency;
  return (
    <div>
      <h1 className="mb-5 text-2xl font-extrabold tracking-tight">Edit product</h1>
      <ProductForm
        action={saveProductAction.bind(null, sub, id)}
        categories={cats.map((c) => ({ id: c._id, name: c.name }))}
        submit="Save changes"
        initial={{ name: p.name, description: p.description, price: formatMajor(money(p.priceMinor, cur)), compareAt: p.compareAtMinor ? formatMajor(money(p.compareAtMinor, cur)) : "", categoryId: p.categoryId ?? "", imageUrl: p.imageUrl, stock: p.stock, trackStock: p.trackStock, status: p.status }}
      />
      <div className="card mt-6 max-w-2xl">
        <h2 className="font-bold">Delete product</h2>
        <p className="mb-3 text-sm text-muted">Past orders keep their own copy of the name and price. This cannot be undone.</p>
        <ActionButton danger label="Delete product" confirmText="Delete this product permanently?" run={async () => { "use server"; await deleteProductAction(sub, id); return undefined; }} />
      </div>
    </div>
  );
}
