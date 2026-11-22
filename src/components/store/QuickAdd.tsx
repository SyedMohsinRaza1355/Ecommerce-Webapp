"use client";

import { useTransition } from "react";
import { showToast } from "./Toast";
import type { CartState } from "@/app/s/[sub]/(shop)/actions";

/** One-tap add to cart for product cards. Always adds one; the product page has the quantity box. */
export function QuickAdd({ action, name, cartHref, label, addedText }: { action: (p: CartState, f: FormData) => Promise<CartState>; name: string; cartHref: string; label: string; addedText: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="quick-add"
      disabled={pending}
      aria-label={`${label}: ${name}`}
      onClick={() => start(async () => {
        const fd = new FormData();
        fd.set("qty", "1");
        const r = await action(undefined, fd);
        if (r?.error) showToast({ text: r.error, error: true });
        else showToast({ text: r?.message && r.message !== "Added to your cart." ? r.message : `${addedText}: ${name}`, href: cartHref, label: "Cart" });
      })}
    >
      <span aria-hidden="true" className="text-xl leading-none">{pending ? "…" : "+"}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
