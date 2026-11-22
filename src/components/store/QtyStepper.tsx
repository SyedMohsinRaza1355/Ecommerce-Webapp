"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "./Toast";

/** - / + buttons for a cart line. Saves at once, so there is no separate Apply step. */
export function QtyStepper({ qty, max, name, update, removeLabel }: { qty: number; max: number; name: string; update: (qty: number) => Promise<void>; removeLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useState(qty);
  const cap = Math.max(1, Math.min(max, 99));
  const go = (next: number) => {
    if (next < 0 || next > cap) {
      if (next > cap) showToast({ text: `Only ${cap} available.`, error: true });
      return;
    }
    setShown(next);
    start(async () => { await update(next); router.refresh(); });
  };
  return (
    <span className="inline-flex items-center gap-1" aria-busy={pending}>
      <button type="button" className="btn btn-secondary !h-10 !w-10 !px-0 text-lg" aria-label={shown <= 1 ? `${removeLabel} ${name}` : `Less ${name}`} onClick={() => go(shown - 1)} disabled={pending}>{shown <= 1 ? "×" : "−"}</button>
      <span className="w-8 text-center font-bold" aria-live="polite">{shown}</span>
      <button type="button" className="btn btn-secondary !h-10 !w-10 !px-0 text-lg" aria-label={`More ${name}`} onClick={() => go(shown + 1)} disabled={pending || shown >= cap}>+</button>
    </span>
  );
}
