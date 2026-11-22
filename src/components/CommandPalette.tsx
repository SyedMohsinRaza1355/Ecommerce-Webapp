"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NavItem } from "./AppShell";

/** Ctrl/Cmd+K: type a few letters and jump to any admin page (F-145). */
export function CommandPalette({ nav }: { nav: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const list = nav.filter((n) => n.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
  return (
    <>
      <button type="button" className="btn btn-secondary hidden md:inline-flex" onClick={() => { setOpen(true); setQ(""); }} aria-haspopup="dialog">Search pages <kbd className="ms-1 rounded bg-slate-100 px-1.5 text-xs">Ctrl K</kbd></button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Go to a page" className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/50 p-4 pt-24" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="pop-in w-full max-w-md rounded-2xl bg-white p-3 shadow-2xl">
            <label className="sr-only" htmlFor="cmdk">Go to a page</label>
            <input id="cmdk" ref={input} className="input" placeholder="Go to... (orders, products, payments)" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
              onKeyDown={(e) => { if (e.key === "Enter" && list[0]) { window.location.href = list[0].href; } }} />
            <ul className="mt-2" aria-label="Pages">
              {list.map((n) => <li key={n.href}><Link href={n.href} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-100">{n.icon}{n.label}</Link></li>)}
              {list.length === 0 && <li className="px-3 py-2 text-sm text-muted">No page matches.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
