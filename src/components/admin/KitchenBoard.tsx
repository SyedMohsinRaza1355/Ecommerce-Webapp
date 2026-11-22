"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminState } from "@/app/s/[sub]/admin/actions";

export type Ticket = { id: string; orderNo: number; createdAt: string; state: "confirmed" | "processing" | "ready"; items: { name: string; qty: number }[]; notes: string; who: string; paid: string; source: string; extra?: string };

const COLUMNS: { state: Ticket["state"]; title: string; next: string; nextLabel: string }[] = [
  { state: "confirmed", title: "New", next: "processing", nextLabel: "Start preparing" },
  { state: "processing", title: "Preparing", next: "ready", nextLabel: "Mark ready" },
  { state: "ready", title: "Ready", next: "fulfilled", nextLabel: "Handed over" },
];

function age(from: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, level: s < 600 ? "ok" : s < 1200 ? "warn" : "late" } as const;
}

const beep = () => {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch { /* sound is optional */ }
};

/** Live board for the kitchen: refreshes by itself, shows how long each order has waited, and can beep or print a ticket for new orders. */
export default function KitchenBoard({ tickets, move, sub, canMove }: { tickets: Ticket[]; move: (orderId: string, to: string) => Promise<AdminState>; sub: string; canMove: boolean }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const seen = useRef<Set<string> | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => router.refresh(), 6000); return () => clearInterval(t); }, [router]);

  useEffect(() => {
    const ids = new Set(tickets.filter((t) => t.state === "confirmed").map((t) => t.id));
    if (seen.current) {
      const fresh = [...ids].filter((id) => !seen.current!.has(id));
      if (fresh.length) {
        if (sound) beep();
        if (autoPrint && frame.current) frame.current.src = `/s/${sub}/admin/print/${fresh[0]}?kind=ticket&auto=1`;
      }
    }
    seen.current = ids;
  }, [tickets, sound, autoPrint, sub]);

  const go = (id: string, to: string) => start(async () => { const r = await move(id, to); setError(r?.error ?? ""); router.refresh(); });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); if (e.target.checked) beep(); }} /> Beep for new orders</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} /> Print a ticket for new orders</label>
        <span className="text-muted">Updates every few seconds. Timer turns amber after 10 minutes and red after 20.</span>
      </div>
      {autoPrint && <p className="hint mb-3">Your browser asks before printing each ticket. To print silently, start the browser in kiosk-printing mode (see Help).</p>}
      {error && <p role="alert" className="err mb-3">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = tickets.filter((t) => t.state === col.state);
          return (
            <section key={col.state} aria-labelledby={`col-${col.state}`} className="rounded-2xl bg-slate-100 p-3">
              <h2 id={`col-${col.state}`} className="mb-3 flex items-center justify-between text-lg font-extrabold">{col.title} <span className="badge badge-indigo">{list.length}</span></h2>
              <ul className="space-y-3">
                {list.length === 0 && <li className="rounded-xl p-4 text-center text-sm text-muted">Nothing here.</li>}
                {list.map((t) => {
                  const a = age(t.createdAt, now);
                  return (
                    <li key={t.id} className={`card p-4 ${a.level === "late" ? "ring-2 ring-red-500" : a.level === "warn" ? "ring-2 ring-amber-400" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-2xl font-extrabold">#{t.orderNo}</p>
                        <p className={`rounded-lg px-2 py-1 font-mono text-lg font-bold ${a.level === "late" ? "bg-red-100 text-red-800" : a.level === "warn" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`} aria-label={`Waiting ${a.text} minutes`}>{a.text}</p>
                      </div>
                      <p className="text-xs text-muted">{t.who} · {t.source} · {t.paid}</p>
                      {t.extra && <p className="mt-1 inline-block rounded-lg bg-indigo-100 px-2 py-0.5 text-sm font-bold text-indigo-900">{t.extra}</p>}
                      <ul className="mt-2 space-y-1 text-lg">{t.items.map((i, k) => <li key={k}><strong>{i.qty} x</strong> {i.name}</li>)}</ul>
                      {t.notes && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm">Note: {t.notes}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canMove && <button className="btn btn-primary grow text-lg" disabled={pending} onClick={() => go(t.id, col.next)}>{col.nextLabel}</button>}
                        <a className="btn btn-secondary" href={`/s/${sub}/admin/print/${t.id}?kind=ticket`} target="_blank" rel="noopener noreferrer">Print ticket</a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <iframe ref={frame} title="Ticket printer" className="hidden" />
    </div>
  );
}
