import { loadStore } from "@/lib/commerce/load";
import { currentCustomer, exportCustomerData } from "@/lib/commerce/customers";

export const dynamic = "force-dynamic";

/** Self-service data export (F-051): a signed-in shopper downloads their own data as JSON. */
export async function GET(_req: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-051")?.enabled === false) return new Response("Not found", { status: 404 });
  const c = await currentCustomer(s);
  if (!c) return new Response("Sign in first", { status: 401 });
  return new Response(JSON.stringify(await exportCustomerData(s.ctx, c), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="my-data.json"', "cache-control": "no-store" },
  });
}
