import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

export type NavItem = { href: string; label: string };

/** Shared left-sidebar admin layout used by Super Admin and store admin (SRS ST-14). */
export function AppShell({
  nav, title, userLabel, logout, children,
}: {
  nav: NavItem[];
  title: string;
  userLabel: string;
  logout: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen md:flex">
      <aside className="w-full shrink-0 text-white md:w-60" style={{ background: "var(--surface-sidebar)" }} aria-label="Sidebar">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <Logo light />
          <p className="mt-0 text-xs text-slate-400 md:mt-2">{title}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 md:block md:space-y-1 md:pb-0" aria-label="Main">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="block whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-line bg-white px-4 py-3">
          <span className="text-sm text-muted">{userLabel}</span>
          <form action={logout}><button className="btn btn-secondary">Sign out</button></form>
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
