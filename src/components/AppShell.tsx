import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { NavLink } from "./NavLink";

export type NavItem = { href: string; label: string; icon?: ReactNode; exact?: boolean };

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
      <aside className="sidebar-bg w-full shrink-0 text-white md:sticky md:top-0 md:h-screen md:w-64" aria-label="Sidebar">
        <div className="flex items-center justify-between px-5 py-5 md:block">
          <Logo light />
          <p className="mt-0 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-slate-300 md:mt-3 md:inline-block">{title}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:pb-0" aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.exact} icon={n.icon}>{n.label}</NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="glass sticky top-0 z-10 flex items-center justify-end gap-3 border-b border-line px-4 py-3">
          <span className="text-sm text-muted">{userLabel}</span>
          <form action={logout}><button className="btn btn-secondary">Sign out</button></form>
        </header>
        <main className="fade-in mx-auto max-w-6xl p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
