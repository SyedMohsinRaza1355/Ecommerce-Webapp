import { getActor } from "@/lib/auth/current";
import { authorize } from "@/lib/auth/rbac";
import { rateLimit } from "@/lib/auth/ratelimit";
import { validateSubdomain } from "@/lib/tenant/host";
import { subdomainAvailable, suggestSubdomains } from "@/lib/platform/provision";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await getActor();
  if (!authorize(actor, "instance.create").allow) return Response.json({ ok: false, reason: "Not allowed" }, { status: 403 });
  if (!rateLimit(`sub:${actor!.userId}`, 60, 60_000).ok) return Response.json({ ok: false, reason: "Slow down a little" }, { status: 429 });

  const name = (new URL(req.url).searchParams.get("name") ?? "").trim().toLowerCase();
  const v = validateSubdomain(name);
  if (!v.ok) return Response.json({ ok: false, reason: v.reason });
  if (!(await subdomainAvailable(name))) {
    return Response.json({ ok: false, reason: "That address is already taken.", suggestions: await suggestSubdomains(name) });
  }
  return Response.json({ ok: true });
}
