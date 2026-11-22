import { guard } from "@/lib/commerce/guard";
import { funnel } from "@/lib/commerce/growth";

export const metadata = { title: "Shopper funnel" };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "-");

export default async function FunnelPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "reports.view");
  const f = await funnel(store.ctx, 30);
  const on = store.eff.get("F-141")?.enabled === true;
  const steps = [
    { label: "Looked at a product", n: f.view, from: null as number | null },
    { label: "Added to cart", n: f.cart, from: f.view },
    { label: "Reached checkout", n: f.checkout, from: f.cart },
    { label: "Placed an order", n: f.orders, from: f.checkout },
  ];
  const top = Math.max(f.view, 1);
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Shopper funnel</h1>
        <p className="text-muted">The last 30 days: how many visits reach each step. These are counts of page views and actions, not people, and nothing personal is stored.</p>
      </div>
      {!on && <p className="err">Counting is switched off, so views, carts and checkouts below stay at zero. Turn on &quot;Conversion funnel and cart drop-off analytics&quot; under Features.</p>}
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.label} className="card">
            <p className="flex items-baseline justify-between"><span className="font-bold">{s.label}</span><span className="text-xl font-extrabold">{s.n}</span></p>
            <div className="mt-2 h-2 rounded-full bg-slate-200" aria-hidden="true"><div className="h-2 rounded-full" style={{ width: `${Math.min((s.n / top) * 100, 100)}%`, background: "var(--grad)" }} /></div>
            {s.from !== null && <p className="mt-1 text-xs text-muted">{pct(s.n, s.from)} of the step above continued. {s.from > s.n ? `${s.from - s.n} dropped off here.` : ""}</p>}
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted">Orders do not include cancelled ones. A large drop between cart and checkout often means shipping costs surprise people; a drop at checkout often means too many fields or too few payment choices.</p>
    </div>
  );
}
