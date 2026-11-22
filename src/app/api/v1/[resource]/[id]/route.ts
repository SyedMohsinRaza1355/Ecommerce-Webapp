import { authenticateApi, apiError, apiJson } from "@/lib/commerce/api";
import { orders } from "@/lib/commerce/orders";
import { orderPayload } from "@/lib/commerce/integrations";

export const dynamic = "force-dynamic";

/** GET /api/v1/orders/1001 : one order by its number. */
export async function GET(req: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const a = await authenticateApi(req);
  if (a instanceof Response) return a;
  if (resource !== "orders") return apiError(404, "not_found", "Only orders can be fetched one by one.");
  const no = Number(id);
  if (!Number.isInteger(no) || no < 1) return apiError(400, "bad_request", "Use the order number, for example 1001.");
  const o = (await orders.find(a.ctx, { orderNo: no } as never, 1))[0];
  return o ? apiJson({ data: { id: o._id, ...orderPayload(o) } }) : apiError(404, "not_found", "No order with that number.");
}
