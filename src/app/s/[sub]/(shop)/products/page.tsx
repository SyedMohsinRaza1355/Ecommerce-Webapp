import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { categories, listPublished } from "@/lib/commerce/store";
import { ProductCard } from "@/components/store/ProductCard";
import { t } from "@/lib/i18n";

export const metadata = { title: "Shop" };

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ q?: string; cat?: string; page?: string; sort?: string }> }) {
  const { sub } = await params;
  const sp = await searchParams;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  const L = s.locale;
  const base = `/s/${sub}`;
  const q = (sp.q ?? "").slice(0, 60);
  const cat = (sp.cat ?? "").slice(0, 60);
  const page = Math.max(parseInt(sp.page ?? "1", 10) || 1, 1);
  const sort = (["new", "price_asc", "price_desc", "name"] as const).find((x) => x === sp.sort) ?? "new";
  const [cats, res] = await Promise.all([categories.find(s.ctx, {}, 50), listPublished(s.ctx, { q, categoryId: cat || undefined, page, pageSize: 24, sort })]);
  const pages = Math.max(Math.ceil(res.total / res.pageSize), 1);
  const href = (p: number, c = cat) => `${base}/products?${new URLSearchParams({ ...(q ? { q } : {}), ...(c ? { cat: c } : {}), ...(sort !== "new" ? { sort } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">{q ? `${t(L, "search")}: ${q}` : t(L, "shop")}</h1>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t(L, "categories")}>
        <Link href={href(1, "")} aria-current={!cat ? "page" : undefined} className={`badge px-3 py-1.5 text-sm ${!cat ? "badge-indigo ring-2 ring-indigo-300" : "badge-slate"}`}>{t(L, "all")}</Link>
        {cats.map((c) => (
          <Link key={c._id} href={href(1, c._id)} aria-current={cat === c._id ? "page" : undefined} className={`badge px-3 py-1.5 text-sm ${cat === c._id ? "badge-indigo ring-2 ring-indigo-300" : "badge-slate"}`}>{c.name}</Link>
        ))}
      </nav>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">{res.total} {t(L, "items")}</p>
        <form method="get" className="flex items-center gap-2">
          {q && <input type="hidden" name="q" value={q} />}
          {cat && <input type="hidden" name="cat" value={cat} />}
          <label htmlFor="sort" className="text-sm font-semibold">{t(L, "sortBy")}</label>
          <select id="sort" name="sort" className="input !w-auto" defaultValue={sort}>
            <option value="new">{t(L, "sortNew")}</option><option value="price_asc">{t(L, "sortLow")}</option><option value="price_desc">{t(L, "sortHigh")}</option><option value="name">{t(L, "sortName")}</option>
          </select>
          <button className="btn btn-secondary">OK</button>
        </form>
      </div>

      {res.items.length === 0 ? (
        <div className="card pop-in mt-6 text-center">
          <h2 className="text-lg font-bold">{t(L, "noProducts")}</h2>
          <p className="text-muted">{t(L, "noProductsHint")}</p>
          <Link href={`${base}/products`} className="btn btn-secondary mt-4">{t(L, "all")}</Link>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {res.items.map((p, i) => (
            <ProductCard key={p._id} p={p} base={base} currency={s.settings.currency} locale={L} trackStock={s.feat.stockTracking} backorders={s.feat.backorders} delay={i} heading="h2" />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
          {page > 1 && <Link className="btn btn-secondary" href={href(page - 1)}>{t(L, "previous")}</Link>}
          <span className="text-sm">{t(L, "page")} {page} / {pages}</span>
          {page < pages && <Link className="btn btn-secondary" href={href(page + 1)}>{t(L, "next")}</Link>}
        </nav>
      )}
    </div>
  );
}
