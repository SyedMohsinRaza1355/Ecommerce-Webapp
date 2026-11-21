import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { products } from "@/lib/commerce/store";
import { ProductImage } from "@/components/store/ProductCard";
import { AddToCart } from "@/components/store/Bits";
import { fmtMoney, t } from "@/lib/i18n";
import { addToCartAction } from "../../actions";

async function find(sub: string, slug: string) {
  const s = await loadStore(sub);
  if (s.status !== "ok") return null;
  const p = (await products.find(s.ctx, { slug, status: "published" } as never, 1))[0];
  return p ? { s, p } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ sub: string; slug: string }> }) {
  const { sub, slug } = await params;
  const r = await find(sub, slug);
  if (!r) return { title: "Not found" };
  return { title: r.p.name, description: r.p.description.slice(0, 150) || r.p.name, openGraph: { title: r.p.name, images: r.p.imageUrl ? [r.p.imageUrl] : [] } };
}

export default async function ProductPage({ params }: { params: Promise<{ sub: string; slug: string }> }) {
  const { sub, slug } = await params;
  const r = await find(sub, slug);
  if (!r) notFound();
  const { s, p } = r;
  const L = s.locale;
  const base = `/s/${sub}`;
  const sold = s.feat.stockTracking && p.trackStock && p.stock <= 0;
  const jsonLd = s.eff.get("F-140")?.enabled
    ? {
        "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description, ...(p.imageUrl ? { image: p.imageUrl } : {}),
        offers: { "@type": "Offer", priceCurrency: s.settings.currency, price: (p.priceMinor / 100).toFixed(2), availability: sold ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" },
      }
    : null;

  return (
    <article>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted"><Link href={base} className="underline">{t(L, "home")}</Link> / <Link href={`${base}/products`} className="underline">{t(L, "shop")}</Link> / {p.name}</nav>
      <div className="grid gap-8 md:grid-cols-2">
        <ProductImage p={p} className="reveal" />
        <div className="reveal reveal-1">
          <h1 className="text-3xl font-extrabold tracking-tight">{p.name}</h1>
          <p className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-extrabold">{fmtMoney(p.priceMinor, s.settings.currency, L)}</span>
            {p.compareAtMinor ? <s className="text-muted">{fmtMoney(p.compareAtMinor, s.settings.currency, L)}</s> : null}
          </p>
          <p className="mt-2">
            {sold ? <span className="badge badge-red">{t(L, "outOfStock")}</span> : s.feat.stockTracking && p.trackStock && p.stock <= 5 ? <span className="badge badge-amber">{t(L, "onlyLeft", { n: p.stock })}</span> : <span className="badge badge-green">{t(L, "inStock")}</span>}
          </p>
          <div className="mt-6">
            <AddToCart action={addToCartAction.bind(null, sub, p._id)} label={t(L, "addToCart")} soldOut={sold} max={s.feat.stockTracking && p.trackStock ? p.stock : 99} />
          </div>
          {p.description && (
            <section className="mt-8" aria-labelledby="d">
              <h2 id="d" className="font-bold">{t(L, "description")}</h2>
              <p className="mt-1 whitespace-pre-line text-muted urdu-line">{p.description}</p>
            </section>
          )}
        </div>
      </div>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
    </article>
  );
}
