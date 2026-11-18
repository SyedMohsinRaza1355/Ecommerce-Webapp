import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("reports phase 1 and database state", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.phase).toBe(1);
    expect(["ok", "unavailable", "not_configured"]).toContain(body.database);
    expect(res.status).toBe(body.database === "unavailable" ? 503 : 200);
  });
});
