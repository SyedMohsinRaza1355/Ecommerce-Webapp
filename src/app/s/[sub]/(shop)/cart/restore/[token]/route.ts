import { NextResponse } from "next/server";
import { loadStore } from "@/lib/commerce/load";
import { cartForRestore } from "@/lib/commerce/growth";
import { rateLimit } from "@/lib/auth/ratelimit";

export const dynamic = "force-dynamic";

/** The button in the "you left something in your cart" email: puts the saved cart back in this browser. */
export async function GET(req: Request, { params }: { params: Promise<{ sub: string; token: string }> }) {
  const { sub, token } = await params;
  const s = await loadStore(sub);
  const back = new URL(`/s/${sub}/cart`, req.url);
  if (s.status !== "ok" || s.eff.get("F-060")?.enabled !== true) return NextResponse.redirect(new URL(`/s/${sub}`, req.url));
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!(await rateLimit(`restore:${s.instance._id}:${ip}`, 20, 60_000)).ok) return NextResponse.redirect(back);
  const cartId = await cartForRestore(s.ctx, token);
  const res = NextResponse.redirect(back);
  if (cartId) res.cookies.set(`cart_${s.instance._id}`, cartId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 });
  return res;
}
