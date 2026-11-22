import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icons";
import { requireStaff } from "@/lib/commerce/load";
import { authorize } from "@/lib/auth/rbac";
import { appendAudit } from "@/lib/audit/log";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store, staff } = await requireStaff(sub);
  const a = staff.actor;
  const can = (action: Parameters<typeof authorize>[1]) => authorize(a, action, store.ctx).allow;
  const b = `/s/${sub}/admin`;
  const nav = [
    ...(a.role === "kitchen_ops" || a.role === "cashier" ? [] : [{ href: b, label: "Dashboard", icon: Icon.home, exact: true }]),
    ...(can("branding.edit") ? [{ href: `${b}/start`, label: "Setup guide", icon: Icon.rocket }] : []),
    ...(can("settings.commerce") ? [{ href: `${b}/links`, label: "Links and feeds", icon: Icon.rocket }] : []),
    ...(can("pos.sell") ? [{ href: `${b}/pos`, label: "Till", icon: Icon.tag }] : []),
    ...(can("orders.updateStatus") && (a.role === "kitchen_ops" || store.eff.get("F-124")?.enabled === true) ? [{ href: `${b}/kitchen`, label: "Kitchen", icon: Icon.list }] : []),
    ...(can("orders.updateStatus") ? [{ href: `${b}/orders`, label: "Orders", icon: Icon.cart }] : []),
    ...(can("catalog.manage") || can("inventory.view") ? [{ href: `${b}/products`, label: "Products", icon: Icon.box }, ...(can("catalog.manage") ? [{ href: `${b}/categories`, label: "Categories", icon: Icon.list }] : [])] : []),
    ...(can("branding.edit") && store.eff.get("F-016")?.enabled === true ? [{ href: `${b}/qr`, label: "Table QR", icon: Icon.list }] : []),
    ...(can("catalog.manage") ? [{ href: `${b}/content`, label: "Content", icon: Icon.globe }, { href: `${b}/inbox`, label: "Inbox", icon: Icon.users }] : []),
    ...(can("reports.view") ? [{ href: `${b}/reports`, label: "Reports", icon: Icon.list }] : []),
    ...(can("promotions.manage") ? [{ href: `${b}/discounts`, label: "Discounts", icon: Icon.tag }, { href: `${b}/promotions`, label: "Promotions", icon: Icon.tag }] : []),
    ...(can("branding.edit") ? [{ href: `${b}/setup`, label: "Store setup", icon: Icon.store }] : []),
    ...(can("settings.commerce") ? [{ href: `${b}/integrations`, label: "Integrations", icon: Icon.switch }] : []),
    ...(can("payments.manage") ? [{ href: `${b}/payments`, label: "Payments", icon: Icon.lock }] : []),
    ...(can("toggle.enable") ? [{ href: `${b}/features`, label: "Features", icon: Icon.switch }] : []),
    ...(can("branding.edit") ? [{ href: `${b}/settings`, label: "Settings", icon: Icon.store }] : []),
    ...(can("staff.manage") ? [{ href: `${b}/staff`, label: "Staff", icon: Icon.users }] : []),
    ...(can("activity.view") ? [{ href: `${b}/activity`, label: "Activity", icon: Icon.list }, { href: `${b}/emails`, label: "Messages", icon: Icon.list }] : []),
    ...(can("privacy.manage") ? [{ href: `${b}/privacy`, label: "Privacy", icon: Icon.shield }] : []),
    { href: `${b}/help`, label: "Help", icon: Icon.shield },
    { href: `/s/${sub}`, label: "View store", icon: Icon.globe },
  ];

  let banner: ReactNode = null;
  if (staff.impersonating) {
    // support sessions are fully logged, page by page (SRS 5.1)
    const path = (await headers()).get("x-pathname") ?? "";
    await appendAudit({ actorId: "support", actorRole: "super_admin", instanceId: store.ctx.instanceId, action: "impersonation.page", target: path.slice(0, 200), outcome: "success" }).catch(() => undefined);
    banner = (
      <div role="alert" className="bg-red-700 px-4 py-2 text-center text-sm font-semibold text-white">
        Support session: a platform administrator is signed in as the owner of {store.instance.name}. Password, email and two-factor settings are locked. The session ends automatically after 30 minutes.
      </div>
    );
  }

  return (
    <AppShell
      title="Store admin"
      brand={store.settings.branding.storeName || store.instance.name}
      userLabel={staff.user?.email ?? "Support session"}
      logout={logoutAction.bind(null, sub)}
      nav={nav}
      banner={banner}
    >
      {children}
    </AppShell>
  );
}
