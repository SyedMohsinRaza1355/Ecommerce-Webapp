import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { dirOf, t } from "@/lib/i18n";
import { readableTextOn, isHex, autoFixBrand } from "@/lib/color";
import { Icon } from "@/components/Icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") return { title: "Store" };
  return {
    title: { default: s.settings.branding.storeName || s.instance.name, template: `%s | ${s.settings.branding.storeName || s.instance.name}` },
    description: s.settings.branding.tagline || `Shop at ${s.instance.name}`,
    manifest: `/s/${sub}/manifest.webmanifest`,
  };
}

export default async function StoreLayout({ children, params }: { children: ReactNode; params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const store = await loadStore(sub);
  if (store.status === "not_found") notFound();
  if (store.status === "suspended") {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
        <div className="icon-chip pop-in">{Icon.lock}</div>
        <h1 className="mt-5 text-2xl font-bold">{store.name}</h1>
        <p className="mt-3 text-muted">{t("en", "storeSuspended")}</p>
      </main>
    );
  }
  // brand colour guard (F-139): never render text that fails WCAG AA on the brand colour
  let primary = isHex(store.settings.branding.primary) ? store.settings.branding.primary : "#4f46e5";
  if (store.eff.get("F-075")?.enabled === false) primary = "#4f46e5";
  const on = readableTextOn(primary);
  const hover = autoFixBrand(primary) === primary ? primary : autoFixBrand(primary);
  return (
    <div
      className="store-theme min-h-screen"
      lang={store.locale}
      dir={dirOf(store.locale)}
      style={{ ["--brand-primary" as string]: primary, ["--brand-on-primary" as string]: on, ["--brand-primary-hover" as string]: hover }}
    >
      {children}
    </div>
  );
}
