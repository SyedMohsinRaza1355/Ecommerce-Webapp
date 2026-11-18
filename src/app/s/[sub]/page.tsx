import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePreview } from "@/lib/tenant/resolve";
import { getEffectiveToggles } from "@/lib/toggles/service";
import { TOGGLES } from "@/lib/toggles/catalog";
import { PACK_BY_ID } from "@/catalog/packs";
import { Icon } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function StorePreview({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const r = await resolvePreview(sub);
  if (r.type === "not_found" || r.type === "platform") notFound();
  if (r.type === "suspended") {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
        <div className="icon-chip pop-in">{Icon.lock}</div>
        <h1 className="mt-5 text-2xl font-bold">{r.name} is temporarily unavailable</h1>
        <p className="mt-3 text-muted">This store has been suspended. If you own it, please contact billing support.</p>
      </main>
    );
  }

  const eff = await getEffectiveToggles(r.instance);
  const on = TOGGLES.filter((t) => eff.get(t.id)?.enabled);
  const pack = r.instance.industryPack ? PACK_BY_ID.get(r.instance.industryPack) : undefined;

  return (
    <div>
      <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
        Preview of <strong>{r.instance.name}</strong> on the platform address. On a real domain it appears at {r.instance.subdomain}.your-domain.
      </div>
      <header className="hero-bg">
        <div className="hero-grid" aria-hidden="true" />
        <div className="relative mx-auto max-w-5xl px-4 py-16 text-center">
          <h1 className="reveal text-4xl font-extrabold sm:text-5xl">{r.instance.name}</h1>
          <p className="reveal reveal-1 mt-3 text-slate-300">{pack?.name ?? "Online store"}</p>
          <p className="reveal reveal-2 mt-6 inline-block rounded-full bg-white/10 px-4 py-1 text-sm ring-1 ring-white/20">Storefront opens in an upcoming step</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">
        {pack && (
          <section aria-labelledby="cats">
            <h2 id="cats" className="text-xl font-bold">Categories</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {pack.categories.map((c, i) => (
                <div key={c} className={`card hover-lift reveal reveal-${(i % 6) + 1} text-center`}>
                  <span className="icon-chip mx-auto">{Icon.box}</span>
                  <p className="mt-3 text-sm font-semibold">{c}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        <section className="mt-10" aria-labelledby="feat">
          <h2 id="feat" className="text-xl font-bold">Features enabled for this store ({on.length})</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {on.map((t) => <span key={t.id} className="badge badge-indigo">{t.name}</span>)}
          </div>
        </section>
        <p className="mt-10 text-sm"><Link className="underline" href="/">Back to platform</Link></p>
      </main>
    </div>
  );
}
