import { getStaff, loadStore } from "@/lib/commerce/load";
import { authorize } from "@/lib/auth/rbac";
import { orders } from "@/lib/commerce/orders";
import { appendAudit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

/** Privacy right of access: everything the store holds about one customer email, as a JSON download. */
export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const store = await loadStore(sub);
  if (store.status !== "ok") return new Response("Not found", { status: 404 });
  const staff = await getStaff(store);
  if (!staff || !authorize(staff.actor, "privacy.manage", store.ctx).allow) return new Response("Forbidden", { status: 403 });
  const email = (new URL(req.url).searchParams.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return new Response("Enter a valid email", { status: 400 });
  const rows = await orders.find(store.ctx, { "customer.email": email } as never, 500);
  await appendAudit({ actorId: staff.actor.userId, actorRole: staff.actor.role, instanceId: store.ctx.instanceId, action: "privacy.export", outcome: "success", after: { orders: rows.length } }).catch(() => undefined);
  const body = {
    exportedAt: new Date().toISOString(), store: store.settings.branding.storeName || store.instance.name, subject: email,
    orders: rows.map((o) => ({ orderNo: o.orderNo, placedAt: o.createdAt, state: o.state, items: o.items, totals: { subtotalMinor: o.subtotalMinor, discountMinor: o.discountMinor, shippingMinor: o.shippingMinor, taxMinor: o.taxMinor, totalMinor: o.totalMinor, currency: o.currency }, customer: o.customer, payment: { method: o.payment.method, state: o.payment.state, refundedMinor: o.payment.refundedMinor } })),
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="customer-data.json"`, "cache-control": "no-store" } });
}
