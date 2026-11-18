import type { ReactNode } from "react";

const base = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const Icon = {
  rocket: <svg {...base}><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-5-5 6-6Z" /><circle cx="15" cy="9" r="1.5" /></svg>,
  switch: <svg {...base}><rect x="2" y="7" width="20" height="10" rx="5" /><circle cx="16" cy="12" r="2.5" /></svg>,
  shield: <svg {...base}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>,
  globe: <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>,
  phone: <svg {...base}><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></svg>,
  lock: <svg {...base}><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  home: <svg {...base}><path d="m3 11 9-8 9 8M5 10v10h14V10" /></svg>,
  store: <svg {...base}><path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0" /></svg>,
  tag: <svg {...base}><path d="M3 12V3h9l9 9-9 9-9-9Z" /><circle cx="7.5" cy="7.5" r="1.2" /></svg>,
  list: <svg {...base}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>,
  plus: <svg {...base}><path d="M12 5v14M5 12h14" /></svg>,
  check: <svg {...base}><path d="m5 12 5 5L20 7" /></svg>,
  box: <svg {...base}><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" /><path d="m3 7 9 4 9-4M12 11v10" /></svg>,
  cart: <svg {...base}><path d="M3 4h2l2.4 11h10.2L20 7H6" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></svg>,
  users: <svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.5 3.2-5 6.5-5s5.9 1.5 6.5 5M17 5a3.5 3.5 0 0 1 0 6.5M21.5 20c-.3-2.4-1.6-3.9-3.5-4.6" /></svg>,
} satisfies Record<string, ReactNode>;
