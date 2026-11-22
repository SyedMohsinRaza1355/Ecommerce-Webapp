import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icons";
import { platformDb } from "@/lib/db/client";
import { issueTenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { PACK_BY_ID } from "@/catalog/packs";
import type { InstanceRecord } from "@/lib/tenant/resolve";

export const dynamic = "force-dynamic";
export const metadata = { title: "Browse stores", description: "Shops on Storeforge. Pick one and start shopping." };

/** Public directory: only stores whose owners chose to be listed, and only active ones. */
export default async function StoresPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const term = q.trim().slice(0, 60);
  let rows: InstanceRecord[] = [];
  try {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rows = await (await platformDb()).collection<InstanceRecord>("instances")
      .find({ status: "active", listed: true, ...(term ? { name: { $regex: safe, $options: "i" } } : {}) } as never)
      .sort({ name: 1 }).limit(60).toArray();
  } catch {
    rows = []; // the directory must never break the site
  }
  const taglines = new Map<string, string>();
  await Promise.all(rows.map(async (r) => {
    try {
      const s = await (await tenantDb(issueTenantContext(r._id))).collection<{ branding?: { tagline?: string } }>("settings").findOne({ instanceId: r._id }, { projection: { branding: 1 } });
      if (s?.branding?.tagline) taglines.set(r._id, s.branding.tagline);
    } catch { /* a store without settings just shows no tagline */ }
  }));
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between gap-3">
        <Link href="/" aria-label="Storeforge home"><Logo /></Link>
        <Link href="/signin" className="btn btn-secondary">Store owner sign in</Link>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">Browse stores</h1>
      <p className="mt-1 text-muted">Pick a shop to start. You can order as a guest or create an account in each shop.</p>
      <form method="get" role="search" className="mt-5 flex max-w-md gap-2">
        <label className="sr-only" htmlFor="q">Search stores</label>
        <input id="q" name="q" className="input" placeholder="Search by name" defaultValue={term} maxLength={60} />
        <button className="btn btn-primary">Search</button>
      </form>
      {rows.length === 0 ? (
        <div className="card mt-8 text-center text-muted">{term ? "No stores match that name." : "No stores are listed yet. Store owners can choose to appear here in their Settings."}</div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r._id}>
              <Link href={`/s/${r.subdomain}`} className="card hover-lift block h-full">
                <span className="icon-chip">{Icon.store}</span>
                <span className="mt-3 block text-lg font-extrabold">{r.name}</span>
                {r.industryPack && PACK_BY_ID.get(r.industryPack) && <span className="badge badge-indigo mt-1">{PACK_BY_ID.get(r.industryPack)!.name}</span>}
                {taglines.get(r._id) && <span className="mt-2 block text-sm text-muted">{taglines.get(r._id)}</span>}
                <span className="mt-3 block text-sm font-semibold underline">Visit shop</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
