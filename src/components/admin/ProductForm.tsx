import { AF } from "./Forms";
import type { AdminState } from "@/app/s/[sub]/admin/actions";

type P = { name?: string; description?: string; price?: string; compareAt?: string; categoryId?: string; imageUrl?: string; stock?: number; trackStock?: boolean; status?: string };

export function ProductForm({ action, categories, initial = {}, submit }: { action: (p: AdminState, f: FormData) => Promise<AdminState>; categories: { id: string; name: string }[]; initial?: P; submit: string }) {
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
        <label className="field"><span>Image link (https)</span><input className="input" name="imageUrl" defaultValue={initial.imageUrl} placeholder="https://..." dir="ltr" /></label>
        <label className="field"><span>Stock</span><input className="input" name="stock" type="number" min={0} step={1} defaultValue={initial.stock ?? 0} dir="ltr" /></label>
        <label className="field"><span>Status</span>
          <select className="input" name="status" defaultValue={initial.status ?? "draft"}><option value="draft">Draft (hidden)</option><option value="published">Published</option></select>
        </label>
      </div>
      <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" name="trackStock" defaultChecked={initial.trackStock ?? true} /> Track stock for this product</label>
    </AF>
  );
}
