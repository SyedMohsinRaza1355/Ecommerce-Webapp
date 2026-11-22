import { guard } from "@/lib/commerce/guard";
import { orders, expireUnpaidOrders } from "@/lib/commerce/orders";
import { orderStatusAction } from "@/app/s/[sub]/admin/actions";
import KitchenBoard, { type Ticket } from "@/components/admin/KitchenBoard";

export const metadata = { title: "Kitchen" };
export const dynamic = "force-dynamic";

export default async function KitchenPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "orders.updateStatus");
  await expireUnpaidOrders(store.ctx).catch(() => 0);
  const rows = await (await orders.collection(store.ctx)).find(orders.scope(store.ctx, { state: { $in: ["confirmed", "processing", "ready"] } } as never)).sort({ createdAt: 1 }).limit(60).toArray();
  const tickets: Ticket[] = rows.map((o) => ({
    id: o._id, orderNo: o.orderNo, createdAt: o.createdAt.toISOString(), state: o.state as Ticket["state"],
    items: o.items.map((i) => ({ name: i.name, qty: i.qty })), notes: o.customer.notes ?? "",
    who: o.customer.name, source: o.source === "pos" ? "In store" : o.customer.city === "In store" ? "In store" : "Online",
    paid: o.payment.state === "captured" ? "Paid" : o.payment.method === "cod" ? "Pay on delivery" : "Unpaid",
  }));
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Kitchen</h1>
      <p className="mb-4 text-muted">Orders to prepare, oldest first. Tap the big button to move an order along. Customers get an email at each step.</p>
      <KitchenBoard tickets={tickets} sub={sub} move={orderStatusAction.bind(null, sub)} canMove />
    </div>
  );
}
