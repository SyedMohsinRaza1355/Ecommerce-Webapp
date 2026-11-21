import { describe, it, expect } from "vitest";
import { buildCsp, newNonce } from "./csp";

describe("content security policy", () => {
  it("nonces are unique per call and base64", () => {
    const a = newNonce(), b = newNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
  it("production policy has no unsafe-inline or unsafe-eval for scripts and forbids framing and plugins", () => {
    const csp = buildCsp("abc", false);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"]) expect(csp).toContain(d);
  });
  it("development adds eval only for the dev tooling", () => {
    expect(buildCsp("abc", true)).toContain("'unsafe-eval'");
  });
});
