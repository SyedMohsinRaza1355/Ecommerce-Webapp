import { loadStore } from "@/lib/commerce/load";

export const dynamic = "force-dynamic";

/**
 * Minimal service worker (F-137): lets the storefront install and show an offline page.
 * It never caches carts, checkout, orders or admin pages, and never caches personal data.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-137")?.enabled === false) return new Response("Not found", { status: 404 });
  const script = `
const CACHE = "shell-v1-${sub}";
const OFFLINE = new Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Offline</title><body style='font-family:system-ui;text-align:center;padding:3rem'><h1>You are offline</h1><p>Check your connection and try again.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
const PRIVATE = /\\/(admin|cart|checkout|pay|order)(\\/|$)/;
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || PRIVATE.test(url.pathname) || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => OFFLINE.clone()));
  }
});
`;
  return new Response(script, { headers: { "content-type": "application/javascript; charset=utf-8", "service-worker-allowed": `/s/${sub}/`, "cache-control": "no-cache" } });
}
