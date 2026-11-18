import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveRequestTenant } from "@/lib/tenant/resolve";
import { getEffectiveToggles } from "@/lib/toggles/service";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

const FEATURES = [
  ["Launch in minutes", "Pick an industry pack, add your logo and products, and your store is live on its own web address."],
  ["145 switchable features", "Turn on only what your business needs: variants, bundles, kitchen display, subscriptions and more."],
  ["Your data stays yours", "Every store has its own isolated database. No store can ever see another store's data."],
  ["English and Urdu", "Full right-to-left Urdu support across the storefront and the admin."],
  ["Built for mobile", "Fast, installable, thumb-friendly stores that convert on phones."],
  ["Safe by default", "Card data never touches our servers. Every admin action is audited."],
];

const PLANS = [
  ["Starter", "For a small shop getting started", ["Core catalog and checkout", "1 staff seat", "Subdomain included"]],
  ["Growth", "For growing stores", ["Everything in Starter", "Promotions and reports", "5 staff seats", "Custom domain"]],
  ["Pro", "For multi-location businesses", ["Everything in Growth", "Kitchen display and inventory locations", "Webhooks and API", "Priority support"]],
];

export default async function Home() {
  const r = await resolveRequestTenant();

  if (r.type === "not_found") notFound();

  if (r.type === "suspended") {
    return (
      <main className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-2xl font-bold">{r.name} is temporarily unavailable</h1>
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
        <p className="mt-3 text-muted">Storefront coming in the next slice. This store resolves from its own address.</p>
        <p className="mt-2 text-sm">{on} of {eff.size} features enabled.</p>
      </main>
    );
  }

  return (
    <div>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo />
          <nav className="flex items-center gap-2" aria-label="Main">
            <Link href="/toggles" className="btn btn-secondary hidden sm:inline-flex">Features</Link>
            <Link href="/admin/login" className="btn btn-primary">Admin sign in</Link>
          </nav>
        </div>
      </header>

      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-24">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">An online store for any business, ready in minutes</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
            Storeforge gives every client a branded, mobile-first store with its own address, its own data and the exact features it needs.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="#plans" className="btn btn-primary">See plans</Link>
            <Link href="/toggles" className="btn btn-secondary">Explore the 145 features</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="why">
        <h2 id="why" className="text-center text-2xl font-bold">Everything a store needs</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([t, d]) => (
            <div key={t} className="card">
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="plans" className="bg-white py-14" aria-labelledby="plans-h">
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="plans-h" className="text-center text-2xl font-bold">Plans</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PLANS.map(([n, d, items]) => (
              <div key={n as string} className="card">
                <h3 className="text-lg font-bold">{n as string}</h3>
                <p className="text-sm text-muted">{d as string}</p>
                <ul className="mt-4 space-y-1 text-sm">
                  {(items as string[]).map((i) => <li key={i}>- {i}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-muted">Stores are currently created by our team. Self-service signup arrives with payments.</p>
        </div>
      </section>

      <footer className="border-t border-line py-6 text-center text-sm text-muted">Storeforge platform preview</footer>
    </div>
  );
}
