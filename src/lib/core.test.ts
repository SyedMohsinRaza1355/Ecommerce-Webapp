import { describe, it, expect } from "vitest";
import { parseHost, validateSubdomain, normalizeHost } from "@/lib/tenant/host";
import { issueTenantContext, assertTenantContext, newInstanceId, dbNameFor } from "@/lib/tenant/context";
import { authorize, PERMISSIONS, ROLES, type Actor, type Role } from "@/lib/auth/rbac";
import { signSession, verifySession, isSessionRevoked } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { redact } from "@/lib/audit/log";
import { money, add, percentBps, parseMajor, formatMajor, multiply } from "@/lib/money/money";

describe("host parsing", () => {
  const base = "shop.example.com";
  it("normalises case, port and trailing dot", () => {
    expect(normalizeHost("DEMO.Shop.Example.com.:443")).toBe("demo.shop.example.com");
  });
  it("classifies platform, subdomain, custom and invalid", () => {
    expect(parseHost("shop.example.com", base)).toEqual({ kind: "platform" });
    expect(parseHost("demo-a.shop.example.com", base)).toEqual({ kind: "subdomain", subdomain: "demo-a" });
    expect(parseHost("www.shop.example.com", base)).toEqual({ kind: "platform" });
    expect(parseHost("store.brand.com", base)).toEqual({ kind: "custom", host: "store.brand.com" });
    expect(parseHost("a.b.shop.example.com", base)).toEqual({ kind: "invalid" });
    expect(parseHost("bad_host!.shop.example.com", base)).toEqual({ kind: "invalid" });
    expect(parseHost("", base)).toEqual({ kind: "invalid" });
  });
  it("works for localhost with ports", () => {
    expect(parseHost("demo-a.localhost:3000", "localhost:3000")).toEqual({ kind: "subdomain", subdomain: "demo-a" });
  });
  it("validates subdomain format and reserved names", () => {
    expect(validateSubdomain("good-name1").ok).toBe(true);
    for (const bad of ["ab", "-abc", "abc-", "a--bc", "UPPER", "has space", "x".repeat(31), "admin", "www", "staging"]) {
      expect(validateSubdomain(bad).ok).toBe(false);
    }
  });
});

describe("tenant context", () => {
  it("accepts issued contexts and rejects forged ones", () => {
    const ctx = issueTenantContext(newInstanceId());
    expect(() => assertTenantContext(ctx)).not.toThrow();
    expect(() => assertTenantContext({ instanceId: "abcdefghijkl", dbName: "tenant_abcdefghijkl" })).toThrow();
    expect(() => assertTenantContext(undefined)).toThrow();
    expect(Object.isFrozen(ctx)).toBe(true);
  });
  it("derives the database name from a validated id only", () => {
    expect(dbNameFor("abcdefghijkl")).toBe("tenant_abcdefghijkl");
    expect(() => dbNameFor("../admin")).toThrow();
    expect(newInstanceId()).toMatch(/^[a-z0-9]{12}$/);
  });
});

describe("RBAC matrix (SRS section 4)", () => {
  const ctxA = issueTenantContext("aaaaaaaaaaaa");
  const actor = (role: Role, instanceId: string | null = "aaaaaaaaaaaa"): Actor => ({ userId: "u1", role, instanceId });
  const allowedFor = (role: Role) =>
    Object.keys(PERMISSIONS).filter((a) => authorize(actor(role, role === "super_admin" ? null : "aaaaaaaaaaaa"), a, ctxA).allow).sort();

  it("matches the documented matrix for every role and every action", () => {
    expect(allowedFor("customer")).toEqual(["orders.own", "profile.own"]);
    expect(allowedFor("cashier")).toEqual(["orders.own", "orders.process", "orders.updateStatus", "pos.sell", "profile.own"]);
    expect(allowedFor("kitchen_ops")).toEqual(["inventory.view", "orders.own", "orders.updateStatus", "profile.own"]);
    expect(allowedFor("manager")).toEqual([
      "activity.view", "branding.edit", "catalog.manage", "inventory.view", "orders.own", "orders.process",
      "orders.updateStatus", "pos.sell", "profile.own", "promotions.manage", "reports.view",
    ]);
    const owner = allowedFor("store_owner");
    expect(owner).toContain("staff.manage");
    expect(owner).toContain("toggle.enable");
    for (const platformOnly of ["instance.create", "plan.set", "setting.lock", "owner.impersonate", "killswitch.set"]) {
      expect(owner).not.toContain(platformOnly);
    }
    expect(allowedFor("super_admin")).toHaveLength(Object.keys(PERMISSIONS).length);
  });
  it("denies unknown actions and unauthenticated callers", () => {
    expect(authorize(actor("super_admin", null), "do.anything", ctxA).allow).toBe(false);
    expect(authorize(null, "orders.own", ctxA).allow).toBe(false);
  });
  it("denies an owner of tenant B acting on tenant A", () => {
    const d = authorize(actor("store_owner", "bbbbbbbbbbbb"), "catalog.manage", ctxA);
    expect(d).toEqual({ allow: false, reason: "wrong_tenant" });
  });
  it("requires a tenant context for tenant actions", () => {
    expect(authorize(actor("store_owner"), "catalog.manage").allow).toBe(false);
  });
  it("blocks sensitive changes while impersonating", () => {
    const imp: Actor = { userId: "sa", role: "store_owner", instanceId: "aaaaaaaaaaaa", impersonating: true };
    expect(authorize(imp, "owner.password.change", ctxA).allow).toBe(false);
  });
  it("covers every role in the matrix", () => {
    expect(ROLES).toHaveLength(6);
  });
});

