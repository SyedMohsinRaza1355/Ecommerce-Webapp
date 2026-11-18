import { platformDb } from "@/lib/db/client";

export const metadata = { title: "Audit log | Storeforge Super Admin" };

type Row = { _id: unknown; at: Date; actorId: string; actorRole: string; action: string; target?: string; outcome: string; instanceId: string | null };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; outcome?: string }> }) {
  const { q = "", outcome = "" } = await searchParams;
  const db = await platformDb();
  const filter: Record<string, unknown> = {};
  if (q) filter.action = { $regex: q.replace(/[^a-zA-Z0-9_.-]/g, ""), $options: "i" };
  if (["success", "failure", "denied"].includes(outcome)) filter.outcome = outcome;
  const rows = await db.collection<Row>("audit_log").find(filter).sort({ at: -1 }).limit(100).toArray();
  return (
    <div>
      <h1 className="reveal text-2xl font-extrabold tracking-tight">Audit log</h1>
      <p className="reveal reveal-1 mt-1 text-muted">Every important action is recorded here. Entries cannot be edited or deleted.</p>
      <form className="card reveal reveal-2 mt-5 flex flex-wrap items-end gap-3" method="get">
        <label className="field mb-0"><span>Action contains</span><input className="input" name="q" defaultValue={q} placeholder="instance.create" /></label>
        <label className="field mb-0">
          <span>Outcome</span>
          <select className="input" name="outcome" defaultValue={outcome}>
            <option value="">Any</option><option value="success">Success</option><option value="failure">Failure</option><option value="denied">Denied</option>
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      <div className="card reveal reveal-3 mt-5 overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r._id)}>
                <td className="whitespace-nowrap text-xs">{new Date(r.at).toLocaleString()}</td>
                <td className="text-xs"><span className="badge badge-slate">{r.actorRole}</span></td>
                <td className="font-mono text-xs">{r.action}</td>
                <td className="text-xs">{r.target ?? "-"}</td>
                <td><span className={`badge ${r.outcome === "success" ? "badge-green" : "badge-red"}`}>{r.outcome}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted">No entries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
