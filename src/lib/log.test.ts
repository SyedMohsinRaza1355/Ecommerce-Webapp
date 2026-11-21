import { describe, it, expect, vi, afterEach } from "vitest";
import { log } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("structured logging", () => {
  it("writes one JSON line and redacts secrets and card-like fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", "test_event", { status: 200, password: "hunter2", nested: { cardNumber: "4242424242424242", token: "abc" }, ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("4242");
    expect(line).not.toContain("abc");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "info", msg: "test_event", status: 200, ok: true, password: "[redacted]" });
    expect(typeof parsed.t).toBe("string");
  });
  it("sends errors to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log("error", "boom");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
