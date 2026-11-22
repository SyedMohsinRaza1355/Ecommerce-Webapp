import { guard } from "@/lib/commerce/guard";
import { listPromos } from "@/lib/commerce/rules";
import { categories } from "@/lib/commerce/store";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import { AF, ActionButton } from "@/components/admin/Forms";
import { promoAction, promoOpAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Promotions" };

export default async function PromotionsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "promotions.manage");
  const [promos, cats] = await Promise.all([listPromos(store.ctx), categories.find(store.ctx, {}, 100)]);
  const catName = new Map(cats.map((c) => [c._id, c.name]));
  const cur = store.settings.currency;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Promotions</h1>
        <p className="text-muted">Discounts that apply by themselves in the cart, no code needed. Only the best one applies to an order, and it is used instead of a discount code when it saves the customer more.</p>
      </div>

      <section className="card" aria-labelledby="np">
        <h2 id="np" className="text-lg font-extrabold">New promotion</h2>
        <AF action={promoAction.bind(null, sub)} submit="Create promotion" className="mt-3">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <label className="field"><span>Name shown to customers</span><input className="input" name="name" required maxLength={60} placeholder="Weekend sale" /></label>
            <label className="field"><span>Type</span>
              <select className="input" name="kind" defaultValue="flash"><option value="flash">Flash sale (limited time, whole store or one category)</option><option value="auto">Basket discount (when the basket reaches an amount)</option></select>
            </label>
            <label className="field"><span>Percent off</span><input className="input" name="percent" inputMode="decimal" required placeholder="15" dir="ltr" /></label>
            <label className="field"><span>Basket discount: minimum basket ({cur})</span><input className="input" name="min" inputMode="decimal" placeholder="2000" dir="ltr" /></label>
            <label className="field"><span>Flash sale: only this category</span>
              <select className="input" name="categoryId" defaultValue=""><option value="">Whole store</option>{cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
            </label>
            <span />
            <label className="field"><span>Starts (optional)</span><input className="input" type="datetime-local" name="startsAt" /></label>
            <label className="field"><span>Ends (needed for flash sales)</span><input className="input" type="datetime-local" name="endsAt" /></label>
          </div>
        </AF>
      </section>

      <section className="card overflow-x-auto p-0" aria-label="Your promotions">
        <table className="table">
          <thead><tr><th>Promotion</th><th>Discount</th><th>When</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {promos.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted">No promotions yet.</td></tr>}
            {promos.map((p) => {
              const now = new Date();
              const live = p.active && (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt > now);
              return (
                <tr key={p._id}>
                  <td className="font-semibold">{p.name}<p className="text-xs font-normal text-muted">{p.kind === "flash" ? `Flash sale${p.categoryId ? `: ${catName.get(p.categoryId) ?? "category"}` : ": whole store"}` : `Basket over ${fmtMoney(p.minSubtotalMinor, cur, "en")}`}</p></td>
                  <td>{p.percentBps / 100}%</td>
                  <td className="text-xs">{p.startsAt ? fmtDate(p.startsAt, "en") : "Now"} to {p.endsAt ? fmtDate(p.endsAt, "en") : "no end"}</td>
                  <td><span className={`badge ${live ? "badge-green" : "badge-slate"}`}>{live ? "Running" : p.active ? "Scheduled or ended" : "Off"}</span></td>
                  <td className="text-end"><span className="flex justify-end gap-2">
                    <ActionButton label={p.active ? "Turn off" : "Turn on"} run={promoOpAction.bind(null, sub, p._id, p.active ? "off" : "on")} />
                    <ActionButton label="Delete" danger confirmText="Delete this promotion?" run={promoOpAction.bind(null, sub, p._id, "delete")} />
                  </span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
