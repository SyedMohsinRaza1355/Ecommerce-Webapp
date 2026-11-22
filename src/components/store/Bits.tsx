"use client";

import { useRouter } from "next/navigation";
import { useEffect, useActionState, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CartState } from "@/app/s/[sub]/(shop)/actions";
import { showToast } from "./Toast";
import type { OptionGroup } from "@/lib/commerce/options";

/** Auto-refresh while an order is still moving, so status updates without a manual reload (ST-13). */
export function LiveRefresh({ active, seconds = 8 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [active, seconds, router]);
  return null;
}

const listeners = new Set<() => void>();
const KEY = "cookie-notice-ok";
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const dismissedNow = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function CookieNotice({ text, ok }: { text: string; ok: string }) {
  // server snapshot is "dismissed" so nothing flashes before hydration
  const dismissed = useSyncExternalStore(subscribe, dismissedNow, () => true);
  if (dismissed) return null;
  return (
    <div role="region" aria-label="Cookie notice" className="pop-in fixed inset-x-3 bottom-20 z-40 md:bottom-3 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-slate-900 p-3 text-sm text-white shadow-2xl">
      <p className="grow">{text}</p>
      <button className="btn btn-primary" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked: notice returns next visit */ } listeners.forEach((l) => l()); }}>{ok}</button>
    </div>
  );
}

export function AddToCart({ action, label, soldOut, max, cartHref, price, bar = false, groups = [], basePriceMinor = 0, currency = "PKR", unavailableNote }: { action: (p: CartState, f: FormData) => Promise<CartState>; label: string; soldOut: boolean; max: number; cartHref?: string; price?: string; bar?: boolean; groups?: OptionGroup[]; basePriceMinor?: number; currency?: string; unavailableNote?: string }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [, act, pending] = useActionState<CartState, FormData>(async (p, f) => {
    const r = await action(p, f);
    if (r?.error) showToast({ text: r.error, error: true });
    else if (r) showToast({ text: r.message ?? "Added to your cart.", href: cartHref, label: "Cart" });
    return r;
  }, undefined);
  if (bar && groups.length) {
    return <div className="fixed inset-x-0 bottom-14 z-20 flex items-center gap-3 border-t border-line bg-white/95 p-3 backdrop-blur md:hidden">{price && <p className="shrink-0 text-lg font-extrabold">{price}</p>}<a href="#options" className="btn btn-primary grow">Choose options</a></div>;
  }
  const delta = groups.reduce((n, g) => n + g.choices.filter((c) => (picked[g.id] ?? []).includes(c.id)).reduce((m, c) => m + c.priceDeltaMinor, 0), 0);
  const zero = currency === "JPY";
  const fmt = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: zero ? 0 : 2 }).format(zero ? minor : minor / 100);
  const toggle = (g: OptionGroup, id: string, on: boolean) => setPicked((p) => ({ ...p, [g.id]: g.multi ? (on ? [...(p[g.id] ?? []), id] : (p[g.id] ?? []).filter((x) => x !== id)) : on ? [id] : [] }));
  return (
    <form id={bar ? undefined : "options"} action={act} className={bar ? "fixed inset-x-0 bottom-14 z-20 flex items-end gap-3 border-t border-line bg-white/95 p-3 backdrop-blur md:hidden" : "flex flex-wrap items-end gap-3"}>
      {bar && price && <p className="shrink-0 text-lg font-extrabold">{price}</p>}
      {!bar && groups.length > 0 && (
        <div className="basis-full space-y-4">
          {groups.map((g) => (
            <fieldset key={g.id}>
              <legend className="font-bold">{g.name} <span className="text-xs font-normal text-muted">{g.required ? "required" : "optional"}{g.multi ? (g.max ? `, up to ${g.max}` : ", choose any") : ""}</span></legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {g.choices.map((c) => {
                  const out = c.stock != null && c.stock <= 0;
                  return (
                    <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-[var(--brand-primary)] has-[:checked]:bg-[color-mix(in_srgb,var(--brand-primary)_10%,white)] ${out ? "opacity-50" : ""}`}>
                      <input type={g.multi ? "checkbox" : "radio"} name={`opt_${g.id}`} value={c.id} disabled={out} required={g.required && !g.multi} checked={(picked[g.id] ?? []).includes(c.id)} onChange={(e) => toggle(g, c.id, e.target.checked)} />
                      <span>{c.label}{c.priceDeltaMinor !== 0 && <span className="text-muted"> ({c.priceDeltaMinor > 0 ? "+" : "-"}{fmt(Math.abs(c.priceDeltaMinor))})</span>}{out && <span className="text-red-700"> sold out</span>}{!out && c.stock != null && c.stock <= 5 && <span className="text-amber-700"> only {c.stock} left</span>}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <p className="text-lg font-extrabold" aria-live="polite">{fmt(basePriceMinor + delta)}</p>
        </div>
      )}
      {unavailableNote && <p className="basis-full text-sm font-semibold text-amber-800">{unavailableNote}</p>}
      <label className="field mb-0">
        <span>Qty</span>
        <input className="input w-24" type="number" name="qty" min={1} max={Math.max(1, Math.min(max, 99))} defaultValue={1} disabled={soldOut} />
      </label>
      <button className={`btn btn-primary ${bar ? "grow" : ""}`} disabled={soldOut || pending || Boolean(unavailableNote)}>{pending ? "..." : label}</button>
    </form>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}
