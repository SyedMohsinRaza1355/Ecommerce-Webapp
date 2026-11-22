import { notFound, redirect } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";

export const dynamic = "force-dynamic";

/** Only reached for addresses that match no real page: an owner-defined redirect (F-090) or a 404. */
export default async function Catch({ params }: { params: Promise<{ sub: string; rest: string[] }> }) {
  const { sub, rest } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  if (s.eff.get("F-090")?.enabled === true) {
    let path = "";
    try { path = "/" + rest.map((x) => decodeURIComponent(x)).join("/"); } catch { notFound(); }
    const hit = s.settings.redirects?.find((r) => r.from.toLowerCase() === path.toLowerCase());
    if (hit) redirect(hit.to.startsWith("/") ? `/s/${sub}${hit.to}` : hit.to);
  }
  notFound();
}
