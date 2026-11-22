import { recordFunnel, saveCartSnapshot } from "@/lib/commerce/growth";
import { balancesOf, loyaltyOf } from "@/lib/commerce/rewards";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { loadStore } from "@/lib/commerce/load";
import { cartView } from "@/lib/commerce/cart";
import { pricingConfig } from "@/lib/commerce/features";
import { fmtMoney, t } from "@/lib/i18n";
import { placeOrderAction } from "../actions";
import { getPaymentConfig, checkoutMethods } from "@/lib/payments/config";
import { currentCustomer } from "@/lib/commerce/customers";
import CheckoutForm from "./CheckoutForm";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  const L = s.locale;
  const base = `/s/${sub}`;
  const cartId = (await cookies()).get(`cart_${s.instance._id}`)?.value;
  const v = await cartView(s.ctx, cartId, pricingConfig(s.settings, s.feat), s.feat.stockTracking, { autoPromos: s.feat.autoPromos, flashSales: s.feat.flashSales, bxgy: s.feat.bxgy, weightTiers: s.feat.weight ? s.settings.weightTiers : undefined, backorders: s.feat.backorders });
  if (v.lines.length === 0 || v.hasProblems) redirect(`${base}/cart`);
  const money = (n: number) => fmtMoney(n, s.settings.currency, L);
  const methods = checkoutMethods(await getPaymentConfig(s.ctx), s.feat, { card: t(L, "payCard"), cod: t(L, "payCod") });
  const canPay = methods.length > 0;
  const me = s.eff.get("F-045")?.enabled ? await currentCustomer(s) : null;
  const defAddr = me?.addresses?.[0];
  const bal = me && (s.feat.credit || s.feat.loyalty) ? await balancesOf(s.ctx, me._id) : null;
  const pm = loyaltyOf(s.settings).pointMinor;
  const rewardsUi = s.feat.giftCards || (bal && (bal.creditMinor > 0 || bal.points > 0))
    ? { gift: Boolean(s.feat.giftCards), ...(bal && s.feat.credit && bal.creditMinor > 0 ? { credit: money(bal.creditMinor) } : {}), ...(bal && s.feat.loyalty && bal.points > 0 ? { points: { count: bal.points, value: money(bal.points * pm) } } : {}) }
    : undefined;
  if (s.eff.get("F-141")?.enabled === true) await recordFunnel(s.ctx, "checkout");
  if (me && cartId && s.eff.get("F-060")?.enabled === true) await saveCartSnapshot(s.ctx, me.email, cartId);
  const table = (await cookies()).get(`tbl_${s.instance._id}`)?.value;
  const ful = s.settings.fulfilment ?? {};
  const types = (s.feat.orderTypes
    ? ([ful.delivery !== false ? "delivery" : null, s.feat.pickup && ful.pickup ? "pickup" : null, s.feat.tableQr && ful.dineIn ? "dine_in" : null].filter(Boolean) as ("delivery" | "pickup" | "dine_in")[])
    : []);

  return (
    <div className="max-md:pb-24">
      <h1 className="text-3xl font-extrabold tracking-tight">{t(L, "checkout")}</h1>
      {!canPay ? (
        <div className="card mt-6 text-center"><p>Ordering is not available right now. Please contact the store.</p></div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
          <CheckoutForm
            action={placeOrderAction.bind(null, sub)}
            idem={randomUUID()}
            methods={methods}
            prefill={me ? { name: me.name, email: me.email, phone: me.phone ?? defAddr?.phone ?? "", address: defAddr?.address ?? "", city: defAddr?.city ?? "" } : undefined}
            discounts={s.feat.discounts}
            rewards={rewardsUi}
            total={money(v.totals.totalMinor)}
            fulfil={types.length > 1 || s.feat.scheduled ? { types: types.length ? types : ["delivery"], locations: s.settings.locations ?? [], scheduling: Boolean(s.feat.scheduled), defaultType: table && types.includes("dine_in") ? "dine_in" : types[0] ?? "delivery", table } : undefined}
            labels={{ contact: t(L, "contact"), fullName: t(L, "fullName"), email: t(L, "email"), phone: t(L, "phone"), address: t(L, "address"), city: t(L, "city"), notes: t(L, "notes"), payment: t(L, "payment"), discountCode: t(L, "discountCode"), placeOrder: t(L, "placeOrder") }}
          />
          <aside className="card h-fit" aria-label="Order summary">
            <h2 className="font-extrabold">{t(L, "yourOrder")}</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {v.lines.map((l) => <li key={l.product._id} className="flex justify-between gap-2"><span>{l.qty} x {l.product.name}</span><span>{money(l.lineMinor)}</span></li>)}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt>{t(L, "subtotal")}</dt><dd>{money(v.totals.subtotalMinor)}</dd></div>
              {v.promo && <div className="flex justify-between text-emerald-700"><dt>{v.promo.promo.name}</dt><dd>-{money(v.totals.discountMinor)}</dd></div>}
              {s.feat.shipping && <div className="flex justify-between"><dt>{t(L, "shipping")}</dt><dd>{v.totals.shippingMinor === 0 ? t(L, "free") : money(v.totals.shippingMinor)}</dd></div>}
              {s.feat.tax && s.settings.taxBps > 0 && <div className="flex justify-between"><dt>{t(L, "tax")}</dt><dd>{money(v.totals.taxMinor)}</dd></div>}
              <div className="flex justify-between text-base font-extrabold"><dt>{t(L, "total")}</dt><dd>{money(v.totals.totalMinor)}</dd></div>
            </dl>
            <p className="hint mt-3">Discount codes are applied when you place the order.{s.feat.zones && (s.settings.zones?.length ?? 0) > 0 ? " The delivery fee depends on your city and is final when you place the order." : ""}</p>
            <Link href={`${base}/cart`} className="mt-2 block text-sm underline">{t(L, "cart")}</Link>
          </aside>
        </div>
      )}
    </div>
  );
}
