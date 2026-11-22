import { guard } from "@/lib/commerce/guard";
import { listQuotes } from "@/lib/commerce/growth";
import { fmtDate } from "@/lib/i18n";
import { ActionButton } from "@/components/admin/Forms";
import { quoteOpAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Quote requests" };

export default async function QuotesPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "catalog.manage");
  const rows = await listQuotes(store.ctx);
  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Quote requests</h1>
        <p className="text-muted">Customers who asked for a price. Reply by email, then mark the request as answered.</p>
      </div>
      {rows.length === 0 && <div className="card text-center text-muted">No requests yet. Customers see an &quot;Ask for a quote&quot; box on each product.</div>}
      <ul className="space-y-3">
        {rows.map((q) => (
          <li key={q._id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">{q.name} <span className={`badge ms-2 ${q.status === "new" ? "badge-amber" : q.status === "answered" ? "badge-green" : "badge-slate"}`}>{q.status}</span></p>
                <p className="text-sm"><a className="underline" href={`mailto:${q.email}`}>{q.email}</a>{q.phone ? `, ${q.phone}` : ""}</p>
                <p className="text-xs text-muted">{fmtDate(q.createdAt, "en")}{q.productName ? `, about ${q.productName}` : ""}, quantity {q.qty}</p>
              </div>
              <span className="flex gap-2">
                {q.status !== "answered" && <ActionButton label="Mark answered" run={quoteOpAction.bind(null, sub, q._id, "answered")} />}
                {q.status !== "closed" && <ActionButton label="Close" run={quoteOpAction.bind(null, sub, q._id, "closed")} />}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm">{q.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
