import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { categories, listPublished } from "@/lib/commerce/store";
import { ProductCard } from "@/components/store/ProductCard";
import { Icon } from "@/components/Icons";
import { PACK_BY_ID } from "@/catalog/packs";
import { t } from "@/lib/i18n";
import HeroSlider from "@/components/store/HeroSlider";
import { Fragment } from "react";

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

  const trust = (
      <ul className="trust-strip" aria-label="Why shop here">
        {([["truck", "trust1", "trust1d"], ["lock", "trust2", "trust2d"], ["shield", "trust3", "trust3d"]] as const).map(([ic, k, d]) => (
          <li key={k} className="card flex items-start gap-3 p-4">
            <span className="icon-chip !h-10 !w-10 shrink-0">{Icon[ic]}</span>
            <span><span className="block font-bold">{t(L, k)}</span><span className="text-sm text-muted">{t(L, d)}</span></span>
          </li>
        ))}
      </ul>
  );
  const catBlock = (

        <section aria-labelledby="cats-h" className="mb-10">
          <h2 id="cats-h" className="text-2xl font-extrabold">{t(L, "categories")}</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cats.map((c, i) => (
              <li key={c._id}>
                <Link href={`${base}/products?cat=${c._id}`} className={`card hover-lift reveal reveal-${(i % 6) + 1} block text-center`}>
                  <span className="ph mx-auto !aspect-square !w-14 text-2xl" aria-hidden="true">{c.name.slice(0, 2).replace(/^./, (x) => x.toUpperCase())}</span>
                  <span className="mt-3 block font-semibold">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
  );
  const feat = (
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
              <ProductCard key={p._id} p={p} base={base} currency={s.settings.currency} locale={L} trackStock={s.feat.stockTracking} backorders={s.feat.backorders} delay={i} />
            ))}
          </ul>
        )}
      </section>
  );
  const blocks = { trust, categories: cats.length > 0 ? catBlock : null, featured: feat };
  const order = s.eff.get("F-083")?.enabled !== false && s.settings.homeSections?.length ? s.settings.homeSections : (["trust", "categories", "featured"] as const);

  return (
    <div>
      {slider !== false && (s.settings.hero?.length ?? 0) > 0 && <HeroSlider slides={s.settings.hero!} cta={t(L, "shop")} />}
      {slider !== false && !(s.settings.hero?.length) && (
        <section className="hero-bg -mx-4 -mt-8 mb-10 rounded-b-3xl sm:mx-0 sm:mt-0 sm:rounded-3xl" aria-labelledby="hero-h">
          <div className="hero-grid" aria-hidden="true" />
          <div className="relative px-6 py-14 text-center sm:py-20">
            <h1 id="hero-h" className="reveal text-4xl font-extrabold tracking-tight sm:text-5xl">{name}</h1>
            <p className="reveal reveal-1 mx-auto mt-3 max-w-xl text-lg text-slate-200 urdu-line">{s.settings.branding.tagline || pack?.name}</p>
            <Link href={`${base}/products`} className="btn btn-primary reveal reveal-2 mt-7">{t(L, "shop")}</Link>
          </div>
        </section>
      )}

      {order.map((k) => <Fragment key={k}>{blocks[k]}</Fragment>)}
    </div>
  );
}
