import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s step) for staff two-factor sign-in (F-109).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

export const stepOf = (ms = Date.now()) => Math.floor(ms / 1000 / 30);

/** Returns the matching time step (for replay protection) or null. Allows one step of clock drift. */
export function verifyTotp(secretB32: string, code: string, ms = Date.now(), lastUsedStep = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = stepOf(ms);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastUsedStep) continue;
    const want = Buffer.from(hotp(secret, step));
    const got = Buffer.from(code);
    if (want.length === got.length && timingSafeEqual(want, got)) return step;
  }
  return null;
}

export const otpauthUrl = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
