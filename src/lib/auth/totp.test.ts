import { describe, it, expect } from "vitest";
import { base32Decode, base32Encode, hotp, newTotpSecret, verifyTotp, stepOf, otpauthUrl } from "./totp";

describe("TOTP (RFC 6238 / RFC 4226)", () => {
  const key = Buffer.from("12345678901234567890");
  it("matches the RFC 4226 HOTP test vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, i) => expect(hotp(key, i)).toBe(code));
  });
  it("matches RFC 6238 SHA-1 vectors (last 6 digits of the 8-digit values)", () => {
    expect(hotp(key, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(key, Math.floor(1111111109 / 30))).toBe("081804");
    expect(hotp(key, Math.floor(1234567890 / 30))).toBe("005924");
  });
  it("base32 round-trips", () => {
    for (let i = 0; i < 20; i++) {
      const s = newTotpSecret();
      expect(base32Encode(base32Decode(s))).toBe(s);
    }
    expect(base32Encode(Buffer.from("12345678901234567890"))).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(() => base32Decode("not base32!")).toThrow();
  });
  it("accepts the current code and one step of clock drift, rejects the rest", () => {
    const secret = newTotpSecret();
    const now = Date.now();
    const code = hotp(base32Decode(secret), stepOf(now));
    expect(verifyTotp(secret, code, now)).toBe(stepOf(now));
    expect(verifyTotp(secret, hotp(base32Decode(secret), stepOf(now) - 1), now)).toBe(stepOf(now) - 1);
    expect(verifyTotp(secret, hotp(base32Decode(secret), stepOf(now) - 3), now)).toBeNull();
    expect(verifyTotp(secret, hotp(base32Decode(secret), stepOf(now) + 3), now)).toBeNull();
  });
  it("a code can never be used twice (replay protection)", () => {
    const secret = newTotpSecret();
    const now = Date.now();
    const code = hotp(base32Decode(secret), stepOf(now));
    const step = verifyTotp(secret, code, now)!;
    expect(verifyTotp(secret, code, now, step)).toBeNull();
  });
  it("rejects malformed codes", () => {
    const secret = newTotpSecret();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345", "１２３４５６"]) expect(verifyTotp(secret, bad)).toBeNull();
  });
  it("builds an otpauth link with the issuer", () => {
    const u = otpauthUrl("ABC", "a@b.com", "My Shop");
    expect(u).toContain("otpauth://totp/My%20Shop:a%40b.com");
    expect(u).toContain("secret=ABC");
  });
});
