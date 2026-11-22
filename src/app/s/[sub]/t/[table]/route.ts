import { NextResponse } from "next/server";
import { loadStore } from "@/lib/commerce/load";

export const dynamic = "force-dynamic";

/** Table QR code target (F-016): remembers the table number for this visit, then opens the menu. */
export async function GET(req: Request, { params }: { params: Promise<{ sub: string; table: string }> }) {
  const { sub, table } = await params;
  const s = await loadStore(sub);
  const url = new URL(`/s/${sub}/products`, req.url);
  if (s.status !== "ok" || !/^[A-Za-z0-9-]{1,12}$/.test(table)) return NextResponse.redirect(new URL(`/s/${sub}`, req.url));
  const res = NextResponse.redirect(url);
  res.cookies.set(`tbl_${s.instance._id}`, table, { path: "/", maxAge: 60 * 60 * 6, sameSite: "lax" });
  return res;
}
