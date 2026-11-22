"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

type Hit = { name: string; href: string };

/** Search box with suggestions as you type. It still works as a normal form if scripts are off. */
export function SearchBox({ action, suggestUrl, label, placeholder, button }: { action: string; suggestUrl: string; label: string; placeholder: string; button: ReactLabel }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${suggestUrl}?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal });
        if (r.ok) { setHits(await r.json()); setOpen(true); }
      } catch { /* suggestions are optional */ }
    }, 180);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, suggestUrl]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const show = open && q.trim().length >= 2 && hits.length > 0;
  return (
    <form ref={box} action={action} method="get" role="search" className="relative order-last flex min-w-0 grow basis-full gap-2 sm:order-none sm:basis-auto sm:max-w-sm">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input id={id} name="q" className="input" placeholder={placeholder} maxLength={60} autoComplete="off" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setHits([]); }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={`${id}-list`} />
      <button className="btn btn-secondary" aria-label={label}>{button}</button>
      {show && (
        <ul id={`${id}-list`} className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          {hits.map((h) => <li key={h.href}><Link href={h.href} className="block px-4 py-2.5 text-sm hover:bg-slate-100" onClick={() => setOpen(false)}>{h.name}</Link></li>)}
        </ul>
      )}
    </form>
  );
}
type ReactLabel = import("react").ReactNode;
