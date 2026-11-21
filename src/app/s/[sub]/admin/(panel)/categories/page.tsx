import { guard } from "@/lib/commerce/guard";
import { categories, products } from "@/lib/commerce/store";
import { AF } from "@/components/admin/Forms";
import { categoryAction } from "../../actions";

export const metadata = { title: "Categories" };

export default async function CategoriesPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "catalog.manage");
  const cats = await categories.find(store.ctx, {}, 100);
  const counts = await Promise.all(cats.map((c) => products.count(store.ctx, { categoryId: c._id } as never)));
  const action = categoryAction.bind(null, sub);
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Categories</h1>
      <p className="mb-5 text-muted">Group products so customers can browse.</p>
      <AF action={action} submit="Add category" className="card mb-5">
        <input type="hidden" name="op" value="add" />
        <label className="field"><span>New category</span><input className="input" name="name" maxLength={60} required placeholder="Desserts" /></label>
      </AF>
      <div className="card p-0">
        <ul className="divide-y divide-line">
          {cats.length === 0 && <li className="p-5 text-center text-muted">No categories yet.</li>}
          {cats.map((c, i) => (
            <li key={c._id} className="flex flex-wrap items-center gap-3 p-4">
              <AF action={action} submit="Rename" secondary className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="op" value="rename" /><input type="hidden" name="id" value={c._id} />
                <label className="sr-only" htmlFor={`n-${c._id}`}>Category name</label>
                <input id={`n-${c._id}`} className="input w-56" name="name" defaultValue={c.name} maxLength={60} />
              </AF>
              <span className="badge badge-slate">{counts[i]} products</span>
              <AF action={action} submit="Delete" secondary className="ms-auto">
                <input type="hidden" name="op" value="delete" /><input type="hidden" name="id" value={c._id} />
              </AF>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
