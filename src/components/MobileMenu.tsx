"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem } from "./AppShell";

/** Phone navigation for the admin areas: one tidy button that opens a grid of every page, instead of a long strip to scroll sideways. */
export function MobileMenu({ nav }: { nav: NavItem[] }) {
  const path = usePathname();
  // the menu is open only for the page it was opened on, so moving to another page closes it by itself
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenAt(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const isActive = (n: NavItem) => (n.exact ? path === n.href : path === n.href || path.startsWith(n.href + "/"));
  const current = [...nav].filter(isActive).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <div className="px-3 pb-3 md:hidden">
      <button type="button" className="flex w-full items-center justify-between rounded-xl bg-white/10 px-4 py-3 text-start font-semibold text-white" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpenAt(open ? null : path)}>
        <span className="flex items-center gap-2">{current?.icon}{current?.label ?? "Menu"}</span>
        <span aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      {open && (
        <nav id="mobile-nav" aria-label="All pages" className="pop-in mt-2 grid grid-cols-2 gap-2">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n) ? "page" : undefined} className={`flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold text-white ${isActive(n) ? "bg-white/25" : "bg-white/10"}`}>
              {n.icon}<span>{n.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
