import Link from "next/link";
import { requireStaff } from "@/lib/commerce/load";
import { authorize } from "@/lib/auth/rbac";
import { orders } from "@/lib/commerce/orders";
import { products } from "@/lib/commerce/store";
import { fmtMoney, fmtDate } from "@/lib/i18n";
import { hoursAgo } from "@/lib/time";
import { Icon } from "@/components/Icons";

export const metadata = { title: "Dashboard" };

export default async function AdminHome({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ denied?: string }> }) {
  const { sub } = await params;
  const { denied } = await searchParams;
  const { store, staff } = await requireStaff(sub);
  const ctx = store.ctx;
  const b = `/s/${sub}/admin`;
  const canReports = authorize(staff.actor, "reports.view", ctx).allow;
  const canOrders = authorize(staff.actor, "orders.updateStatus", ctx).allow;
  const cur = store.settings.currency;

  const [ocol, pcol] = await Promise.all([orders.collection(ctx), products.collection(ctx)]);
  const since = hoursAgo(24);
  const [todayCount, open, revenueAgg, recent, low, publishedCount, totalProducts] = await Promise.all([
    canOrders ? ocol.countDocuments(orders.scope(ctx, { createdAt: { $gte: since } } as never)) : 0,
    canOrders ? ocol.countDocuments(orders.scope(ctx, { state: { $in: ["pending", "confirmed", "processing"] } } as never)) : 0,
    canReports ? ocol.aggregate([{ $match: orders.scope(ctx, { "payment.state": { $in: ["captured", "partially_refunded"] } } as never) }, { $group: { _id: null, gross: { $sum: "$totalMinor" }, refunded: { $sum: "$payment.refundedMinor" }, n: { $sum: 1 } } }]).toArray() : [],
    canOrders ? ocol.find(orders.scope(ctx, {})).sort({ createdAt: -1 }).limit(5).toArray() : [],
    pcol.find(products.scope(ctx, { trackStock: true, status: "published", stock: { $lte: 5 } } as never)).sort({ stock: 1 }).limit(5).toArray(),
    pcol.countDocuments(products.scope(ctx, { status: "published" } as never)),
    pcol.countDocuments(products.scope(ctx, {})),
  ]);
  const rev = revenueAgg[0] as { gross: number; refunded: number; n: number } | undefined;
  const net = rev ? rev.gross - rev.refunded : 0;

  // launch readiness (ST-19): the few things that must be true before announcing the store
  const checklist = [
    ["Accept payments", store.feat.card || store.feat.cod, `${b}/features`],
    ["Set up shipping", !store.feat.shipping || store.settings.shippingFlatMinor > 0 || store.settings.freeShippingOverMinor !== null, `${b}/settings`],
    ["Publish at least one product", publishedCount > 0, `${b}/products/new`],
    ["Name your store and add contact details", Boolean(store.settings.branding.storeName) && Boolean(store.settings.contactEmail), `${b}/settings`],
  ] as const;
  const done = checklist.filter((c) => c[1]).length;

  return (
    <div>
      {denied && <p role="alert" className="err pop-in mb-4 rounded-xl bg-red-50 p-3">You do not have access to that page.</p>}
      <h1 className="reveal text-2xl font-extrabold tracking-tight">Dashboard</h1>
      <p className="reveal reveal-1 text-muted">Signed in as {staff.actor.role.replace("_", " ")}.</p>

      {done < checklist.length && (
        <section className="card reveal reveal-2 mt-5" aria-labelledby="ready">
          <div className="flex items-center justify-between">
            <h2 id="ready" className="font-extrabold">Get ready to launch</h2>
            <span className="badge badge-indigo">{done} of {checklist.length}</span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-slate-200" aria-hidden="true"><div className="h-2 rounded-full transition-all" style={{ width: `${(done / checklist.length) * 100}%`, background: "var(--grad)" }} /></div>
          <ul className="mt-4 space-y-2 text-sm">
            {checklist.map(([label, ok, href]) => (
              <li key={label} className="flex items-center gap-2">
                <span className={ok ? "text-emerald-600" : "text-slate-300"}>{Icon.check}</span>
                {ok ? <span className="text-muted line-through">{label}</span> : <Link className="underline" href={href}>{label}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {canOrders && <Stat i={0} label="Orders (24 h)" value={String(todayCount)} icon={Icon.cart} />}
        {canOrders && <Stat i={1} label="Open orders" value={String(open)} icon={Icon.list} />}
        {canReports && <Stat i={2} label="Net sales" value={fmtMoney(net, cur, "en")} icon={Icon.tag} />}
        <Stat i={3} label="Products live" value={`${publishedCount} / ${totalProducts}`} icon={Icon.box} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {canOrders && (
          <section className="card reveal reveal-3" aria-labelledby="ro">
            <h2 id="ro" className="font-extrabold">Recent orders</h2>
            {recent.length === 0 ? <p className="mt-3 text-sm text-muted">No orders yet. They will appear here.</p> : (
              <ul className="mt-3 divide-y divide-line text-sm">
                {recent.map((o) => (
                  <li key={o._id} className="flex items-center justify-between gap-3 py-2">
                    <Link className="font-semibold hover:underline" href={`${b}/orders/${o._id}`}>#{o.orderNo}</Link>
                    <span className="text-xs text-muted">{fmtDate(o.createdAt, "en")}</span>
                    <span className="badge badge-slate">{o.state}</span>
                    <span>{fmtMoney(o.totalMinor, o.currency, "en")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className="card reveal reveal-4" aria-labelledby="ls">
          <h2 id="ls" className="font-extrabold">Low stock</h2>
          {low.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing is running low.</p> : (
            <ul className="mt-3 divide-y divide-line text-sm">
              {low.map((p) => (
                <li key={p._id} className="flex justify-between py-2"><Link className="hover:underline" href={`${b}/products/${p._id}`}>{p.name}</Link><span className={p.stock === 0 ? "badge badge-red" : "badge badge-amber"}>{p.stock} left</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, i }: { label: string; value: string; icon: React.ReactNode; i: number }) {
  return (
    <div className={`card hover-lift reveal reveal-${i + 1}`}>
      <span className="icon-chip">{icon}</span>
      <p className="mt-3 text-sm text-muted">{label}</p>
      <p className="text-2xl font-extrabold">{value}</p>
    </div>
  );
}
