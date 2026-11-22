import { randomUUID } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto/secretbox";
import { createWebhookEndpoint, deleteWebhookEndpoint, describeAccount, looksLikeStripeKey, StripeError } from "./stripe";

export type ManualKind = "bank" | "easypaisa" | "jazzcash" | "other";
export type ManualMethod = { id: string; kind: ManualKind; label: string; accountTitle: string; accountNumber: string; instructions: string; enabled: boolean };

export type PaymentConfig = {
  testMode: boolean;
  stripe: null | { keyEnc: string; keyHint: string; accountId: string; accountName: string; livemode: boolean; webhookId?: string; webhookSecretEnc?: string; webhookWarning?: string; connectedAt: Date };
  manual: ManualMethod[];
};

type Doc = Partial<PaymentConfig> & { _id: "config"; instanceId: string };

export const MANUAL_KIND_LABEL: Record<ManualKind, string> = { bank: "Bank transfer", easypaisa: "Easypaisa", jazzcash: "JazzCash", other: "Other" };

export async function getPaymentConfig(ctx: TenantContext): Promise<PaymentConfig> {
  const d = await (await tenantDb(ctx)).collection<Doc>("payment_config").findOne({ _id: "config", instanceId: ctx.instanceId });
  // new stores start with test payments on so the checkout works before a real account is connected
  return { testMode: d?.testMode ?? true, stripe: d?.stripe ?? null, manual: d?.manual ?? [] };
}

async function save(ctx: TenantContext, set: Record<string, unknown>, unset: string[] = []) {
  await (await tenantDb(ctx)).collection<Doc>("payment_config").updateOne(
    { _id: "config", instanceId: ctx.instanceId },
    { $set: set, ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, ""])) } : {}) } as never,
    { upsert: true },
  );
}

export async function setTestMode(ctx: TenantContext, on: boolean) {
  await save(ctx, { testMode: on });
}

export function webhookUrlFor(instanceId: string): string | null {
  const base = env().baseDomain;
  if (/^(localhost|127\.)/.test(base)) return null; // Stripe cannot reach a local machine
  return `https://${base}/api/webhooks/stripe/${instanceId}`;
}

export type ConnectResult = { ok: true; accountName: string; livemode: boolean; webhook: "registered" | "skipped" | "failed" } | { ok: false; error: string };

/** One paste: validate the key with Stripe, register the webhook in the owner's account, store everything encrypted. */
export async function connectStripe(ctx: TenantContext, rawKey: string): Promise<ConnectResult> {
  const key = rawKey.trim();
  if (!looksLikeStripeKey(key)) return { ok: false, error: "That does not look like a Stripe secret key. It starts with sk_test_ or sk_live_ (or rk_ for a restricted key)." };
  let acct;
  try {
    acct = await describeAccount(key);
  } catch (e) {
    if (e instanceof StripeError && e.status === 401) return { ok: false, error: "Stripe rejected this key. Copy it again from your Stripe dashboard (Developers, API keys)." };
    if (e instanceof StripeError) return { ok: false, error: `Stripe said: ${e.message}` };
    return { ok: false, error: "Could not reach Stripe. Check your internet connection and try again." };
  }
  const prev = await getPaymentConfig(ctx);
  if (prev.stripe?.webhookId) {
    try { await deleteWebhookEndpoint(decryptSecret(prev.stripe.keyEnc), prev.stripe.webhookId); } catch { /* old key may be gone */ }
  }
  let webhook: "registered" | "skipped" | "failed" = "skipped";
  let webhookId: string | undefined, webhookSecretEnc: string | undefined, webhookWarning: string | undefined;
  const url = webhookUrlFor(ctx.instanceId);
  if (url) {
    try {
      const w = await createWebhookEndpoint(key, url);
      webhookId = w.id; webhookSecretEnc = encryptSecret(w.secret); webhook = "registered";
    } catch (e) {
      webhook = "failed";
      webhookWarning = `Could not register the automatic payment notification: ${(e as Error).message}. Payments are still confirmed when the customer returns to your store.`;
    }
  } else {
    webhookWarning = "Running locally: payments are confirmed when the customer returns to the store.";
  }
  await save(ctx, {
    stripe: { keyEnc: encryptSecret(key), keyHint: maskSecret(key), accountId: acct.id, accountName: acct.name, livemode: acct.livemode, ...(webhookId ? { webhookId } : {}), ...(webhookSecretEnc ? { webhookSecretEnc } : {}), ...(webhookWarning ? { webhookWarning } : {}), connectedAt: new Date() },
    testMode: false, // a connected real account replaces the pretend gateway
  });
  return { ok: true, accountName: acct.name, livemode: acct.livemode, webhook };
}