describe("sessions and passwords", () => {
  const secret = "x".repeat(40);
  it("round-trips a valid session", async () => {
    const t = await signSession({ userId: "u1", role: "manager", instanceId: "aaaaaaaaaaaa" }, secret);
    expect(await verifySession(t, secret)).toMatchObject({ userId: "u1", role: "manager", instanceId: "aaaaaaaaaaaa" });
  });
  it("rejects tampered, wrong-secret, expired and missing tokens", async () => {
    const t = await signSession({ userId: "u1", role: "manager", instanceId: null }, secret);
    expect(await verifySession(t + "x", secret)).toBeNull();
    expect(await verifySession(t, "y".repeat(40))).toBeNull();
    expect(await verifySession(undefined, secret)).toBeNull();
    const expired = await signSession({ userId: "u1", role: "manager", instanceId: null }, secret, -10);
    expect(await verifySession(expired, secret)).toBeNull();
  });
  it("refuses short secrets", async () => {
    await expect(signSession({ userId: "u", role: "customer", instanceId: null }, "short")).rejects.toThrow();
  });
  it("hashes and verifies passwords, enforcing strength", async () => {
    const h = await hashPassword("correct horse 42");
    expect(h).not.toContain("correct");
    expect(await verifyPassword("correct horse 42", h)).toBe(true);
    expect(await verifyPassword("wrong password 1", h)).toBe(false);
    await expect(hashPassword("short1")).rejects.toThrow();
  });
});

describe("session revocation", () => {
  it("revokes sessions issued before the valid-after moment, keeps later ones", () => {
    const after = new Date("2026-01-01T10:00:00Z");
    const t = Math.floor(after.getTime() / 1000);
    expect(isSessionRevoked(t - 1, after)).toBe(true);
    expect(isSessionRevoked(t, after)).toBe(false);
    expect(isSessionRevoked(t + 60, after)).toBe(false);
    expect(isSessionRevoked(undefined, after)).toBe(true);
    expect(isSessionRevoked(t - 9999, undefined)).toBe(false);
  });
  it("tokens carry an issue time", async () => {
    const t = await signSession({ userId: "u", role: "manager", instanceId: "aaaaaaaaaaaa" }, "x".repeat(40));
    const a = await verifySession(t, "x".repeat(40));
    expect(typeof a?.issuedAt).toBe("number");
  });
});

describe("audit redaction", () => {
  it("redacts secrets and card-like keys recursively", () => {
    const r = redact({ email: "a@b.c", password: "p", nested: { apiKey: "k", cardNumber: "4242", ok: 1 }, list: [{ token: "t" }] });
    expect(r).toEqual({ email: "a@b.c", password: "[redacted]", nested: { apiKey: "[redacted]", cardNumber: "[redacted]", ok: 1 }, list: [{ token: "[redacted]" }] });
  });
});

describe("money", () => {
  it("uses integer arithmetic with no float drift", () => {
    const a = parseMajor("0.10", "PKR");
    const b = parseMajor("0.20", "PKR");
    expect(add(a, b).minor).toBe(30);
    expect(formatMajor(add(a, b))).toBe("0.30");
    expect(multiply(parseMajor("19.99", "USD"), 3).minor).toBe(5997);
  });
  it("rounds percentages half away from zero", () => {
    expect(percentBps(money(1050, "PKR"), 1500).minor).toBe(158); // 157.5 -> 158
    expect(percentBps(money(-1050, "PKR"), 1500).minor).toBe(-158);
  });
  it("rejects floats, bad input and currency mismatch", () => {
    expect(() => money(1.5, "PKR")).toThrow();
    expect(() => parseMajor("1.234", "PKR")).toThrow();
    expect(() => add(money(1, "PKR"), money(1, "USD"))).toThrow();
    expect(formatMajor(money(500, "JPY"))).toBe("500");
  });
});

import { fmtDate, fmtMoney } from "@/lib/i18n";

describe("locale formatting", () => {
  it("shows dates in the store timezone regardless of the server clock zone", () => {
    expect(fmtDate("2026-11-21T21:30:00Z", "en", "Asia/Karachi")).toContain("22 Nov 2026");
    expect(fmtDate("2026-11-21T21:30:00Z", "en", "UTC")).toContain("21 Nov 2026");
  });
  it("formats money from minor units per currency exponent", () => {
    expect(fmtMoney(91050, "PKR", "en")).toMatch(/910\.50/);
    expect(fmtMoney(500, "JPY", "en")).toMatch(/500/);
    expect(fmtMoney(1234, "KWD", "en")).toMatch(/1\.234/);
  });
});
