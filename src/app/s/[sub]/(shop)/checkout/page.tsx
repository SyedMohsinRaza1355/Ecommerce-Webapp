import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { loadStore } from "@/lib/commerce/load";
import { cartView } from "@/lib/commerce/cart";
import { pricingConfig } from "@/lib/commerce/features";
import { fmtMoney, t } from "@/lib/i18n";
import { placeOrderAction } from "../actions";
import CheckoutForm from "./CheckoutForm";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  const L = s.locale;
  const base = `/s/${sub}`;
  const cartId = (await cookies()).get(`cart_${s.instance._id}`)?.value;
  const v = await cartView(s.ctx, cartId, pricingConfig(s.settings, s.feat), s.feat.stockTracking);
  if (v.lines.length === 0 || v.hasProblems) redirect(`${base}/cart`);
  const money = (n: number) => fmtMoney(n, s.settings.currency, L);
  const canPay = s.feat.card || s.feat.cod;

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">{t(L, "checkout")}</h1>
      {!canPay ? (
        <div className="card mt-6 text-center"><p>Ordering is not available right now. Please contact the store.</p></div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
          <CheckoutForm
            action={placeOrderAction.bind(null, sub)}
            idem={randomUUID()}
            card={s.feat.card}
            cod={s.feat.cod}
            discounts={s.feat.discounts}
            labels={{ contact: t(L, "contact"), fullName: t(L, "fullName"), email: t(L, "email"), phone: t(L, "phone"), address: t(L, "address"), city: t(L, "city"), notes: t(L, "notes"), payment: t(L, "payment"), payCard: t(L, "payCard"), payCod: t(L, "payCod"), discountCode: t(L, "discountCode"), placeOrder: t(L, "placeOrder") }}
          />
          <aside className="card h-fit" aria-label="Order summary">
            <h2 className="font-extrabold">{t(L, "yourOrder")}</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {v.lines.map((l) => <li key={l.product._id} className="flex justify-between gap-2"><span>{l.qty} x {l.product.name}</span><span>{money(l.lineMinor)}</span></li>)}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt>{t(L, "subtotal")}</dt><dd>{money(v.totals.subtotalMinor)}</dd></div>
              {s.feat.shipping && <div className="flex justify-between"><dt>{t(L, "shipping")}</dt><dd>{v.totals.shippingMinor === 0 ? t(L, "free") : money(v.totals.shippingMinor)}</dd></div>}
              {s.feat.tax && s.settings.taxBps > 0 && <div className="flex justify-between"><dt>{t(L, "tax")}</dt><dd>{money(v.totals.taxMinor)}</dd></div>}
              <div className="flex justify-between text-base font-extrabold"><dt>{t(L, "total")}</dt><dd>{money(v.totals.totalMinor)}</dd></div>
            </dl>
            <p className="hint mt-3">Discounts are applied when you place the order.</p>
            <Link href={`${base}/cart`} className="mt-2 block text-sm underline">{t(L, "cart")}</Link>
          </aside>
        </div>
      )}
    </div>
  );
}
