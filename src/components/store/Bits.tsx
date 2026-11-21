"use client";

import { useRouter } from "next/navigation";
import { useEffect, useActionState, useSyncExternalStore, type ReactNode } from "react";
import type { CartState } from "@/app/s/[sub]/(shop)/actions";

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
    <div role="region" aria-label="Cookie notice" className="pop-in fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-slate-900 p-3 text-sm text-white shadow-2xl">
      <p className="grow">{text}</p>
      <button className="btn btn-primary" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked: notice returns next visit */ } listeners.forEach((l) => l()); }}>{ok}</button>
    </div>
  );
}

export function AddToCart({ action, label, soldOut, max }: { action: (p: CartState, f: FormData) => Promise<CartState>; label: string; soldOut: boolean; max: number }) {
  const [state, act, pending] = useActionState<CartState, FormData>(action, undefined);
  return (
    <form action={act} className="flex flex-wrap items-end gap-3">
      <label className="field mb-0">
        <span>Qty</span>
        <input className="input w-24" type="number" name="qty" min={1} max={Math.max(1, Math.min(max, 99))} defaultValue={1} disabled={soldOut} />
      </label>
      <button className="btn btn-primary" disabled={soldOut || pending}>{pending ? "..." : label}</button>
      <div aria-live="polite" className="basis-full">
        {state?.error && <p className="err pop-in">{state.error}</p>}
        {state?.message && <p className="ok pop-in">{state.message}</p>}
      </div>
    </form>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}
