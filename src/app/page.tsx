import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveRequestTenant } from "@/lib/tenant/resolve";
import { getEffectiveToggles } from "@/lib/toggles/service";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icons";

export const dynamic = "force-dynamic";

const FEATURES = [
  [Icon.rocket, "Launch in minutes", "Pick an industry pack, add your logo and products, and your store goes live on its own web address."],
  [Icon.switch, "145 switchable features", "Turn on only what your business needs: variants, bundles, kitchen display, subscriptions and more."],
  [Icon.shield, "Your data stays yours", "Every store has its own isolated database. No store can ever see another store's data."],
  [Icon.globe, "English and Urdu", "Full right-to-left Urdu support across the storefront and the admin."],
  [Icon.phone, "Built for mobile", "Fast, installable, thumb-friendly stores that convert on phones."],
  [Icon.lock, "Safe by default", "Card data never touches our servers. Every admin action is audited."],
] as const;

const PLANS = [
  ["Starter", "For a small shop getting started", ["Core catalog and checkout", "1 staff seat", "Subdomain included"], false],
  ["Growth", "For growing stores", ["Everything in Starter", "Promotions and reports", "5 staff seats", "Custom domain"], true],
  ["Pro", "For multi-location businesses", ["Everything in Growth", "Kitchen display and locations", "Webhooks and API", "Priority support"], false],
] as const;

const PACKS = ["Restaurant", "Fashion", "Grocery", "Electronics", "Bookings", "Digital goods", "Pharmacy", "Wholesale"];

export default async function Home() {
  const r = await resolveRequestTenant();

  if (r.type === "not_found") notFound();

  if (r.type === "suspended") {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
        <div className="icon-chip pop-in">{Icon.lock}</div>
        <h1 className="mt-5 text-2xl font-bold">{r.name} is temporarily unavailable</h1>
        <p className="mt-3 text-muted">This store has been suspended. If you own it, please contact billing support.</p>
      </main>
    );
  }

  if (r.type === "ok") {
    const eff = await getEffectiveToggles(r.instance);
    const on = [...eff.values()].filter((e) => e.enabled).length;
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-3xl font-bold">{r.instance.name}</h1>
        <p className="mt-3 text-muted">Storefront coming in an upcoming step.</p>
        <p className="mt-2 text-sm">{on} of {eff.size} features enabled.</p>
      </main>
    );
  }

  return (
    <div>
      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo />
          <nav className="flex items-center gap-2" aria-label="Main">
            <Link href="#features" className="btn btn-secondary hidden sm:inline-flex">Features</Link>
            <Link href="#plans" className="btn btn-secondary hidden sm:inline-flex">Plans</Link>
            <Link href="/admin/login" className="btn btn-primary">Admin sign in</Link>
          </nav>
        </div>
      </header>

      <section className="hero-bg">
        <div className="hero-grid" aria-hidden="true" />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
          <span className="reveal reveal-1 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm text-indigo-100 ring-1 ring-white/20">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Multi-tenant commerce platform
          </span>
          <h1 className="reveal reveal-2 mt-6 text-4xl font-extrabold tracking-tight sm:text-6xl">
            An online store for <span className="gradient-text">any business</span>, ready in minutes
          </h1>
          <p className="reveal reveal-3 mx-auto mt-6 max-w-2xl text-lg text-slate-300">
            Storeforge gives every client a branded, mobile-first store with its own address, its own data and exactly the features it needs.
          </p>
          <div className="reveal reveal-4 mt-9 flex flex-wrap justify-center gap-3">
            <Link href="#plans" className="btn btn-primary">See plans</Link>
            <Link href="/toggles" className="btn border-white/25 bg-white/10 text-white hover:bg-white/20">Explore the 145 features</Link>
          </div>
          <div className="reveal reveal-5 mt-12 flex flex-wrap justify-center gap-2">
            {PACKS.map((p) => (
              <span key={p} className="rounded-full bg-white/10 px-3 py-1 text-sm text-slate-200 ring-1 ring-white/15">{p}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16" id="features" aria-labelledby="why">
        <h2 id="why" className="reveal text-center text-3xl font-extrabold tracking-tight">Everything a store needs</h2>
        <p className="reveal reveal-1 mx-auto mt-2 max-w-xl text-center text-muted">One platform, built carefully for safety, speed and flexibility.</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([icon, t, d], i) => (
            <div key={t} className={`card hover-lift reveal reveal-${(i % 6) + 1}`}>
              <span className="icon-chip">{icon}</span>
              <h3 className="mt-4 text-lg font-bold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="plans" className="bg-white py-16" aria-labelledby="plans-h">
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="plans-h" className="text-center text-3xl font-extrabold tracking-tight">Simple plans</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {PLANS.map(([n, d, items, hot], i) => (
              <div key={n} className={`card hover-lift reveal reveal-${i + 1} ${hot ? "ring-2 ring-indigo-400" : ""}`}>
                {hot && <span className="badge badge-indigo mb-2">Most popular</span>}
                <h3 className="text-xl font-bold">{n}</h3>
                <p className="text-sm text-muted">{d}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {items.map((it) => (
                    <li key={it} className="flex items-center gap-2"><span className="text-emerald-600">{Icon.check}</span>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-muted">Stores are currently created by our team. Self-service signup arrives with online payments.</p>
        </div>
      </section>

      <footer className="border-t border-line bg-white py-8 text-center text-sm text-muted">
        <Logo /> <span className="ms-2">Platform preview</span>
      </footer>
    </div>
  );
}
