import { AF } from "./Forms";
import ImageUploader from "./ImageUploader";
import type { AdminState } from "@/app/s/[sub]/admin/actions";

type P = { name?: string; description?: string; price?: string; compareAt?: string; categoryId?: string; imageUrl?: string; stock?: number; trackStock?: boolean; backorder?: boolean; status?: string; sku?: string; weight?: string; seoTitle?: string; seoDescription?: string; optionsText?: string; galleryText?: string; attributesText?: string; bundleText?: string; availDays?: string; availFrom?: string; availTo?: string };

export function ProductForm({ action, upload, categories, initial = {}, submit }: { action: (p: AdminState, f: FormData) => Promise<AdminState>; upload: (p: AdminState, f: FormData) => Promise<AdminState>; categories: { id: string; name: string }[]; initial?: P; submit: string }) {
  return (
    <AF action={action} submit={submit} className="card max-w-2xl">
      <label className="field"><span>Name</span><input className="input" name="name" defaultValue={initial.name} required maxLength={120} /></label>
      <label className="field"><span>Description</span><textarea className="input min-h-28" name="description" defaultValue={initial.description} maxLength={4000} /></label>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <label className="field"><span>Price</span><input className="input" name="price" defaultValue={initial.price} inputMode="decimal" required placeholder="499.00" dir="ltr" /></label>
        <label className="field"><span>Compare-at price (optional)</span><input className="input" name="compareAt" defaultValue={initial.compareAt} inputMode="decimal" placeholder="599.00" dir="ltr" /><p className="hint">Shown crossed out. Must be higher than the price.</p></label>
        <label className="field"><span>Category</span>
          <select className="input" name="categoryId" defaultValue={initial.categoryId ?? ""}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <div className="sm:col-span-2"><ImageUploader upload={upload} targetName="imageUrl" /></div>
        <label className="field"><span>Image link (https or uploaded)</span><input className="input" name="imageUrl" defaultValue={initial.imageUrl} placeholder="https://..." dir="ltr" /></label>
        <label className="field"><span>Stock</span><input className="input" name="stock" type="number" min={0} step={1} defaultValue={initial.stock ?? 0} dir="ltr" /></label>
        <label className="field"><span>Status</span>
          <select className="input" name="status" defaultValue={initial.status ?? "draft"}><option value="draft">Draft (hidden)</option><option value="published">Published</option></select>
        </label>
      </div>
      <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="trackStock" defaultChecked={initial.trackStock ?? true} /> Track stock for this product</label>
      <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="backorder" defaultChecked={initial.backorder ?? false} /> Allow orders when out of stock (backorder). Needs &quot;Backorders&quot; turned on in Features.</label>
      <details className="mb-4 rounded-xl p-3 ring-1 ring-line" open={Boolean(initial.optionsText || initial.galleryText || initial.attributesText || initial.bundleText || initial.availDays || initial.sku)}>
        <summary className="cursor-pointer font-bold">More: sizes and extras, pictures, details, combos, hours</summary>
        <label className="field mt-3"><span>Product code (SKU, optional)</span><input className="input" name="sku" defaultValue={initial.sku} maxLength={40} dir="ltr" /><p className="hint">Used for barcode scanning when receiving stock.</p></label>
        <label className="field"><span>Weight in grams (optional, for weight-based delivery fees)</span><input className="input w-40" name="weight" defaultValue={initial.weight} inputMode="numeric" maxLength={8} dir="ltr" /></label>
        <label className="field"><span>Search engine title (optional, up to 70 characters)</span><input className="input" name="seoTitle" defaultValue={initial.seoTitle} maxLength={70} /></label>
        <label className="field"><span>Search engine description (optional, up to 160)</span><input className="input" name="seoDescription" defaultValue={initial.seoDescription} maxLength={160} /></label>
        <label className="field"><span>Sizes, colours and extras</span>
          <textarea className="input min-h-24 font-mono text-sm" name="optionsText" defaultValue={initial.optionsText} dir="ltr" placeholder={"variant Size! : Small stock 10; Large +50 stock 3\nmodifier Extras* max 2 : Cheese +30; Bacon +60"} />
          <p className="hint">One group per line. <code>variant</code> = the shopper must pick one (each can have its own stock). <code>modifier</code> = extras. Add <code>!</code> after the name if required, <code>*</code> to allow several. <code>+50</code> adds to the price.</p>
        </label>
        <label className="field"><span>Extra pictures (one link per line)</span><textarea className="input min-h-20" name="galleryText" defaultValue={initial.galleryText} dir="ltr" placeholder="https://..." /></label>
        <label className="field"><span>Details (one per line, like Material: Cotton)</span><textarea className="input min-h-20" name="attributesText" defaultValue={initial.attributesText} /></label>
        <label className="field"><span>Combo parts (makes this a bundle)</span><textarea className="input min-h-16 font-mono text-sm" name="bundleText" defaultValue={initial.bundleText} dir="ltr" placeholder="1 x product-id-of-burger" /><p className="hint">Each line: how many, then the product id from the product&apos;s edit address. Stock is taken from the parts.</p></label>
        <fieldset className="mb-2"><legend className="text-sm font-semibold">Only orderable at certain times (optional)</legend>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-3">
            <label className="field"><span>Days (mon,tue,...)</span><input className="input" name="availDays" defaultValue={initial.availDays} dir="ltr" placeholder="mon,tue,wed,thu,fri" /></label>
            <label className="field"><span>From</span><input className="input" type="time" name="availFrom" defaultValue={initial.availFrom} /></label>
            <label className="field"><span>To</span><input className="input" type="time" name="availTo" defaultValue={initial.availTo} /></label>
          </div>
        </fieldset>
      </details>
    </AF>
  );
}
