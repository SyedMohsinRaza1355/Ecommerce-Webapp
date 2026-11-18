import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveRequestTenant } from "@/lib/tenant/resolve";
import { getEffectiveToggles } from "@/lib/toggles/service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const r = await resolveRequestTenant();

  if (r.type === "not_found") notFound();

  if (r.type === "suspended") {
    return (
      <main className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-2xl font-bold">{r.name} is temporarily unavailable</h1>
        <p className="mt-3">This store has been suspended. If you own it, please contact billing support.</p>
      </main>
    );
  }

  if (r.type === "ok") {
    const eff = await getEffectiveToggles(r.instance);
    const on = [...eff.values()].filter((e) => e.enabled).length;
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-3xl font-bold">{r.instance.name}</h1>
        <p className="mt-3">Store storefront placeholder. This store resolves from its own subdomain.</p>
        <p className="mt-2 text-sm">
          {on} of {eff.size} features are currently enabled for this store.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">Multi-Tenant Ecommerce Platform</h1>
      <p className="mt-4">Phase 1: tenant foundation is live.</p>
      <ul className="mt-6 list-disc space-y-2 pl-6">
        <li>
          <Link className="underline" href="/toggles">Feature toggle explorer</Link> (all 145 toggles, live evaluator)
        </li>
        <li>
          <Link className="underline" href="/api/health">Health check</Link> (database connectivity)
        </li>
      </ul>
    </main>
  );
}
