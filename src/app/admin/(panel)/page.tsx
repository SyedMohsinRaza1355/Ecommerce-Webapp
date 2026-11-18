import Link from "next/link";
import { platformDb } from "@/lib/db/client";
import { ensurePlatform } from "@/lib/platform/setup";
import { Icon } from "@/components/Icons";

export const metadata = { title: "Dashboard | Storeforge Super Admin" };

export default async function Dashboard() {
  await ensurePlatform();
  const db = await platformDb();
  const [total, active, suspended, audit] = await Promise.all([
    db.collection("instances").countDocuments({}),
    db.collection("instances").countDocuments({ status: "active" }),
    db.collection("instances").countDocuments({ status: "suspended" }),
    db.collection("audit_log").countDocuments({}),
  ]);
  const stats = [
    ["Stores", total, Icon.store], ["Active", active, Icon.check], ["Suspended", suspended, Icon.lock], ["Audit entries", audit, Icon.list],
  ] as const;
  return (
    <div>
      <h1 className="reveal text-2xl font-extrabold tracking-tight">Dashboard</h1>
      <p className="reveal reveal-1 mt-1 text-muted">A quick look at the platform.</p>
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(([label, n, icon], i) => (
          <div key={label} className={`card hover-lift reveal reveal-${i + 1}`}>
            <span className="icon-chip">{icon}</span>
            <p className="mt-4 text-sm text-muted">{label}</p>
            <p className="text-3xl font-extrabold">{n}</p>
          </div>
        ))}
      </div>
      <div className="card reveal reveal-5 mt-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-bold">Create your next store</h2>
          <p className="text-sm text-muted">Choose a name, an address and an industry pack. It takes seconds.</p>
        </div>
        <Link href="/admin/instances/new" className="btn btn-primary">{Icon.plus} Create store</Link>
      </div>
    </div>
  );
}
