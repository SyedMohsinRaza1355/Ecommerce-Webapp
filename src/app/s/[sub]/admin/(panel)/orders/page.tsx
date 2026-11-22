import Link from "next/link";
import { guard } from "@/lib/commerce/guard";
import { orders, expireUnpaidOrders } from "@/lib/commerce/orders";
import { ORDER_STATES } from "@/lib/commerce/states";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import { Icon } from "@/components/Icons";
import { ago, olderThan } from "@/lib/time";

export const metadata = { title: "Orders" };

const BADGE: Record<string, string> = { pending: "badge-amber", confirmed: "badge-indigo", processing: "badge-indigo", ready: "badge-green", fulfilled: "badge-green", completed: "badge-green", cancelled: "badge-red" };

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ state?: string; q?: string }> }) {
  const { sub } = await params;
  const sp = await searchParams;
  const { store } = await guard(sub, "orders.updateStatus");
  await expireUnpaidOrders(store.ctx).catch(() => 0); // give stock back for abandoned card orders
  const filter: Record<string, unknown> = {};
  if ((ORDER_STATES as readonly string[]).includes(sp.state ?? "")) filter.state = sp.state;
  const q = (sp.q ?? "").trim().slice(0, 80);
  if (q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const n = parseInt(q.replace("#", ""), 10);
    filter.$or = [{ "customer.email": { $regex: safe, $options: "i" } }, { "customer.name": { $regex: safe, $options: "i" } }, ...(Number.isFinite(n) ? [{ orderNo: n }] : [])];
  }
  const col = await orders.collection(store.ctx);
  const rows = await col.find(orders.scope(store.ctx, filter as never)).sort({ createdAt: -1 }).limit(100).toArray();
  const counts = new Map((await col.aggregate<{ _id: string; n: number }>([{ $match: orders.scope(store.ctx, {}) }, { $group: { _id: "$state", n: { $sum: 1 } } }]).toArray()).map((c) => [c._id, c.n]));
  const total = [...counts.values()].reduce((a, c) => a + c, 0);
  const payBadge: Record<string, string> = { captured: "badge-green", cod_due: "badge-slate", requires_payment: "badge-amber", failed: "badge-red", partially_refunded: "badge-amber", refunded: "badge-slate" };
  const b = `/s/${sub}/admin/orders`;
  return (
    <div>
      <h1 className="reveal text-2xl font-extrabold tracking-tight">Orders</h1>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Filter by status">
        <Link href={b} className={`badge px-3 py-1.5 text-sm ${!sp.state ? "badge-indigo ring-2 ring-indigo-300" : "badge-slate"}`}>All ({total})</Link>
        {ORDER_STATES.map((s) => <Link key={s} href={`${b}?state=${s}`} className={`badge px-3 py-1.5 text-sm ${sp.state === s ? "badge-indigo ring-2 ring-indigo-300" : "badge-slate"}`}>{s} ({counts.get(s) ?? 0})</Link>)}
      </nav>
      <form method="get" className="card mt-4 flex flex-wrap items-end gap-3">
        {sp.state && <input type="hidden" name="state" value={sp.state} />}
        <label className="field mb-0"><span>Order number, name or email</span><input className="input" name="q" defaultValue={q} /></label>
        <button className="btn btn-secondary">Search</button>
      </form>
      {rows.length === 0 ? (
        <div className="card pop-in mt-6 text-center"><span className="icon-chip mx-auto">{Icon.cart}</span><h2 className="mt-3 font-bold">No orders found</h2><p className="text-sm text-muted">Orders appear here as customers check out.</p></div>
      ) : (
        <div className="card reveal reveal-1 mt-5 overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Status</th><th>Payment</th><th>Total</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o._id} className={o.state === "confirmed" && olderThan(o.createdAt, 20) ? "bg-amber-50" : ""}>
                  <td><Link className="font-bold hover:underline" href={`${b}/${o._id}`}>#{o.orderNo}</Link>{o.flags?.refundRequired && <span className="badge badge-red ms-2">Refund due</span>}</td>
                  <td>{o.customer.name}</td>
                  <td className="whitespace-nowrap text-xs" title={fmtDate(o.createdAt, "en")}>{ago(o.createdAt)}</td>
                  <td><span className={`badge ${BADGE[o.state] ?? "badge-slate"}`}>{o.state}</span></td>
                  <td><span className={`badge ${payBadge[o.payment.state] ?? "badge-slate"}`}>{o.payment.state.replace(/_/g, " ")}</span><span className="ms-1 text-xs text-muted">{o.source === "pos" ? "till" : o.payment.method}</span></td>
                  <td className="font-semibold">{fmtMoney(o.totalMinor, o.currency, "en")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
