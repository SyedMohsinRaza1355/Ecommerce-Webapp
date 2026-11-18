import { platformDb } from "@/lib/db/client";

export const metadata = { title: "Dashboard | Storeforge Super Admin" };

export default async function Dashboard() {
  const db = await platformDb();
  const [total, active, suspended, audit] = await Promise.all([
    db.collection("instances").countDocuments({}),
    db.collection("instances").countDocuments({ status: "active" }),
    db.collection("instances").countDocuments({ status: "suspended" }),
    db.collection("audit_log").countDocuments({}),
  ]);
  const stats: [string, number][] = [["Stores", total], ["Active", active], ["Suspended", suspended], ["Audit entries", audit]];
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(([label, n]) => (
          <div key={label} className="card">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 text-3xl font-bold">{n}</p>
          </div>
        ))}
      </div>
      <div className="card mt-6">
        <h2 className="font-semibold">Getting started</h2>
        <p className="mt-1 text-sm text-muted">Stores, plans and the audit log are added in the next steps. Your sign in is protected by server-side session checks.</p>
      </div>
    </div>
  );
}
