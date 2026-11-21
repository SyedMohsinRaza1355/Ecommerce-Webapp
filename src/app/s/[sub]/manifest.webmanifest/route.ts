import { loadStore } from "@/lib/commerce/load";
import { isHex } from "@/lib/color";

export const dynamic = "force-dynamic";

/** Web app manifest so the storefront is installable (F-137). */
export async function GET(_req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-137")?.enabled === false) return new Response("Not found", { status: 404 });
  const name = s.settings.branding.storeName || s.instance.name;
  const color = isHex(s.settings.branding.primary) ? s.settings.branding.primary : "#4f46e5";
  const icon = s.settings.branding.logoUrl;
  const body = {
    name, short_name: name.slice(0, 12), start_url: `/s/${sub}`, scope: `/s/${sub}/`, display: "standalone",
    background_color: "#ffffff", theme_color: color, lang: s.locale, dir: s.locale === "ur" ? "rtl" : "ltr",
    description: s.settings.branding.tagline || `Shop at ${name}`,
    icons: icon ? [{ src: icon, sizes: "192x192", type: "image/png", purpose: "any" }] : [],
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=300" } });
}
