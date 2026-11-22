import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { loadStore } from "@/lib/commerce/load";
import { getCartItems } from "@/lib/commerce/cart";
import { currentCustomer } from "@/lib/commerce/customers";
import { t } from "@/lib/i18n";
import { Icon } from "@/components/Icons";
import { CookieNotice } from "@/components/store/Bits";
import { RegisterSW } from "@/components/store/RegisterSW";
import { setLocaleAction } from "./actions";

export default async function ShopLayout({ children, params }: { children: ReactNode; params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const store = await loadStore(sub);
  if (store.status !== "ok") return null;
  const L = store.locale;
  const name = store.settings.branding.storeName || store.instance.name;
  const items = await getCartItems(store.ctx, (await cookies()).get(`cart_${store.instance._id}`)?.value);
  const accountsOn = store.eff.get("F-045")?.enabled !== false;
  const me = accountsOn ? await currentCustomer(store) : null;
  const count = items.reduce((n, i) => n + i.qty, 0);
  const base = `/s/${sub}`;
  const showMaintenance = store.eff.get("F-110")?.enabled;
  const bilingual = store.eff.get("F-085")?.enabled !== false && store.eff.get("F-086")?.enabled !== false;

  return (
    <>
      <a href="#main" className="skip-link">{t(L, "skip")}</a>
      <header className="glass sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href={base} className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            {store.settings.branding.logoUrl && store.eff.get("F-073")?.enabled !== false ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={store.settings.branding.logoUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-lg object-cover" />
            ) : (
              <span className="icon-chip !h-8 !w-8 !rounded-lg">{Icon.store}</span>
            )}
            {name}
          </Link>
          <form action={`${base}/products`} method="get" role="search" className="order-last flex min-w-0 grow basis-full gap-2 sm:order-none sm:basis-auto sm:max-w-sm">
            <label className="sr-only" htmlFor="q">{t(L, "search")}</label>
            <input id="q" name="q" className="input" placeholder={t(L, "searchPlaceholder")} maxLength={60} />
            <button className="btn btn-secondary" aria-label={t(L, "search")}>{t(L, "search")}</button>
          </form>
          <nav className="ms-auto flex items-center gap-2" aria-label="Main">
            <Link href={`${base}/products`} className="btn btn-secondary hidden sm:inline-flex">{t(L, "shop")}</Link>
            {bilingual && (
              <form action={setLocaleAction.bind(null, sub)}>
                <input type="hidden" name="locale" value={L === "en" ? "ur" : "en"} />
                <button className="btn btn-secondary" lang={L === "en" ? "ur" : "en"} title={t(L, "language")}>{L === "en" ? "اردو" : "English"}</button>
              </form>
            )}
            {accountsOn && <Link href={`${base}/account${me ? "" : "/login"}`} className="btn btn-secondary">{me ? t(L, "myAccount") : t(L, "signIn")}</Link>}
            <Link href={`${base}/cart`} className="btn btn-primary" aria-label={`${t(L, "cart")} (${count})`}>
              {Icon.cart}
              <span>{t(L, "cart")}</span>
              {count > 0 && <span className="rounded-full bg-white/25 px-2 text-xs">{count}</span>}
            </Link>
          </nav>
        </div>
      </header>
      {showMaintenance && <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">This store is in maintenance mode. Browsing works, but ordering may be limited.</div>}
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="border-t border-line bg-white py-8 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4">
          <p>&copy; {new Date().getFullYear()} {name}</p>
          <p className="flex gap-4">
            <Link href="/privacy" className="underline">{t(L, "privacy")}</Link>
            <Link href="/terms" className="underline">{t(L, "terms")}</Link>
            <Link href={`${base}/admin/login`} className="underline">{t(L, "adminArea")}</Link>
          </p>
          <p>{t(L, "poweredBy")}</p>
        </div>
      </footer>
      <nav aria-label="Quick links" className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line md:hidden">
        <Link href={base} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold">{Icon.home}{t(L, "home")}</Link>
        <Link href={`${base}/products`} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold">{Icon.list}{t(L, "shop")}</Link>
        <Link href={`${base}/cart`} className="relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold">
          {Icon.cart}{t(L, "cart")}
          {count > 0 && <span className="absolute end-1/4 top-1 rounded-full px-1.5 text-[10px] font-bold" style={{ background: "var(--brand-primary)", color: "var(--brand-on-primary)" }}>{count}</span>}
        </Link>
      </nav>
      <div className="h-16 md:hidden" aria-hidden="true" />
      <CookieNotice text={t(L, "cookieNotice")} ok={t(L, "ok")} />
      {store.eff.get("F-137")?.enabled !== false && <RegisterSW sub={sub} />}
    </>
  );
}