export async function disconnectStripe(ctx: TenantContext): Promise<void> {
  const c = await getPaymentConfig(ctx);
  if (c.stripe?.webhookId) {
    try { await deleteWebhookEndpoint(decryptSecret(c.stripe.keyEnc), c.stripe.webhookId); } catch { /* best effort */ }
  }
  await save(ctx, {}, ["stripe"]);
}

export async function getStripeKey(ctx: TenantContext): Promise<string | null> {
  const c = await getPaymentConfig(ctx);
  return c.stripe ? decryptSecret(c.stripe.keyEnc) : null;
}

export async function getStripeWebhookSecret(ctx: TenantContext): Promise<string | null> {
  const c = await getPaymentConfig(ctx);
  return c.stripe?.webhookSecretEnc ? decryptSecret(c.stripe.webhookSecretEnc) : null;
}

export type ManualInput = { id?: string; kind: ManualKind; accountTitle: string; accountNumber: string; instructions: string; label?: string };

export function validateManual(i: ManualInput): string | null {
  if (!(i.kind in MANUAL_KIND_LABEL)) return "Choose a payment type.";
  if (i.accountTitle.trim().length < 2 || i.accountTitle.length > 80) return "Enter the account holder name.";
  if (!/^[A-Za-z0-9 +\-]{4,40}$/.test(i.accountNumber.trim())) return "Enter the account or phone number (letters, digits, spaces, + and - only).";
  if (i.instructions.length > 400) return "Instructions can be at most 400 characters.";
  return null;
}

export async function upsertManual(ctx: TenantContext, i: ManualInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const bad = validateManual(i);
  if (bad) return { ok: false, error: bad };
  const c = await getPaymentConfig(ctx);
  const m: ManualMethod = { id: i.id ?? randomUUID().slice(0, 8), kind: i.kind, label: (i.label?.trim() || MANUAL_KIND_LABEL[i.kind]).slice(0, 40), accountTitle: i.accountTitle.trim(), accountNumber: i.accountNumber.trim(), instructions: i.instructions.trim(), enabled: true };
  const list = c.manual.some((x) => x.id === m.id) ? c.manual.map((x) => (x.id === m.id ? { ...m, enabled: x.enabled } : x)) : [...c.manual, m];
  if (list.length > 6) return { ok: false, error: "You can add up to 6 manual payment methods." };
  await save(ctx, { manual: list });
  return { ok: true };
}

export async function setManualEnabled(ctx: TenantContext, id: string, enabled: boolean) {
  const c = await getPaymentConfig(ctx);
  await save(ctx, { manual: c.manual.map((m) => (m.id === id ? { ...m, enabled } : m)) });
}

export async function removeManual(ctx: TenantContext, id: string) {
  const c = await getPaymentConfig(ctx);
  await save(ctx, { manual: c.manual.filter((m) => m.id !== id) });
}

export type CheckoutMethod = { id: string; kind: "card" | "cod" | "manual"; label: string; hint?: string };

/** The payment options a customer sees: only things that can really take money for this store right now. */
export function checkoutMethods(cfg: PaymentConfig, feat: { card: boolean; cod: boolean; manualBank?: boolean; wallet?: boolean }, labels: { card: string; cod: string }): CheckoutMethod[] {
  const out: CheckoutMethod[] = [];
  if (feat.card && (cfg.stripe || cfg.testMode)) out.push({ id: "card", kind: "card", label: labels.card, hint: cfg.stripe ? undefined : "Test payment: no real money is used" });
  if (feat.cod) out.push({ id: "cod", kind: "cod", label: labels.cod });
  for (const m of cfg.manual) {
    if (!m.enabled) continue;
    if (m.kind === "bank" || m.kind === "other" ? !feat.manualBank : !feat.wallet) continue;
    out.push({ id: `manual:${m.id}`, kind: "manual", label: m.label, hint: "Pay by transfer, then we confirm" });
  }
  return out;
}
