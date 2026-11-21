import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icons";
import { requireSuperAdmin } from "@/lib/auth/current";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();
  return (
    <AppShell
      title="Super Admin"
      userLabel="Super Admin"
      logout={logoutAction}
      nav={[
        { href: "/admin", label: "Dashboard", icon: Icon.home, exact: true },
        { href: "/admin/instances", label: "Stores", icon: Icon.store },
        { href: "/admin/plans", label: "Plans", icon: Icon.tag },
        { href: "/admin/audit", label: "Audit log", icon: Icon.list },
        { href: "/admin/killswitch", label: "Kill switch", icon: Icon.shield },
        { href: "/toggles", label: "Toggle catalogue", icon: Icon.switch },
      ]}
    >
      {children}
    </AppShell>
  );
}
