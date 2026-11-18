import { env } from "@/lib/env";
import { getClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "unavailable" | "not_configured" = "not_configured";
  if (env().mongoUri) {
    try {
      await (await getClient()).db("admin").command({ ping: 1 });
      database = "ok";
    } catch {
      database = "unavailable";
    }
  }
  const status = database === "unavailable" ? 503 : 200;
  return Response.json({ status: database === "unavailable" ? "degraded" : "ok", phase: 1, database }, { status });
}
