import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("reports ok", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", phase: 0 });
  });
});
