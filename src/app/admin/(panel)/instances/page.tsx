import Link from "next/link";
import { platformDb } from "@/lib/db/client";
import { ensurePlatform } from "@/lib/platform/setup";
import { env } from "@/lib/env";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import { Icon } from "@/components/Icons";

export const metadata = { title: "Stores | Storeforge Super Admin" };

const STATUS: Record<string, string> = { active: "badge-green", suspended: "badge-red", provisioning: "badge-amber", provisioning_failed: "badge-red", terminated: "badge-slate" };

export default async function StoresPage() {
  await ensurePlatform();
  const db = await platformDb();
  const list = await db.collection<InstanceRecord>("instances").find({}).sort({ _id: -1 }).limit(200).toArray();
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="reveal text-2xl font-extrabold tracking-tight">Stores</h1>
        <Link href="/admin/instances/new" className="btn btn-primary">{Icon.plus} Create store</Link>
      </div>
      {list.length === 0 ? (
        <div className="card pop-in mt-6 text-center">
          <div className="icon-chip mx-auto">{Icon.store}</div>
          <h2 className="mt-4 text-lg font-bold">No stores yet</h2>
          <p className="mt-1 text-muted">Create the first store to see it here.</p>
          <Link href="/admin/instances/new" className="btn btn-primary mt-4">Create the first store</Link>
        </div>
      ) : (
        <div className="card reveal reveal-1 mt-6 overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Store</th><th>Address</th><th>Plan</th><th>Pack</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((i) => (
                <tr key={i._id}>
                  <td className="font-semibold"><Link className="hover:underline" href={`/admin/instances/${i._id}`}>{i.name}</Link></td>
                  <td className="font-mono text-xs">{i.subdomain}.{env().baseDomain}</td>
                  <td>{i.planId}</td>
                  <td>{i.industryPack ?? "-"}</td>
                  <td><span className={`badge ${STATUS[i.status] ?? "badge-slate"}`}>{i.status.replace(/_/g, " ")}</span></td>
                  <td className="text-end"><Link className="btn btn-secondary" href={`/admin/instances/${i._id}`}>Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
