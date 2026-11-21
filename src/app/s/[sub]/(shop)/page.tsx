import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { categories, listPublished } from "@/lib/commerce/store";
import { ProductCard } from "@/components/store/ProductCard";
import { Icon } from "@/components/Icons";
import { PACK_BY_ID } from "@/catalog/packs";
import { t } from "@/lib/i18n";

export default async function StoreHome({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  const L = s.locale;
  const base = `/s/${sub}`;
  const [cats, featured] = await Promise.all([categories.find(s.ctx, {}, 20), listPublished(s.ctx, { pageSize: 8 })]);
  const name = s.settings.branding.storeName || s.instance.name;
  const pack = s.instance.industryPack ? PACK_BY_ID.get(s.instance.industryPack) : undefined;
  const slider = s.eff.get("F-084")?.enabled;

  return (
    <div>
      {slider !== false && (
        <section className="hero-bg -mx-4 -mt-8 mb-10 rounded-b-3xl sm:mx-0 sm:mt-0 sm:rounded-3xl" aria-labelledby="hero-h">
          <div className="hero-grid" aria-hidden="true" />
          <div className="relative px-6 py-14 text-center sm:py-20">
            <h1 id="hero-h" className="reveal text-4xl font-extrabold tracking-tight sm:text-5xl">{name}</h1>
            <p className="reveal reveal-1 mx-auto mt-3 max-w-xl text-lg text-slate-200 urdu-line">{s.settings.branding.tagline || pack?.name}</p>
            <Link href={`${base}/products`} className="btn btn-primary reveal reveal-2 mt-7">{t(L, "shop")}</Link>
          </div>
        </section>
      )}

      {cats.length > 0 && (
        <section aria-labelledby="cats-h" className="mb-10">
          <h2 id="cats-h" className="text-2xl font-extrabold">{t(L, "categories")}</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cats.map((c, i) => (
              <li key={c._id}>
                <Link href={`${base}/products?cat=${c._id}`} className={`card hover-lift reveal reveal-${(i % 6) + 1} block text-center`}>
                  <span className="icon-chip mx-auto">{Icon.box}</span>
                  <span className="mt-3 block font-semibold">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="feat-h">
        <div className="flex items-baseline justify-between">
          <h2 id="feat-h" className="text-2xl font-extrabold">{t(L, "featured")}</h2>
          <Link href={`${base}/products`} className="link text-sm">{t(L, "viewAll")}</Link>
        </div>
        {featured.items.length === 0 ? (
          <div className="card mt-4 text-center text-muted">{t(L, "noProducts")}</div>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {featured.items.map((p, i) => (
              <ProductCard key={p._id} p={p} base={base} currency={s.settings.currency} locale={L} trackStock={s.feat.stockTracking} delay={i} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
