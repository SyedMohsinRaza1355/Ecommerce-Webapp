import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { parseHost } from "@/lib/tenant/host";
import { resolveHost } from "@/lib/tenant/resolve";
import { buildCsp, newNonce } from "@/lib/csp";

/**
 * Host-based tenant routing (SRS 8.1). The Host header is the only input: a store on
 * name.base-domain or a verified custom domain is rewritten to /s/<subdomain>/... so
 * every store page runs under one route tree. Client-supplied tenant headers are never read.
 */
export async function proxy(req: NextRequest) {
  const url = req.nextUrl.clone();
  const path = url.pathname;
  const headers = new Headers(req.headers);
  headers.delete("x-tenant-id");
  headers.delete("x-instance-id");
  headers.set("x-pathname", path);
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp); // Next reads the nonce from this request header
  const withCsp = <T extends Response>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  const storeFiles = ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest"];
  const passthrough = path.startsWith("/api/") || path.startsWith("/_next/") || (!storeFiles.includes(path) && /\.[a-z0-9]{2,5}$/i.test(path));
  const parsed = parseHost(req.headers.get("host"), env().baseDomain);

  if (!passthrough && (parsed.kind === "subdomain" || parsed.kind === "custom")) {
    let sub: string | null = null;
    if (parsed.kind === "subdomain") sub = parsed.subdomain;
    else {
      const r = await resolveHost(parsed.host);
      sub = r.type === "ok" ? r.instance.subdomain : null;
    }
    if (!sub || path.startsWith("/s/")) return withCsp(new NextResponse("Store not found", { status: 404, headers: { "content-type": "text/plain" } }));
    url.pathname = `/s/${sub}${path === "/" ? "" : path === "/sitemap.xml" ? "/sitemap" : path}`;
    return withCsp(NextResponse.rewrite(url, { request: { headers } }));
  }
  if (parsed.kind === "invalid") return withCsp(new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain" } }));
  return withCsp(NextResponse.next({ request: { headers } }));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
