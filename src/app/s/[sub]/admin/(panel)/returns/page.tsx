import Link from "next/link";
import { guard } from "@/lib/commerce/guard";
import { listReturns } from "@/lib/commerce/growth";
import { fmtDate } from "@/lib/i18n";
import { ActionButton } from "@/components/admin/Forms";
import { returnOpAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Returns" };

const LABEL = { requested: "New", approved: "Approved", rejected: "Rejected", received: "Received", refunded: "Refunded" } as const;

export default async function ReturnsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "catalog.manage");
  const rows = await listReturns(store.ctx);
  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Returns and exchanges</h1>
        <p className="text-muted">Customers ask from their order page, up to 30 days after ordering. Each change below emails the customer. Pay the refund from the order itself.</p>
      </div>
      {rows.length === 0 && <div className="card text-center text-muted">No requests yet.</div>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r._id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">Order #{r.orderNo}, {r.kind} <span className={`badge ms-2 ${r.state === "requested" ? "badge-amber" : r.state === "rejected" ? "badge-red" : "badge-green"}`}>{LABEL[r.state]}</span></p>
                <p className="text-xs text-muted">{r.email}, {fmtDate(r.createdAt, "en")}</p>
              </div>
              <span className="flex flex-wrap gap-2">
                {r.state === "requested" && <><ActionButton label="Approve" run={returnOpAction.bind(null, sub, r._id, "approved")} /><ActionButton label="Reject" danger confirmText="Reject this request?" run={returnOpAction.bind(null, sub, r._id, "rejected")} /></>}
                {r.state === "approved" && <ActionButton label="Items received" run={returnOpAction.bind(null, sub, r._id, "received")} />}
                {r.state === "received" && <><ActionButton label="Mark refunded" run={returnOpAction.bind(null, sub, r._id, "refunded")} /><Link className="btn btn-secondary" href={`/s/${sub}/admin/orders/${r.orderId}`}>Open order</Link></>}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm">{r.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
