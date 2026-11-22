import Link from "next/link";
import type { Product } from "@/lib/commerce/types";
import { fmtMoney, t, type Locale } from "@/lib/i18n";
import { addToCartAction } from "@/app/s/[sub]/(shop)/actions";
import { QuickAdd } from "./QuickAdd";
import { hasRequiredOptions } from "@/lib/commerce/options";

export function ProductImage({ p, className = "" }: { p: Pick<Product, "name" | "imageUrl">; className?: string }) {
  if (p.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" width={640} height={480} className={`product-img ${className}`} />;
  }
  const initials = p.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div role="img" aria-label={p.name} className={`ph text-5xl ${className}`}>
      {initials}
    </div>
  );
}

export function ProductCard({ p, base, currency, locale, trackStock, backorders = false, delay = 0, heading = "h3" }: { p: Product; base: string; currency: string; locale: Locale; trackStock: boolean; backorders?: boolean; delay?: number; heading?: "h2" | "h3" }) {
  const H = heading;
  const back = backorders && Boolean(p.backorder);
  const sold = trackStock && p.trackStock && p.stock <= 0 && !back;
  const off = p.compareAtMinor && p.compareAtMinor > p.priceMinor ? Math.round(((p.compareAtMinor - p.priceMinor) / p.compareAtMinor) * 100) : 0;
  const sub = base.split("/")[2] ?? "";
  return (
    <li className="card hover-lift reveal relative flex flex-col p-3" style={{ animationDelay: `${Math.min(delay, 12) * 40}ms` }}>
      {off > 0 && !sold && <span className="sale-flag" aria-label={`${off}% off`}>-{off}%</span>}
      <Link href={`${base}/product/${p.slug}`} className="block">
        <ProductImage p={p} />
        <H className="mt-3 line-clamp-2 min-h-[2.6em] font-bold leading-snug">{p.name}</H>
      </Link>
      <div className="mt-auto pt-2">
        <p className="flex flex-wrap items-baseline gap-x-2 pe-11">
          <span className="text-lg font-extrabold">{fmtMoney(p.priceMinor, currency, locale)}</span>
          {p.compareAtMinor ? <s className="text-sm text-muted">{fmtMoney(p.compareAtMinor, currency, locale)}</s> : null}
        </p>
        {sold ? <span className="badge badge-red">{t(locale, "outOfStock")}</span> : trackStock && p.trackStock && p.stock <= 5 && !(back && p.stock <= 0) ? <span className="badge badge-amber">{t(locale, "onlyLeft", { n: p.stock })}</span> : null}
      </div>
      {!sold && sub && hasRequiredOptions(p) && <Link href={`${base}/product/${p.slug}`} className="quick-add !w-auto px-3 text-sm" aria-label={`Choose options for ${p.name}`}>{t(locale, "chooseOptions")}</Link>}
      {!sold && sub && !hasRequiredOptions(p) && <QuickAdd action={addToCartAction.bind(null, sub, p._id)} name={p.name} cartHref={`${base}/cart`} label={t(locale, "addShort")} addedText={t(locale, "addedToCart")} />}
    </li>
  );
}
