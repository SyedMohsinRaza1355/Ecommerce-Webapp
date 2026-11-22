"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ToastData = { text: string; href?: string; label?: string; error?: boolean };
const EVENT = "sf-toast";

/** Shows a short message from anywhere in the shop (for example after adding something to the cart). */
export function showToast(t: ToastData) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ToastData>(EVENT, { detail: t }));
}

export function ToastHost() {
  const [t, setT] = useState<(ToastData & { id: number }) | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastData>).detail;
      clearTimeout(timer);
      setT({ ...d, id: Date.now() });
      timer = setTimeout(() => setT(null), d.error ? 6000 : 4000);
    };
    window.addEventListener(EVENT, on);
    return () => { window.removeEventListener(EVENT, on); clearTimeout(timer); };
  }, []);
  if (!t) return null;
  return (
    <div key={t.id} className={`toast ${t.error ? "is-error" : ""}`} role={t.error ? "alert" : "status"} aria-live={t.error ? "assertive" : "polite"}>
      <span className="grow text-sm font-semibold">{t.text}</span>
      {t.href && <Link href={t.href} className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-bold hover:bg-white/25" onClick={() => setT(null)}>{t.label ?? "View"}</Link>}
      <button type="button" aria-label="Dismiss" className="shrink-0 px-1 text-lg leading-none opacity-70 hover:opacity-100" onClick={() => setT(null)}>×</button>
    </div>
  );
}
