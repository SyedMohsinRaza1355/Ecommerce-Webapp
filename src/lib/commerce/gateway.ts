import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// Mock payment gateway adapter (DEC-02). Card data never exists in this system; the
// "hosted page" only reports an outcome via a signed webhook, exactly like a real gateway.
export const SIGNATURE_TOLERANCE_SEC = 300;

function secret(): string {
  const base = process.env.GATEWAY_WEBHOOK_SECRET || env().sessionSecret;
  if (!base) throw new Error("Missing webhook secret");
  return createHmac("sha256", base).update("gateway-webhook-v1").digest("hex");
}

export function signBody(body: string, timestampSec: number): string {
  const sig = createHmac("sha256", secret()).update(`${timestampSec}.${body}`).digest("hex");
  return `t=${timestampSec},v1=${sig}`;
}

export function verifySignature(body: string, header: string | null | undefined, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const ts = Number(m[1]);
  if (Math.abs(nowSec - ts) > SIGNATURE_TOLERANCE_SEC) return false; // replay protection
  const expected = Buffer.from(createHmac("sha256", secret()).update(`${ts}.${body}`).digest("hex"), "hex");
  const given = Buffer.from(m[2], "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type GatewayEvent = {
  id: string;
  type: "payment.succeeded" | "payment.failed";
  intentRef: string;
  amountMinor: number;
  currency: string;
};
