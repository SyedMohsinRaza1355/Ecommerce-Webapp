"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminState } from "@/app/s/[sub]/admin/actions";
import { Result } from "./Forms";

export type BulkRow = { id: string; name: string; price: string; stock: number; trackStock: boolean; status: string; imageUrl?: string; category?: string };

/** Product table with optional multi-select and a bulk action bar (F-115). */
export default function BulkProducts({ rows, can, bulk, base, action }: { rows: BulkRow[]; can: boolean; bulk: boolean; base: string; action: (p: AdminState, f: FormData) => Promise<AdminState> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<AdminState>();
  const [pending, start] = useTransition();
  const [op, setOp] = useState("publish");
  const router = useRouter();
  const showBoxes = bulk && can;
  const toggleAll = (on: boolean) => formRef.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((b) => { b.checked = on; });
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (op === "delete" && !window.confirm("Delete the selected products permanently? Past orders keep their own copy.")) return;
        start(async () => { const r = await action(undefined, fd); setState(r); if (r && !r.error) router.refresh(); });
      }}
    >
      {showBoxes && (
        <div className="card mb-4 flex flex-wrap items-end gap-3" role="group" aria-label="Bulk actions for ticked products">
          <label className="field mb-0"><span>With the ticked products</span>
            <select className="input" name="op" value={op} onChange={(e) => setOp(e.target.value)}>
              <option value="publish">Publish</option><option value="draft">Move to draft</option><option value="price">Change price by %</option><option value="stock">Set stock to</option><option value="delete">Delete</option>
            </select>
          </label>
          {(op === "price" || op === "stock") && <label className="field mb-0"><span>{op === "price" ? "Percent (10 or -15)" : "New stock"}</span><input className="input w-32" name="value" inputMode="decimal" dir="ltr" required /></label>}
          <button className={`btn ${op === "delete" ? "btn-danger" : "btn-primary"}`} disabled={pending}>{pending ? "Working..." : "Apply"}</button>
          <Result state={state} />
        </div>
      )}
      <div className="card reveal reveal-2 overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              {showBoxes && <th><input type="checkbox" aria-label="Tick all products" onChange={(e) => toggleAll(e.target.checked)} /></th>}
              <th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                {showBoxes && <td><input type="checkbox" name="ids" value={p.id} aria-label={`Tick ${p.name}`} /></td>}
                <td className="font-semibold">
                  <span className="flex items-center gap-3">
                    {p.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.imageUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-line" />
                      : <span aria-hidden="true" className="ph !aspect-square !w-10 shrink-0 text-sm">{p.name.slice(0, 2).toUpperCase()}</span>}
                    <span>{p.name}{p.category && <span className="block text-xs font-normal text-muted">{p.category}</span>}</span>
                  </span>
                </td>
                <td>{p.price}</td>
                <td>{p.trackStock ? <span className={p.stock === 0 ? "badge badge-red" : p.stock <= 5 ? "badge badge-amber" : ""}>{p.stock}</span> : <span className="text-muted">Not tracked</span>}</td>
                <td><span className={`badge ${p.status === "published" ? "badge-green" : "badge-slate"}`}>{p.status}</span></td>
                <td className="text-end">{can && <Link className="btn btn-secondary" href={`${base}/${p.id}`}>Edit</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
