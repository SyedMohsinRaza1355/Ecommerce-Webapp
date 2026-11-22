const STEPS = [
  { state: "pending", label: "Placed" },
  { state: "confirmed", label: "Confirmed" },
  { state: "processing", label: "Preparing" },
  { state: "ready", label: "Ready" },
  { state: "fulfilled", label: "On its way" },
  { state: "completed", label: "Done" },
] as const;

/** Shows where an order is on its way, so customers do not have to read a list of status words. */
export function OrderStepper({ state }: { state: string }) {
  const at = STEPS.findIndex((s) => s.state === state);
  if (at < 0) return null; // cancelled orders get their own message instead
  return (
    <ol className="mt-6 flex items-start justify-between gap-1" aria-label="Order progress">
      {STEPS.map((s, i) => {
        const done = i < at, now = i === at;
        return (
          <li key={s.state} className="relative flex min-w-0 flex-1 flex-col items-center text-center" aria-current={now ? "step" : undefined}>
            {i > 0 && <span aria-hidden="true" className={`absolute end-1/2 top-4 h-0.5 w-full ${i <= at ? "bg-[var(--brand-primary)]" : "bg-slate-200"}`} />}
            <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-[var(--brand-primary)] text-[var(--brand-on-primary)]" : now ? "bg-white text-slate-900 ring-4 ring-[color-mix(in_srgb,var(--brand-primary)_35%,white)] border-2 border-[var(--brand-primary)]" : "bg-slate-200 text-slate-500"}`}>
              {done ? "✓" : i + 1}
            </span>
            <span className={`mt-1 text-[11px] leading-tight sm:text-xs ${now ? "font-extrabold" : done ? "font-semibold" : "text-muted"}`}>{s.label}<span className="sr-only">{done ? " (done)" : now ? " (current step)" : " (not yet)"}</span></span>
          </li>
        );
      })}
    </ol>
  );
}

export const NEXT_TEXT: Record<string, string> = {
  pending: "We have your order. As soon as payment is confirmed we start on it.",
  confirmed: "Your order is confirmed. The shop will start preparing it shortly.",
  processing: "The shop is preparing your order right now.",
  ready: "Your order is ready for handover or delivery.",
  fulfilled: "Your order is on its way, or has been handed to you.",
  completed: "All done. Thank you for shopping with us!",
  cancelled: "This order was cancelled. If you paid, a refund will follow.",
};
