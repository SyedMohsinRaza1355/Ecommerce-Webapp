import { listPlans } from "@/lib/platform/plans";
import { TOGGLES } from "@/lib/toggles/catalog";

export const metadata = { title: "Plans | Storeforge Super Admin" };

export default async function PlansPage() {
  const plans = await listPlans();
  return (
    <div>
      <h1 className="reveal text-2xl font-extrabold tracking-tight">Plans</h1>
      <p className="reveal reveal-1 mt-1 text-muted">What each plan includes. Prices and limits are business decisions; editing arrives in the next step.</p>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {plans.map((p, i) => (
          <div key={p._id} className={`card hover-lift reveal reveal-${i + 1}`}>
            <h2 className="text-xl font-bold">{p.name}</h2>
            <p className="mt-3 text-3xl font-extrabold">{p.includedToggles.length}<span className="text-base font-medium text-muted"> / {TOGGLES.length} features</span></p>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Staff seats</dt><dd className="font-semibold">{p.quotas.staffSeats}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Products</dt><dd className="font-semibold">{p.quotas.skus.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Storage</dt><dd className="font-semibold">{(p.quotas.storageMb / 1000).toLocaleString()} GB</dd></div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
