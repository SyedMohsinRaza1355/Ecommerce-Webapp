// RFC 9116 security.txt so researchers know how to report vulnerabilities (ADD-044).
export const dynamic = "force-static";

export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const expires = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();
  const body = [
    "Contact: mailto:security@example.com",
    `Expires: ${expires}`,
    "Preferred-Languages: en, ur",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/privacy`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
}
