import { notFound } from "next/navigation";
import { guard } from "@/lib/commerce/guard";
import { categories, products } from "@/lib/commerce/store";
import { formatMajor, money, CURRENCY_EXPONENT } from "@/lib/money/money";
import { serializeOptions } from "@/lib/commerce/options";
import { ProductForm } from "@/components/admin/ProductForm";
import { ActionButton } from "@/components/admin/Forms";
import { previewToken } from "@/lib/commerce/growth";
import { originOf } from "@/lib/commerce/orders";
import { saveProductAction, deleteProductAction, uploadImageAction } from "@/app/s/[sub]/admin/actions";

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
        upload={uploadImageAction.bind(null, sub)}
        categories={cats.map((c) => ({ id: c._id, name: c.name }))}
        submit="Save changes"
        initial={{ name: p.name, description: p.description, price: formatMajor(money(p.priceMinor, cur)), compareAt: p.compareAtMinor ? formatMajor(money(p.compareAtMinor, cur)) : "", categoryId: p.categoryId ?? "", imageUrl: p.imageUrl, stock: p.stock, trackStock: p.trackStock, backorder: p.backorder, status: p.status, sku: p.sku, weight: p.weightGrams ? String(p.weightGrams) : "", seoTitle: p.seoTitle, seoDescription: p.seoDescription, optionsText: serializeOptions(p.options, CURRENCY_EXPONENT[cur] ?? 2), galleryText: (p.gallery ?? []).join("\n"), attributesText: (p.attributes ?? []).map((a) => `${a.name}: ${a.value}`).join("\n"), bundleText: (p.bundle ?? []).map((b) => `${b.qty} x ${b.productId}`).join("\n"), availDays: (p.availability?.days ?? []).join(","), availFrom: p.availability?.from, availTo: p.availability?.to }}
      />
      {p.status !== "published" && store.eff.get("F-144")?.enabled === true && (
        <div className="card mt-6 max-w-2xl">
          <h2 className="font-bold">Preview link</h2>
          <p className="mb-2 text-sm text-muted">Anyone with this link can see this product before it is published. Search engines are told to ignore it. It stops working once the product is published (the normal page takes over).</p>
          <code dir="ltr" className="block break-all rounded bg-slate-100 p-2 text-sm">{`${originOf()}/s/${sub}/product/${p.slug}?preview=${previewToken(String(store.instance._id), p._id)}`}</code>
        </div>
      )}
      <div className="card mt-6 max-w-2xl">
        <h2 className="font-bold">Delete product</h2>
        <p className="mb-3 text-sm text-muted">Past orders keep their own copy of the name and price. This cannot be undone.</p>
        <ActionButton danger label="Delete product" confirmText="Delete this product permanently?" run={async () => { "use server"; await deleteProductAction(sub, id); return undefined; }} />
      </div>
    </div>
  );
}
