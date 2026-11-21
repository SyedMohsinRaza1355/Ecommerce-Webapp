import { loadStore } from "@/lib/commerce/load";
import { isHex, readableTextOn } from "@/lib/color";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[<>&'"]/g, "");

/** Generated app icon in the store's brand colour with its first letter, used by the web app manifest. */
export async function GET(_req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") return new Response("Not found", { status: 404 });
  const bg = isHex(s.settings.branding.primary) ? s.settings.branding.primary : "#4f46e5";
  const letter = esc((s.settings.branding.storeName || s.instance.name).trim().slice(0, 1).toUpperCase() || "S");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${bg}"/><text x="256" y="350" font-family="Arial,sans-serif" font-size="300" font-weight="700" text-anchor="middle" fill="${readableTextOn(bg)}">${letter}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}
