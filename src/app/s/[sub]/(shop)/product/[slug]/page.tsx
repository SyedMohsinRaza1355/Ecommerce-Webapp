import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { products } from "@/lib/commerce/store";
import { ProductImage } from "@/components/store/ProductCard";
import { AddToCart } from "@/components/store/Bits";
import { Gallery } from "@/components/store/Gallery";
import { availableNow, describeAvailability, hasVariantStock } from "@/lib/commerce/options";
import { fmtMoney, t } from "@/lib/i18n";
import { addToCartAction, toggleCompareAction, stockAlertAction, quoteAction } from "../../actions";
import { previewOk, recordFunnel } from "@/lib/commerce/growth";
import { originOf } from "@/lib/commerce/orders";
import { cookies } from "next/headers";
import { currentCustomer } from "@/lib/commerce/customers";
import { listReviews, ratingSummary } from "@/lib/commerce/extras";
import { ProductCard } from "@/components/store/ProductCard";
import { WishlistButton } from "@/components/store/WishlistButton";
import AcctForm from "@/components/store/AcctForm";
import { wishlistAction, reviewAction } from "../../account/actions";

async function find(sub: string, slug: string, preview?: string) {
  const s = await loadStore(sub);
  if (s.status !== "ok") return null;
  let p = (await products.find(s.ctx, { slug, status: "published" } as never, 1))[0];
  let isPreview = false;
  if (!p && preview && s.eff.get("F-144")?.enabled === true) {
    const d = (await products.find(s.ctx, { slug } as never, 1))[0];
    if (d && previewOk(String(s.instance._id), d._id, preview)) { p = d; isPreview = true; }
  }
  return p ? { s, p, isPreview } : null;
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ sub: string; slug: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { sub, slug } = await params;
  const { preview } = await searchParams;
  const r = await find(sub, slug, preview);
  if (!r) return { title: "Not found" };
  if (r.isPreview) return { title: `Preview: ${r.p.name}`, robots: { index: false, follow: false } };
  return { title: r.p.seoTitle || r.p.name, alternates: { canonical: `/s/${sub}/product/${slug}` }, description: r.p.description.slice(0, 150) || r.p.name, openGraph: { title: r.p.name, images: r.p.imageUrl ? [r.p.imageUrl] : [] } };
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ sub: string; slug: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { sub, slug } = await params;
  const { preview } = await searchParams;
  const r = await find(sub, slug, preview);
  if (!r) notFound();
  const { s, p, isPreview } = r;
  if (!isPreview && s.eff.get("F-141")?.enabled === true) await recordFunnel(s.ctx, "view");
  const waDigits = s.eff.get("F-135")?.enabled === true ? (s.settings.whatsapp ?? "").replace(/\D/g, "") : "";
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
  const variantStocked = hasVariantStock(p);
  const allVariantsOut = variantStocked && (p.options ?? []).filter((g) => g.kind === "variant").every((g) => g.choices.every((c) => c.stock != null && c.stock <= 0));
  const sold = s.feat.stockTracking && !back && (variantStocked ? allVariantsOut : p.trackStock && p.stock <= 0);
  const images = [p.imageUrl, ...(p.gallery ?? [])].filter((x): x is string => Boolean(x));
  const notNow = !availableNow(p.availability);
  const windowText = describeAvailability(p.availability);
  const freeOver = s.feat.freeShipping && s.settings.freeShippingOverMinor ? s.settings.freeShippingOverMinor : null;
  const jsonLd = s.eff.get("F-140")?.enabled
    ? {
        "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description, ...(p.imageUrl ? { image: p.imageUrl } : {}),
        ...(summary.count ? { aggregateRating: { "@type": "AggregateRating", ratingValue: summary.average, reviewCount: summary.count } } : {}),
        offers: { "@type": "Offer", priceCurrency: s.settings.currency, price: (p.priceMinor / 100).toFixed(2), availability: sold ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" },
      }
    : null;

  return (
    <article className="max-md:pb-28">
      {isPreview && <p role="status" className="mb-4 rounded-lg bg-amber-100 p-3 text-sm font-semibold text-amber-900">Draft preview: customers cannot see this product yet.</p>}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted"><Link href={base} className="underline">{t(L, "home")}</Link> / <Link href={`${base}/products`} className="underline">{t(L, "shop")}</Link> / {p.name}</nav>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="reveal">{images.length > 1 ? <Gallery images={images} name={p.name} /> : <ProductImage p={p} />}</div>
        <div className="reveal reveal-1">
          <h1 className="text-3xl font-extrabold tracking-tight">{p.name}</h1>
          <p className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-extrabold">{fmtMoney(p.priceMinor, s.settings.currency, L)}</span>
            {p.compareAtMinor ? <s className="text-muted">{fmtMoney(p.compareAtMinor, s.settings.currency, L)}</s> : null}
          </p>
          <p className="mt-2">
            {sold ? <span className="badge badge-red">{t(L, "outOfStock")}</span> : !variantStocked && s.feat.stockTracking && p.trackStock && p.stock <= 5 && !(back && p.stock <= 0) ? <span className="badge badge-amber">{t(L, "onlyLeft", { n: p.stock })}</span> : <span className={`badge ${back && p.stock <= 0 ? "badge-amber" : "badge-green"}`}>{back && p.stock <= 0 ? "Available on backorder: ships when restocked" : t(L, "inStock")}</span>}
          </p>
          <div className="mt-6 max-md:hidden">
            <AddToCart action={addToCartAction.bind(null, sub, p._id)} cartHref={`${base}/cart`} price={fmtMoney(p.priceMinor, s.settings.currency, L)} label={t(L, "addToCart")} soldOut={sold} max={s.feat.stockTracking && p.trackStock && !back && !variantStocked ? p.stock : 99} groups={p.options ?? []} basePriceMinor={p.priceMinor} currency={s.settings.currency} unavailableNote={notNow ? `Only available ${windowText.toLowerCase()}` : undefined} />
          </div>
          {wishOn && (
            <div className="mt-4">
              {me ? <WishlistButton action={wishlistAction.bind(null, sub, p._id)} saved={me.wishlist.includes(p._id)} /> : <Link className="btn btn-secondary" href={`${base}/account/login?next=${encodeURIComponent(`${base}/product/${slug}`)}`}>♡ Sign in to save</Link>}
            </div>
          )}
          {s.eff.get("F-122")?.enabled === true && (
            <form action={toggleCompareAction.bind(null, sub, p._id, `${base}/product/${slug}`)} className="mt-3 flex items-center gap-3">
              <button className="btn btn-secondary">{((await cookies()).get(`cmp_${s.instance._id}`)?.value ?? "").split(",").includes(p._id) ? "Remove from compare" : "Compare"}</button>
              <Link className="text-sm underline" href={`${base}/compare`}>See comparison</Link>
            </form>
          )}
          {windowText && <p className="mt-3 text-sm text-muted">Orderable: {windowText}</p>}
          {sold && s.eff.get("F-121")?.enabled === true && (
            <div className="card mt-4">
              <h2 className="font-bold">Tell me when it is back</h2>
              <div className="mt-2"><AcctForm action={stockAlertAction.bind(null, sub, p._id)} submit="Notify me" fields={[{ name: "email", label: "Your email", type: "email", required: true, autoComplete: "email" }]} /></div>
            </div>
          )}
          {s.eff.get("F-119")?.enabled === true && (
            <details className="card mt-4">
              <summary className="cursor-pointer font-bold">Ask for a quote</summary>
              <div className="mt-3"><AcctForm action={quoteAction.bind(null, sub, p._id)} submit="Send request" fields={[
                { name: "name", label: "Your name", required: true, autoComplete: "name", maxLength: 80 },
                { name: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
                { name: "phone", label: "Phone (optional)", type: "tel", autoComplete: "tel", dir: "ltr", maxLength: 30 },
                { name: "qty", label: "How many do you need?", type: "number", dir: "ltr" },
                { name: "message", label: "What do you need?", required: true, maxLength: 2000 },
              ]} /></div>
            </details>
          )}
          {waDigits.length >= 8 && <a className="btn btn-secondary mt-3" href={`https://wa.me/${waDigits}?text=${encodeURIComponent(`Hi, I have a question about ${p.name} ${originOf()}${base}/product/${slug}`)}`} target="_blank" rel="noopener noreferrer">Ask on WhatsApp</a>}
          <section className="mt-6 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-line" aria-label="Delivery and returns">
            <p><strong>Delivery:</strong> {s.feat.shipping ? (s.settings.shippingFlatMinor > 0 ? `from ${fmtMoney(s.settings.shippingFlatMinor, s.settings.currency, L)}` : "free") : "arranged with the shop"}{freeOver ? `, free over ${fmtMoney(freeOver, s.settings.currency, L)}` : ""}.</p>
            {s.settings.returnNote && <p className="mt-1"><strong>Returns:</strong> {s.settings.returnNote}</p>}
          </section>
          {p.description && (
            <section className="mt-8" aria-labelledby="d">
              <h2 id="d" className="font-bold">{t(L, "description")}</h2>
              <p className="mt-1 whitespace-pre-line text-muted urdu-line">{p.description}</p>
            </section>
          )}
        </div>
      </div>
      {(p.attributes?.length ?? 0) > 0 && (
        <section className="mt-10" aria-labelledby="specs">
          <h2 id="specs" className="text-xl font-extrabold">Details</h2>
          <dl className="mt-3 max-w-xl divide-y divide-line rounded-xl ring-1 ring-line">
            {p.attributes!.map((a) => <div key={a.name} className="flex justify-between gap-4 p-3 text-sm"><dt className="font-semibold">{a.name}</dt><dd className="text-end">{a.value}</dd></div>)}
          </dl>
        </section>
      )}
      <AddToCart bar action={addToCartAction.bind(null, sub, p._id)} cartHref={`${base}/cart`} price={fmtMoney(p.priceMinor, s.settings.currency, L)} label={t(L, "addToCart")} soldOut={sold || notNow} max={99} groups={p.options ?? []} basePriceMinor={p.priceMinor} currency={s.settings.currency} />

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
