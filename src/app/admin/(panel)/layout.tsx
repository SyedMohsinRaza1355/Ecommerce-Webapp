import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
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
        { href: "/admin", label: "Dashboard" },
        { href: "/admin/instances", label: "Stores" },
        { href: "/admin/plans", label: "Plans" },
        { href: "/admin/audit", label: "Audit log" },
        { href: "/toggles", label: "Toggle catalogue" },
      ]}
    >
      {children}
    </AppShell>
  );
}
