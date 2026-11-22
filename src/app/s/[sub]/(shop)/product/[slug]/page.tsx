import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { products } from "@/lib/commerce/store";
import { ProductImage } from "@/components/store/ProductCard";
import { AddToCart } from "@/components/store/Bits";
import { fmtMoney, t } from "@/lib/i18n";
import { addToCartAction } from "../../actions";
import { currentCustomer } from "@/lib/commerce/customers";
import { listReviews, ratingSummary } from "@/lib/commerce/extras";
import { ProductCard } from "@/components/store/ProductCard";
import { WishlistButton } from "@/components/store/WishlistButton";
import AcctForm from "@/components/store/AcctForm";
import { wishlistAction, reviewAction } from "../../account/actions";

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
  return { title: r.p.name, alternates: { canonical: `/s/${sub}/product/${slug}` }, description: r.p.description.slice(0, 150) || r.p.name, openGraph: { title: r.p.name, images: r.p.imageUrl ? [r.p.imageUrl] : [] } };
}

export default async function ProductPage({ params }: { params: Promise<{ sub: string; slug: string }> }) {
  const { sub, slug } = await params;
  const r = await find(sub, slug);
  if (!r) notFound();
  const { s, p } = r;
  const L = s.locale;
  const base = `/s/${sub}`;
  const reviewsOn = s.eff.get("F-009")?.enabled === true;
  const wishOn = s.eff.get("F-048")?.enabled === true && s.eff.get("F-045")?.enabled !== false;
  const me = reviewsOn || wishOn ? await currentCustomer(s) : null;
  const [reviews, summary] = reviewsOn ? await Promise.all([listReviews(s.ctx, p._id), ratingSummary(s.ctx, p._id)]) : [[], { count: 0, average: 0 }];
  const related = s.eff.get("F-010")?.enabled === true && p.categoryId
    ? (await products.find(s.ctx, { categoryId: p.categoryId, status: "published", _id: { $ne: p._id } } as never, 4))
    : [];
  const back = Boolean(s.feat.backorders && p.backorder);
  const sold = s.feat.stockTracking && p.trackStock && p.stock <= 0 && !back;
  const jsonLd = s.eff.get("F-140")?.enabled
    ? {
        "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description, ...(p.imageUrl ? { image: p.imageUrl } : {}),
        ...(summary.count ? { aggregateRating: { "@type": "AggregateRating", ratingValue: summary.average, reviewCount: summary.count } } : {}),
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
            {sold ? <span className="badge badge-red">{t(L, "outOfStock")}</span> : s.feat.stockTracking && p.trackStock && p.stock <= 5 && !(back && p.stock <= 0) ? <span className="badge badge-amber">{t(L, "onlyLeft", { n: p.stock })}</span> : <span className={`badge ${back && p.stock <= 0 ? "badge-amber" : "badge-green"}`}>{back && p.stock <= 0 ? "Available on backorder: ships when restocked" : t(L, "inStock")}</span>}
          </p>
          <div className="mt-6">
            <AddToCart action={addToCartAction.bind(null, sub, p._id)} label={t(L, "addToCart")} soldOut={sold} max={s.feat.stockTracking && p.trackStock && !back ? p.stock : 99} />
          </div>
          {wishOn && (
            <div className="mt-4">
              {me ? <WishlistButton action={wishlistAction.bind(null, sub, p._id)} saved={me.wishlist.includes(p._id)} /> : <Link className="btn btn-secondary" href={`${base}/account/login?next=${encodeURIComponent(`${base}/product/${slug}`)}`}>♡ Sign in to save</Link>}
            </div>
          )}
          {p.description && (
            <section className="mt-8" aria-labelledby="d">
              <h2 id="d" className="font-bold">{t(L, "description")}</h2>
              <p className="mt-1 whitespace-pre-line text-muted urdu-line">{p.description}</p>
            </section>
          )}
        </div>
      </div>
      {reviewsOn && (
        <section className="mt-12" aria-labelledby="rv">
          <h2 id="rv" className="text-xl font-extrabold">Reviews {summary.count > 0 && <span className="text-base font-semibold text-muted">★ {summary.average} ({summary.count})</span>}</h2>
          {reviews.length === 0 && <p className="mt-2 text-muted">No reviews yet. Be the first to share what you think.</p>}
          <ul className="mt-4 space-y-3">
            {reviews.map((r) => (
              <li key={r._id} className="card p-4">
                <p className="text-sm"><span className="text-amber-500" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span> <strong>{r.name}</strong>{r.verifiedBuyer && <span className="badge badge-green ms-2">Bought this</span>}</p>
                {r.text && <p className="mt-1 whitespace-pre-line text-sm">{r.text}</p>}
              </li>
            ))}
          </ul>
          <div className="card mt-5 max-w-xl">
            <h3 className="font-bold">Write a review</h3>
            {me ? (
              <div className="mt-2">
                <AcctForm action={reviewAction.bind(null, sub, p._id)} submit="Post review" fields={[
                  { name: "rating", label: "Stars (1 to 5)", type: "number", required: true },
                  { name: "text", label: "Your review (optional)", maxLength: 1000 },
                ]} />
              </div>
            ) : <p className="mt-1 text-sm"><Link className="underline" href={`${base}/account/login?next=${encodeURIComponent(`${base}/product/${slug}`)}`}>Sign in</Link> to write a review.</p>}
          </div>
        </section>
      )}
      {related.length > 0 && (
        <section className="mt-12" aria-labelledby="rl">
          <h2 id="rl" className="text-xl font-extrabold">You may also like</h2>
          <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">{related.map((r, i) => <ProductCard key={r._id} p={r} base={base} currency={s.settings.currency} locale={L} trackStock={s.feat.stockTracking} backorders={s.feat.backorders} delay={i} />)}</ul>
        </section>
      )}
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
    </article>
  );
}
