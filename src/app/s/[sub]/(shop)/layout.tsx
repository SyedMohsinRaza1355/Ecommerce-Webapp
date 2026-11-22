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
import { ToastHost } from "@/components/store/Toast";
import { setLocaleAction, newsletterAction } from "./actions";
import { listPages } from "@/lib/commerce/extras";
import { hasHours, isOpenNow } from "@/lib/commerce/rules";
import AcctForm from "@/components/store/AcctForm";

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
  const footerPages = store.eff.get("F-078")?.enabled !== false && store.eff.get("F-081")?.enabled !== false ? (await listPages(store.ctx, true, "page")).filter((p) => p.inFooter) : [];
  const blogOn = store.eff.get("F-079")?.enabled === true && store.eff.get("F-078")?.enabled !== false && (await listPages(store.ctx, true, "post")).length > 0;
  const newsletterOn = store.eff.get("F-058")?.enabled === true;
  const contactOn = store.eff.get("F-080")?.enabled !== false;
  const hoursOn = store.eff.get("F-018")?.enabled !== false && hasHours(store.settings.hours);
  const closedNow = hoursOn && !isOpenNow(store.settings.hours);
  const showMaintenance = store.eff.get("F-110")?.enabled;
  const bilingual = store.eff.get("F-085")?.enabled !== false && store.eff.get("F-086")?.enabled !== false;

  return (
    <>
      <a href="#main" className="skip-link">{t(L, "skip")}</a>
      <header className="glass sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:py-3">
          <Link href={base} className="flex min-w-0 items-center gap-2 text-lg font-extrabold tracking-tight">
            {store.settings.branding.logoUrl && store.eff.get("F-073")?.enabled !== false ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={store.settings.branding.logoUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-lg object-cover" />
            ) : (
              <span className="icon-chip !h-8 !w-8 !rounded-lg">{Icon.store}</span>
            )}
            <span className="truncate">{name}</span>
          </Link>
          <form action={`${base}/products`} method="get" role="search" className="order-last flex min-w-0 grow basis-full gap-2 sm:order-none sm:basis-auto sm:max-w-sm" >
            <label className="sr-only" htmlFor="q">{t(L, "search")}</label>
            <input id="q" name="q" className="input" placeholder={t(L, "searchPlaceholder")} maxLength={60} />
            <button className="btn btn-secondary" aria-label={t(L, "search")}>{Icon.search ?? t(L, "search")}<span className="max-sm:sr-only">{t(L, "search")}</span></button>
          </form>
          <nav className="ms-auto flex items-center gap-2" aria-label="Main">
            <Link href={`${base}/products`} className="btn btn-secondary hidden sm:inline-flex">{t(L, "shop")}</Link>
            {bilingual && (
              <form action={setLocaleAction.bind(null, sub)}>
                <input type="hidden" name="locale" value={L === "en" ? "ur" : "en"} />
                <button className="btn btn-secondary" lang={L === "en" ? "ur" : "en"} title={t(L, "language")}>{L === "en" ? "اردو" : "English"}</button>
              </form>
            )}
            {accountsOn && <Link href={`${base}/account${me ? "" : "/login"}`} className="btn btn-secondary hidden whitespace-nowrap sm:inline-flex">{me ? t(L, "myAccount") : t(L, "signIn")}</Link>}
            <Link href={`${base}/cart`} className="btn btn-primary" aria-label={`${t(L, "cart")} (${count})`}>
              {Icon.cart}
              <span className="max-sm:sr-only">{t(L, "cart")}</span>
              {count > 0 && <span className="rounded-full bg-white/25 px-2 text-xs">{count}</span>}
            </Link>
          </nav>
        </div>
      </header>
      {store.settings.announcement && store.eff.get("F-061")?.enabled !== false && <div role="status" className="px-4 py-2 text-center text-sm font-semibold" style={{ background: "var(--brand-primary)", color: "var(--brand-on-primary)" }}>{store.settings.announcement}</div>}
      {closedNow && <div role="status" className="bg-slate-800 px-4 py-2 text-center text-sm text-white">We are closed right now. You can look around, but orders open again during our opening hours.</div>}
      {showMaintenance && <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">This store is in maintenance mode. You can browse, but ordering is paused for now.</div>}
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="border-t border-line bg-white py-8 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4">
          <p>&copy; {new Date().getFullYear()} {name}</p>
          <p className="flex flex-wrap gap-4">
            {footerPages.map((p) => <Link key={p._id} href={`${base}/p/${p.slug}`} className="underline">{p.title}</Link>)}
            {blogOn && <Link href={`${base}/blog`} className="underline">Blog</Link>}
            {contactOn && <Link href={`${base}/contact`} className="underline">Contact</Link>}
            <Link href="/privacy" className="underline">{t(L, "privacy")}</Link>
            <Link href="/terms" className="underline">{t(L, "terms")}</Link>
            <Link href={`${base}/admin/login`} className="underline">{t(L, "adminArea")}</Link>
          </p>
          <p>{t(L, "poweredBy")}</p>
        </div>
        {newsletterOn && (
          <div className="mx-auto mt-6 max-w-6xl px-4">
            <h2 className="font-bold text-slate-900">Get news and offers</h2>
            <div className="mt-2 max-w-sm"><AcctForm action={newsletterAction.bind(null, sub)} submit="Subscribe" fields={[{ name: "email", label: "Email address", type: "email", autoComplete: "email", required: true, dir: "ltr" }]} /></div>
          </div>
        )}
      </footer>
      <nav aria-label="Quick links" className={`glass fixed inset-x-0 bottom-0 z-30 grid ${accountsOn ? "grid-cols-4" : "grid-cols-3"} border-t border-line md:hidden`}>
        <Link href={base} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold">{Icon.home}{t(L, "home")}</Link>
        <Link href={`${base}/products`} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold">{Icon.list}{t(L, "shop")}</Link>
        {accountsOn && <Link href={`${base}/account${me ? "" : "/login"}`} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold">{Icon.users}{me ? t(L, "myAccount") : t(L, "signIn")}</Link>}
        <Link href={`${base}/cart`} className="relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold">
          {Icon.cart}{t(L, "cart")}
          {count > 0 && <span className="absolute end-1/4 top-1 rounded-full px-1.5 text-[10px] font-bold" style={{ background: "var(--brand-primary)", color: "var(--brand-on-primary)" }}>{count}</span>}
        </Link>
      </nav>
      <div className="h-16 md:hidden" aria-hidden="true" />
      <ToastHost />
      <CookieNotice text={t(L, "cookieNotice")} ok={t(L, "ok")} />
      {store.eff.get("F-137")?.enabled !== false && <RegisterSW sub={sub} />}
    </>
  );
}
