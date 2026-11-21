import Link from "next/link";
import type { Product } from "@/lib/commerce/types";
import { fmtMoney, t, type Locale } from "@/lib/i18n";

export function ProductImage({ p, className = "" }: { p: Pick<Product, "name" | "imageUrl">; className?: string }) {
  if (p.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.imageUrl} alt={p.name} loading="lazy" width={640} height={480} className={`product-img ${className}`} />;
  }
  return (
    <div role="img" aria-label={p.name} className={`product-img flex items-center justify-center text-4xl font-extrabold text-indigo-300 ${className}`}>
      {p.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function ProductCard({ p, base, currency, locale, trackStock, delay = 0, heading = "h3" }: { p: Product; base: string; currency: string; locale: Locale; trackStock: boolean; delay?: number; heading?: "h2" | "h3" }) {
  const H = heading;
  const sold = trackStock && p.trackStock && p.stock <= 0;
  return (
    <li className="card hover-lift reveal flex flex-col p-3" style={{ animationDelay: `${Math.min(delay, 12) * 40}ms` }}>
      <Link href={`${base}/product/${p.slug}`} className="block">
        <ProductImage p={p} />
        <H className="mt-3 line-clamp-2 font-bold leading-snug">{p.name}</H>
      </Link>
      <div className="mt-auto pt-2">
        <p className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold">{fmtMoney(p.priceMinor, currency, locale)}</span>
          {p.compareAtMinor ? <s className="text-sm text-muted">{fmtMoney(p.compareAtMinor, currency, locale)}</s> : null}
        </p>
        {sold ? <span className="badge badge-red">{t(locale, "outOfStock")}</span> : trackStock && p.trackStock && p.stock <= 5 ? <span className="badge badge-amber">{t(locale, "onlyLeft", { n: p.stock })}</span> : null}
      </div>
    </li>
  );
}
