import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { cartView } from "@/lib/commerce/cart";
import { pricingConfig } from "@/lib/commerce/features";
import { ProductImage } from "@/components/store/ProductCard";
import { Icon } from "@/components/Icons";
import { fmtMoney, t } from "@/lib/i18n";
import { updateCartAction } from "../actions";

export const metadata = { title: "Cart" };

export default async function CartPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  const L = s.locale;
  const base = `/s/${sub}`;
  const cartId = (await cookies()).get(`cart_${s.instance._id}`)?.value;
  const v = await cartView(s.ctx, cartId, pricingConfig(s.settings, s.feat), s.feat.stockTracking);
  const money = (n: number) => fmtMoney(n, s.settings.currency, L);

  if (v.lines.length === 0) {
    return (
      <div className="card pop-in mx-auto max-w-md text-center">
        <span className="icon-chip mx-auto">{Icon.cart}</span>
        <h1 className="mt-4 text-xl font-extrabold">{t(L, "emptyCart")}</h1>
        <p className="mt-1 text-muted">{t(L, "emptyCartHint")}</p>
        <Link href={`${base}/products`} className="btn btn-primary mt-5">{t(L, "continueShopping")}</Link>
      </div>
    );
  }

  const free = s.feat.freeShipping && s.settings.freeShippingOverMinor ? s.settings.freeShippingOverMinor : null;
  const remaining = free ? Math.max(free - (v.totals.subtotalMinor - v.totals.discountMinor), 0) : 0;
  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">{t(L, "cart")}</h1>
      {free && (
        <div className="card mt-4" role="status">
          {remaining > 0 ? <p className="text-sm">Add {money(remaining)} more for free shipping.</p> : <p className="text-sm text-green-800">You get free shipping.</p>}
          <div className="mt-2 h-2 rounded-full bg-slate-200" aria-hidden="true"><div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, Math.round(((free - remaining) / free) * 100))}%`, background: "var(--brand-primary)" }} /></div>
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <ul className="space-y-3">
          {v.lines.map((l) => (
            <li key={l.product._id} className="card flex gap-4">
              <div className="w-24 shrink-0"><ProductImage p={l.product} /></div>
              <div className="min-w-0 grow">
                <Link href={`${base}/product/${l.product.slug}`} className="font-bold hover:underline">{l.product.name}</Link>
                <p className="text-sm text-muted">{money(l.product.priceMinor)}</p>
                {l.problem && <p role="alert" className="err">{l.problem === "lowstock" ? `Only ${l.product.stock} left. Lower the quantity.` : "No longer available. Remove it to continue."}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <form action={updateCartAction.bind(null, sub, l.product._id)} className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`q-${l.product._id}`}>{t(L, "quantity")}</label>
                    <input id={`q-${l.product._id}`} className="input w-20" type="number" name="qty" min={1} max={99} defaultValue={l.qty} />
                    <input type="hidden" name="act" value="set" />
                    <button className="btn btn-secondary">{t(L, "apply")}</button>
                  </form>
                  <form action={updateCartAction.bind(null, sub, l.product._id)}>
                    <input type="hidden" name="act" value="remove" />
                    <button className="btn btn-secondary">{t(L, "remove")}</button>
                  </form>
                </div>
              </div>
              <p className="font-extrabold">{money(l.lineMinor)}</p>
            </li>
          ))}
        </ul>
        <aside className="card h-fit" aria-label="Summary">
          <h2 className="font-extrabold">{t(L, "yourOrder")}</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt>{t(L, "subtotal")}</dt><dd>{money(v.totals.subtotalMinor)}</dd></div>
            {s.feat.shipping && <div className="flex justify-between"><dt>{t(L, "shipping")}</dt><dd>{v.totals.shippingMinor === 0 ? t(L, "free") : money(v.totals.shippingMinor)}</dd></div>}
            {s.feat.tax && s.settings.taxBps > 0 && <div className="flex justify-between"><dt>{t(L, "tax")}</dt><dd>{money(v.totals.taxMinor)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-base font-extrabold"><dt>{t(L, "total")}</dt><dd>{money(v.totals.totalMinor)}</dd></div>
          </dl>
          {v.hasProblems ? <p className="err mt-3">Fix the items marked above to continue.</p> : <Link href={`${base}/checkout`} className="btn btn-primary mt-4 w-full">{t(L, "checkout")}</Link>}
          <Link href={`${base}/products`} className="mt-2 block text-center text-sm underline">{t(L, "continueShopping")}</Link>
        </aside>
      </div>
    </div>
  );
}
