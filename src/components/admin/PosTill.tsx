"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PosState } from "@/app/s/[sub]/admin/actions";

export type PosProduct = { id: string; name: string; priceMinor: number; stock: number | null; categoryName: string };
type Line = { id: string; qty: number };
type Sale = { items: { productId: string; qty: number }[]; tender: string; received: string; customerName: string; discountPercent: string; idem: string };

const rid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

/** Touch-friendly till: tap products, take cash or another payment, print the receipt. Prices shown here are estimates; the server recalculates everything. */
export default function PosTill({ products, currency, sale, sub, canDiscount, taxPercent }: {
  products: PosProduct[]; currency: string; sub: string; canDiscount: boolean; taxPercent: number;
  sale: (p: Sale) => Promise<PosState>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [tender, setTender] = useState<"cash" | "card" | "wallet">("cash");
  const [received, setReceived] = useState("");
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("");
  const [idem, setIdem] = useState(rid);
  const [msg, setMsg] = useState<PosState>();
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const zero = currency === "JPY";
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: zero ? 0 : 2 }).format(zero ? n : n / 100);
  const subtotal = lines.reduce((n, l) => n + (byId.get(l.id)?.priceMinor ?? 0) * l.qty, 0);
  const disc = Math.round((subtotal * (Number(discount) || 0)) / 100);
  const estTotal = Math.round((subtotal - disc) * (1 + taxPercent / 100));
  const recv = Number(received);
  const change = tender === "cash" && received.trim() !== "" && Number.isFinite(recv) && recv * 100 >= estTotal ? Math.round(recv * 100 - estTotal) : 0;
  const shown = products.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60);

  const add = (id: string) => setLines((ls) => (ls.some((l) => l.id === id) ? ls.map((l) => (l.id === id ? { ...l, qty: Math.min(99, l.qty + 1) } : l)) : [...ls, { id, qty: 1 }]));
  const setQty = (id: string, d: number) => setLines((ls) => ls.flatMap((l) => (l.id === id ? (l.qty + d <= 0 ? [] : [{ ...l, qty: Math.min(99, l.qty + d) }]) : [l])));

  const finish = () =>
    start(async () => {
      const r = await sale({ items: lines.map((l) => ({ productId: l.id, qty: l.qty })), tender, received, customerName: name, discountPercent: discount, idem });
      setMsg(r);
      if (r?.orderId) {
        window.open(`/s/${sub}/admin/print/${r.orderId}?kind=thermal&auto=1`, "_blank", "noopener");
        setLines([]); setReceived(""); setName(""); setDiscount(""); setIdem(rid());
        router.refresh();
      }
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <section aria-label="Products">
        <label className="sr-only" htmlFor="pos-q">Search products</label>
        <input id="pos-q" className="input mb-3" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => {
            const out = p.stock !== null && p.stock <= 0;
            return (
              <li key={p.id}>
                <button type="button" onClick={() => add(p.id)} disabled={out} className="card hover-lift flex h-full min-h-24 w-full flex-col items-start justify-between p-3 text-start disabled:opacity-50">
                  <span className="font-bold leading-snug">{p.name}</span>
                  <span className="mt-1 text-sm"><strong>{money(p.priceMinor)}</strong>{p.stock !== null && <span className={`ms-2 ${out ? "text-red-700" : "text-muted"}`}>{out ? "sold out" : `${p.stock} left`}</span>}</span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="col-span-full text-muted">No products match.</li>}
        </ul>
      </section>

      <aside className="card h-fit lg:sticky lg:top-4" aria-label="Current sale">
        <h2 className="font-extrabold">Current sale</h2>
        {lines.length === 0 ? <p className="mt-2 text-sm text-muted">Tap a product to add it.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {lines.map((l) => {
              const p = byId.get(l.id)!;
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 grow truncate">{p.name}</span>
                  <span className="flex items-center gap-1">
                    <button type="button" className="btn btn-secondary !px-3" aria-label={`Less ${p.name}`} onClick={() => setQty(l.id, -1)}>-</button>
                    <span className="w-6 text-center font-bold" aria-live="polite">{l.qty}</span>
                    <button type="button" className="btn btn-secondary !px-3" aria-label={`More ${p.name}`} onClick={() => setQty(l.id, 1)}>+</button>
                  </span>
                  <span className="w-20 text-end">{money(p.priceMinor * l.qty)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div>
          {disc > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount</dt><dd>-{money(disc)}</dd></div>}
          <div className="flex justify-between text-lg font-extrabold"><dt>Total{taxPercent > 0 ? " (with tax, estimate)" : ""}</dt><dd>{money(estTotal)}</dd></div>
        </dl>

        <fieldset className="mt-3">
          <legend className="text-sm font-semibold">Paid by</legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(["cash", "card", "wallet"] as const).map((t) => (
              <label key={t} className="flex cursor-pointer items-center justify-center rounded-xl border border-line p-2 text-center text-sm font-semibold has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
                <input className="sr-only" type="radio" name="tender" checked={tender === t} onChange={() => setTender(t)} />{t === "cash" ? "Cash" : t === "card" ? "Card machine" : "Wallet or transfer"}
              </label>
            ))}
          </div>
        </fieldset>
        {tender === "cash" && (
          <label className="field mt-3"><span>Cash received ({currency})</span><input className="input" inputMode="decimal" dir="ltr" value={received} onChange={(e) => setReceived(e.target.value)} placeholder={(estTotal / 100).toFixed(2)} />{change > 0 && <p className="mt-1 font-bold">Change to give: {money(change)}</p>}</label>
        )}
        <label className="field"><span>Customer name (optional)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></label>
        {canDiscount && <label className="field"><span>Discount % (manager or owner)</span><input className="input" inputMode="decimal" dir="ltr" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></label>}

        <div aria-live="polite">
          {msg?.error && <p role="alert" className="err mb-2">{msg.error}</p>}
          {msg?.orderNo && <p role="status" className="ok mb-2">Sale #{msg.orderNo} saved{msg.changeMinor ? `. Change: ${money(msg.changeMinor)}` : ""}. The receipt opened in a new tab.</p>}
        </div>
        <button className="btn btn-primary w-full text-lg" disabled={pending || lines.length === 0} onClick={finish}>{pending ? "Saving..." : "Charge and print receipt"}</button>
        {lines.length > 0 && <button type="button" className="btn btn-secondary mt-2 w-full" onClick={() => { setLines([]); setMsg(undefined); }}>Clear sale</button>}
      </aside>
    </div>
  );
}
