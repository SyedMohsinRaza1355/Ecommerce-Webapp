import { guard } from "@/lib/commerce/guard";
import { tenantDb } from "@/lib/tenant/schema";
import { fmtDate } from "@/lib/i18n";
import { ActionButton } from "@/components/admin/Forms";
import { processOutboxAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Messages" };

export default async function EmailsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "activity.view");
  const db = await tenantDb(store.ctx);
  const [sent, pending, dead] = await Promise.all([
    db.collection("emails").find({ instanceId: store.ctx.instanceId }).sort({ sentAt: -1 }).limit(50).toArray(),
    db.collection("outbox").countDocuments({ instanceId: store.ctx.instanceId, status: "pending" }),
    db.collection("outbox").countDocuments({ instanceId: store.ctx.instanceId, status: "dead" }),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Customer messages</h1>
      <p className="text-muted">Order emails are queued and sent with automatic retries. This build records messages here instead of sending to a real mailbox.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="badge badge-amber">{pending} waiting</span>
        <span className={`badge ${dead ? "badge-red" : "badge-slate"}`}>{dead} failed for good</span>
        <ActionButton label="Send waiting messages now" run={async () => { "use server"; await processOutboxAction(sub); return { message: "Done." }; }} />
      </div>
      <div className="card mt-5 overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Sent</th><th>To</th><th>Subject</th></tr></thead>
          <tbody>
            {sent.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-muted">No messages yet.</td></tr>}
            {sent.map((m) => <tr key={String(m._id)}><td className="whitespace-nowrap text-xs">{fmtDate(m.sentAt, "en")}</td><td className="text-xs">{m.to}</td><td>{m.subject}<p className="text-xs text-muted">{m.body}</p></td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
