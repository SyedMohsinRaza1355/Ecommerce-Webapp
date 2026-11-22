import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// AES-256-GCM for secrets a store owner gives us (payment API keys). The key is derived from a
// server secret that is never stored with the data, so a database leak alone does not reveal them.
function key(): Buffer {
  const base = process.env.ENCRYPTION_KEY || env().sessionSecret;
  if (!base || base.length < 32) throw new Error("Missing encryption secret");
  return Buffer.from(hkdfSync("sha256", base, "storeforge", "secretbox-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(box: string): string {
  const [v, iv, tag, data] = box.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Bad secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

/** "sk_live_abc...wxyz" -> "sk_live_...wxyz" for display. */
export function maskSecret(s: string): string {
  return s.length <= 12 ? "..." : `${s.slice(0, 8)}...${s.slice(-4)}`;
}
