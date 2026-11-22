import { guard } from "@/lib/commerce/guard";
import { categories } from "@/lib/commerce/store";
import { ProductForm } from "@/components/admin/ProductForm";
import { saveProductAction, uploadImageAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Add product" };

export default async function NewProduct({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "catalog.manage");
  const cats = await categories.find(store.ctx, {}, 100);
  return (
    <div>
      <h1 className="mb-5 text-2xl font-extrabold tracking-tight">Add product</h1>
      <ProductForm action={saveProductAction.bind(null, sub, null)} upload={uploadImageAction.bind(null, sub)} categories={cats.map((c) => ({ id: c._id, name: c.name }))} submit="Save product" />
    </div>
  );
}
