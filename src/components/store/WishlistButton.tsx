"use client";

import { useTransition } from "react";

/** Heart toggle for the product page. The caller passes a server action already bound to the product. */
export function WishlistButton({ action, saved, label }: { action: () => Promise<void>; saved: boolean; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-secondary" disabled={pending} aria-pressed={saved} onClick={() => start(async () => { await action(); })}>
      <span aria-hidden="true">{saved ? "♥" : "♡"}</span> {label ?? (saved ? "Saved" : "Save for later")}
    </button>
  );
}
