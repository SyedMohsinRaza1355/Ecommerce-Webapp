import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { createProduct, getSettings, ProductInput } from "./store";
import { placeOrder, orders, refundOrder, expireUnpaidOrders, MANUAL_PAYMENT_WINDOW_MS, transitionOrder, type Features } from "./orders";
import { handleStripeWebhook, reconcileStripePayment, startStripePayment, reportManualPayment, confirmManualPayment } from "./payflow";
import { processOutbox } from "./outbox";
import {
  authenticateCustomer, registerCustomer, sendCustomerLink, consumeCustomerLink, resetPassword, deleteCustomerAccount, exportCustomerData, addAddress, toggleWishlist, ordersOf,
} from "./customers";
import { connectStripe, disconnectStripe, getPaymentConfig, upsertManual, checkoutMethods, validateManual, setTestMode, getStripeKey } from "@/lib/payments/config";
import { verifyStripeSignature } from "@/lib/payments/stripe";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto/secretbox";
import { fromHeader, htmlEmail, emailMode } from "@/lib/email/send";
import type { Actor } from "@/lib/auth/rbac";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const FEAT: Features = { shipping: true, freeShipping: true, tax: true, discounts: true, cod: true, card: true, emails: true, stockTracking: true, manualBank: true, wallet: true };
const cust = { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
const PLATFORM = `test_pay_${Math.random().toString(36).slice(2, 8)}`;
let n = 0;
const key = () => `idem-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;
const WHSEC = "whsec_test_secret_value_123";

function stripeSig(body: string, secret = WHSEC, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

describe("secret storage", () => {
  it("encrypts and decrypts, and tampering or truncation fails closed", () => {
    process.env.SESSION_SECRET ||= "x".repeat(40);
    const box = encryptSecret("sk_test_abcdefghijklmnopqrstuv");
    expect(box).not.toContain("sk_test");
    expect(decryptSecret(box)).toBe("sk_test_abcdefghijklmnopqrstuv");
    expect(encryptSecret("a")).not.toBe(encryptSecret("a")); // fresh nonce every time
    const parts = box.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    expect(() => decryptSecret("v1.a.b")).toThrow();
    expect(maskSecret("sk_live_abcdefghijklmnop1234")).toBe("sk_live_...1234");
  });
});

describe("Stripe signature verification", () => {
  const body = '{"id":"evt_1"}';
  it("accepts a correct signature and rejects wrong secret, tampered body, replay and junk", () => {
    expect(verifyStripeSignature(body, stripeSig(body), WHSEC)).toBe(true);
    expect(verifyStripeSignature(body, stripeSig(body, "whsec_other"), WHSEC)).toBe(false);
    expect(verifyStripeSignature(body + " ", stripeSig(body), WHSEC)).toBe(false);
    expect(verifyStripeSignature(body, stripeSig(body, WHSEC, Math.floor(Date.now() / 1000) - 3600), WHSEC)).toBe(false);
    for (const bad of [null, undefined, "", "garbage", "t=abc,v1=00", `t=${Math.floor(Date.now() / 1000)}`, "v1=" + "0".repeat(64)]) expect(verifyStripeSignature(body, bad as never, WHSEC)).toBe(false);
    expect(verifyStripeSignature(body, stripeSig(body), "")).toBe(false);
  });
  it("accepts when one of several v1 signatures matches (key rotation)", () => {
    const t = Math.floor(Date.now() / 1000);
    const good = stripeSig(body, WHSEC, t).split("v1=")[1];
    expect(verifyStripeSignature(body, `t=${t},v1=${"1".repeat(64)},v1=${good}`, WHSEC)).toBe(true);
  });
});

describe("checkout methods and manual validation", () => {
  const base = { testMode: false, stripe: null, manual: [] as never[] };
  const L = { card: "Card", cod: "COD" };
  it("hides card when no provider is connected and test mode is off", () => {
    expect(checkoutMethods(base, FEAT, L).map((m) => m.id)).toEqual(["cod"]);
    expect(checkoutMethods({ ...base, testMode: true }, FEAT, L).map((m) => m.id)).toEqual(["card", "cod"]);
    expect(checkoutMethods({ ...base, testMode: true }, { ...FEAT, card: false }, L).map((m) => m.id)).toEqual(["cod"]);
  });
  it("shows manual methods only when enabled and the matching feature is on", () => {
    const m = (id: string, kind: "bank" | "easypaisa", enabled = true) => ({ id, kind, label: kind, accountTitle: "A", accountNumber: "0300 1234567", instructions: "", enabled });
    const cfg = { ...base, manual: [m("b1", "bank"), m("e1", "easypaisa"), m("e2", "easypaisa", false)] };
    expect(checkoutMethods(cfg, FEAT, L).map((x) => x.id)).toEqual(["cod", "manual:b1", "manual:e1"]);
    expect(checkoutMethods(cfg, { ...FEAT, wallet: false }, L).map((x) => x.id)).toEqual(["cod", "manual:b1"]);
    expect(checkoutMethods(cfg, { ...FEAT, manualBank: false, wallet: false }, L).map((x) => x.id)).toEqual(["cod"]);
  });
  it("validates account details", () => {
    const ok = { kind: "bank" as const, accountTitle: "Ayesha", accountNumber: "PK36 SCBL 0000 0011", instructions: "" };
    expect(validateManual(ok)).toBeNull();
    expect(validateManual({ ...ok, accountTitle: "" })).toMatch(/holder/);
    expect(validateManual({ ...ok, accountNumber: "<script>" })).toMatch(/number/);
    expect(validateManual({ ...ok, instructions: "x".repeat(401) })).toMatch(/400/);
    expect(validateManual({ ...ok, kind: "crypto" as never })).toMatch(/type/);
  });
});

describe("email building", () => {
  it("escapes everything placed in the HTML and refuses non-http links", () => {
    const h = htmlEmail({ store: "<b>Evil</b> & Co", color: "red; background:url(x)", heading: "<img src=x onerror=alert(1)>", paragraphs: ['"quoted" <script>'], button: { label: "Go", url: "javascript:alert(1)" } });
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<img src=x");
    expect(h).not.toContain("javascript:");
    expect(h).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(h).toContain("#4f46e5"); // bad colour falls back
    expect(htmlEmail({ store: "S", color: "#112233", heading: "H", paragraphs: [], button: { label: "Go", url: "https://ok.example/a?b=1&c=2" } })).toContain("https://ok.example/a?b=1&amp;c=2");
  });
  it("sender name cannot inject headers and the mode follows configuration", () => {
    process.env.EMAIL_FROM = "orders@platform.test";
    const h = fromHeader(["Shop", "Bcc: x@y.z <evil>"].join(String.fromCharCode(13, 10)));
    expect(h).not.toMatch(/[\u000d\u000a]/);
    expect(h.split("<")).toHaveLength(2); // only our own address bracket
    expect(h.endsWith("<orders@platform.test>")).toBe(true);
    delete process.env.RESEND_API_KEY;
    expect(emailMode()).toBe("recorded");
    process.env.RESEND_API_KEY = "re_test";
    expect(emailMode()).toBe("live");
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });
});

describe.skipIf(!HAS_DB)("real payments, accounts and email delivery (Atlas, synthetic tenants)", () => {
  const created: string[] = [];
  let A: TenantContext, B: TenantContext, product: string;
  const oldBase = process.env.PLATFORM_BASE_DOMAIN;

  async function makeStore(sub: string) {
    const r = await provisionInstance(sa, { name: `Store ${sub}`, subdomain: sub, packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId);
    return issueTenantContext(r.instanceId);
  }
  const place = async (ctx: TenantContext, method: string, over: object = {}, feat = FEAT) =>
    placeOrder(ctx, await getSettings(ctx), feat, "Test Store", { items: [{ productId: product, qty: 1 }], customer: cust, method, idempotencyKey: key(), ...over });

  /** Routes the few Stripe endpoints we use to canned answers and records the calls. */
  function stubStripe(over: { refundFails?: boolean; sessionPaid?: { amount: number; currency: string }; accountStatus?: number } = {}) {
    const calls: { url: string; method: string; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = String(init.body ?? "");
      calls.push({ url, method: String(init.method ?? "GET"), body });
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
      if (url.endsWith("/v1/account")) return over.accountStatus && over.accountStatus !== 200 ? json({ error: { message: "Invalid API Key" } }, over.accountStatus) : json({ id: "acct_123", business_profile: { name: "Ayesha Bakers" } });
      if (url.endsWith("/v1/webhook_endpoints") && init.method === "POST") return json({ id: "we_1", secret: WHSEC });
      if (url.includes("/v1/webhook_endpoints/") && init.method === "DELETE") return json({ deleted: true });
      if (url.endsWith("/v1/checkout/sessions")) return json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
      if (url.includes("/v1/checkout/sessions/")) return json(over.sessionPaid ? { id: "cs_test_1", payment_status: "paid", status: "complete", amount_total: over.sessionPaid.amount, currency: over.sessionPaid.currency, payment_intent: "pi_real_1" } : { id: "cs_test_1", payment_status: "unpaid", status: "open", amount_total: 0, currency: "pkr", payment_intent: null });
      if (url.endsWith("/v1/refunds")) return over.refundFails ? json({ error: { message: "Charge already refunded" } }, 400) : json({ id: "re_1", status: "succeeded" });
      return json({ error: { message: "unexpected " + url } }, 500);
    }));
    return calls;
  }

  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    process.env.PLATFORM_BASE_DOMAIN = "shop.test";
    process.env.SESSION_SECRET ||= "y".repeat(40);
    A = await makeStore("pay-a");
    B = await makeStore("pay-b");
    const r = await createProduct(A, ProductInput.parse({ name: "Zinger", price: "450", stock: 200, status: "published", trackStock: true }), "PKR");
    if (!r.ok) throw new Error(r.error);
    product = r.id;
    await (await tenantDb(A)).collection("settings").updateOne({ instanceId: A.instanceId }, { $set: { taxBps: 0, shippingFlatMinor: 0 } });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    process.env.PLATFORM_BASE_DOMAIN = oldBase;
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  describe("connecting a Stripe account", () => {
    it("rejects junk, then connects with a valid key, encrypts it at rest and registers the webhook", async () => {
      const calls = stubStripe();
      expect(await connectStripe(A, "hello")).toMatchObject({ ok: false });
      expect(await connectStripe(A, "sk_test_short")).toMatchObject({ ok: false });
      expect(calls).toHaveLength(0); // nothing was sent to Stripe for obviously wrong keys
      const k = "sk_test_" + "a1B2c3D4e5F6g7H8i9J0k1L2";
      const r = await connectStripe(A, k);
      expect(r).toMatchObject({ ok: true, accountName: "Ayesha Bakers", livemode: false, webhook: "registered" });
      const raw = JSON.stringify(await (await tenantDb(A)).collection("payment_config").findOne({ instanceId: A.instanceId }));
      expect(raw).not.toContain(k);
      expect(raw).not.toContain(WHSEC);
      expect(await getStripeKey(A)).toBe(k);
      expect(calls.some((c) => c.url.endsWith("/webhook_endpoints") && c.body.includes(encodeURIComponent(`https://shop.test/api/webhooks/stripe/${A.instanceId}`)))).toBe(true);
      expect((await getPaymentConfig(A)).testMode).toBe(false);
    });
    it("explains a rejected key and never stores it", async () => {
      stubStripe({ accountStatus: 401 });
      const r = await connectStripe(B, "sk_live_" + "Z".repeat(24));
      expect(r).toMatchObject({ ok: false });
      expect(await getStripeKey(B)).toBeNull();
    });
    it("one store's key and settings are invisible to another store", async () => {
      expect(await getStripeKey(B)).toBeNull();
      expect((await getPaymentConfig(B)).stripe).toBeNull();
    });
  });

  describe("card payment through the owner's Stripe account", () => {
    it("places a stripe-provider order and opens a hosted payment page for the exact amount", async () => {
      const calls = stubStripe();
      const r = await place(A, "card");
      if (!r.ok) throw new Error(r.error);
      const o = (await orders.findById(A, r.orderId))!;
      expect(o.payment).toMatchObject({ method: "card", provider: "stripe", state: "requires_payment" });
      const s = await startStripePayment(A, r.orderId, "pay-a", r.trackingToken, "Store");
      expect(s).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_1" });
      const call = calls.find((c) => c.url.endsWith("/checkout/sessions"))!;
      expect(call.body).toContain(`unit_amount%5D=${o.totalMinor}`);
      expect(call.body).toContain("currency%5D=pkr");
      expect(call.body).toContain(`metadata%5BorderId%5D=${o._id}`);
      expect((await orders.findById(A, r.orderId))!.payment.stripe?.sessionId).toBe("cs_test_1");
    });

    const stripeOrder = async () => {
      stubStripe();
      const r = await place(A, "card");
      if (!r.ok) throw new Error(r.error);
      await startStripePayment(A, r.orderId, "pay-a", r.trackingToken, "Store");
      return { r, o: (await orders.findById(A, r.orderId))! };
    };
    const event = (type: string, o: { _id: string; totalMinor: number }, over: Record<string, unknown> = {}, id = `evt_${Math.random()}`) =>
      JSON.stringify({ id, type, data: { object: { id: "cs_test_1", payment_status: "paid", status: "complete", amount_total: o.totalMinor, currency: "pkr", payment_intent: "pi_real_1", metadata: { orderId: o._id }, ...over } } });
    const send = (body: string, sig = stripeSig(body), inst = A.instanceId) => handleStripeWebhook(inst, body, sig);

    it("a verified 'paid' event captures once and confirms the order", async () => {
      const { o } = await stripeOrder();
      const b = event("checkout.session.completed", o);
      expect((await send(b)).status).toBe(200);
      const paid = (await orders.findById(A, o._id))!;
      expect(paid).toMatchObject({ state: "confirmed", payment: { state: "captured", stripe: { paymentIntent: "pi_real_1" } } });
      expect((await send(b)).body).toEqual({ ok: true, duplicate: true });
      expect(paid.history.filter((h) => h.to === "captured")).toHaveLength(1);
    });
    it("rejects bad signatures, wrong secret, unknown stores and junk", async () => {
      const { o } = await stripeOrder();
      const b = event("checkout.session.completed", o);
      expect((await send(b, "t=1,v1=" + "0".repeat(64))).status).toBe(400);
      expect((await send(b, stripeSig(b, "whsec_attacker"))).status).toBe(400);
      expect((await send(b + " ", stripeSig(b))).status).toBe(400);
      expect((await send(b, stripeSig(b), "does-not-exist-1234")).status).toBe(404);
      expect((await send(b, stripeSig(b), "../etc/passwd")).status).toBe(404);
      expect((await send("not json", stripeSig("not json"))).status).toBe(400);
      expect((await send("{}", stripeSig("{}"))).status).toBe(400);
      expect((await orders.findById(A, o._id))!.payment.state).toBe("requires_payment");
    });
    it("a store with no Stripe secret rejects every webhook (even correctly signed ones)", async () => {
      const { o } = await stripeOrder();
      const b = event("checkout.session.completed", o);
      expect((await send(b, stripeSig(b), B.instanceId)).status).toBe(400);
    });
    it("amount or currency mismatch is flagged, not paid", async () => {
      const { o } = await stripeOrder();
      expect((await send(event("checkout.session.completed", o, { amount_total: 100 }))).status).toBe(422);
      expect((await send(event("checkout.session.completed", o, { currency: "usd" }))).status).toBe(422);
      const after = (await orders.findById(A, o._id))!;
      expect(after.payment.state).toBe("requires_payment");
      expect(after.flags).toMatchObject({ amountMismatch: true });
    });
    it("a session id that is not the order's own is ignored", async () => {
      const { o } = await stripeOrder();
      expect((await send(event("checkout.session.completed", o, { id: "cs_someone_else" }))).status).toBe(200);
      expect((await orders.findById(A, o._id))!.payment.state).toBe("requires_payment");
    });
    it("another store's order id in the metadata cannot be paid through this store", async () => {
      await place(B, "cod").then(() => undefined);
      const { o } = await stripeOrder();
      expect((await send(event("checkout.session.completed", { _id: "order-of-store-b", totalMinor: o.totalMinor }))).status).toBe(200);
    });
    it("unpaid-but-complete (delayed method) does not capture; expiry marks failed; events we did not ask for are ignored", async () => {
      const { o } = await stripeOrder();
      await send(event("checkout.session.completed", o, { payment_status: "unpaid" }));
      expect((await orders.findById(A, o._id))!.payment.state).toBe("requires_payment");
      expect((await send(JSON.stringify({ id: "evt_x", type: "charge.refunded", data: { object: { id: "ch_1" } } }))).status).toBe(200);
      await send(event("checkout.session.expired", o, { payment_status: "unpaid", status: "expired" }));
      expect((await orders.findById(A, o._id))!.payment.state).toBe("failed");
    });
    it("returning from Stripe confirms payment even when the webhook never arrives", async () => {
      const { o } = await stripeOrder();
      stubStripe({ sessionPaid: { amount: o.totalMinor, currency: "pkr" } });
      await reconcileStripePayment(A, o._id);
      expect((await orders.findById(A, o._id))!.payment).toMatchObject({ state: "captured" });
      await reconcileStripePayment(A, o._id); // harmless the second time
      expect((await orders.findById(A, o._id))!.history.filter((h) => h.to === "captured")).toHaveLength(1);
    });
    it("reconcile refuses a paid session whose amount does not match", async () => {
      const { o } = await stripeOrder();
      stubStripe({ sessionPaid: { amount: 1, currency: "pkr" } });
      await reconcileStripePayment(A, o._id);
      expect((await orders.findById(A, o._id))!.payment.state).toBe("requires_payment");
    });

    it("refunds go to Stripe first; a Stripe refusal leaves our records untouched", async () => {
      const { o } = await stripeOrder();
      await send(event("checkout.session.completed", o));
      const notify = { emails: false, storeName: "S" };
      const owner = { userId: "u", role: "store_owner" };
      stubStripe({ refundFails: true });
      const bad = await refundOrder(A, o._id, 1000, owner, key(), notify);
      expect(bad).toMatchObject({ ok: false });
      expect((await orders.findById(A, o._id))!.payment).toMatchObject({ refundedMinor: 0, state: "captured" });
      const calls = stubStripe();
      expect(await refundOrder(A, o._id, 1000, owner, key(), notify)).toEqual({ ok: true });
      expect(calls.find((c) => c.url.endsWith("/refunds"))!.body).toContain("payment_intent=pi_real_1");
      expect((await orders.findById(A, o._id))!.payment).toMatchObject({ refundedMinor: 1000, state: "partially_refunded" });
      expect(await refundOrder(A, o._id, o.totalMinor, owner, key(), notify)).toMatchObject({ ok: false }); // more than what is left
    });

    it("disconnecting removes the key and the webhook; checkout falls back to what is still available", async () => {
      const calls = stubStripe();
      await disconnectStripe(A);
      expect(await getStripeKey(A)).toBeNull();
      expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/webhook_endpoints/we_1"))).toBe(true);
      expect(await place(A, "card")).toMatchObject({ ok: false, code: "method" });
      await setTestMode(A, true);
      expect(await place(A, "card")).toMatchObject({ ok: true });
    });
  });

  describe("manual payments (Easypaisa, JazzCash, bank)", () => {
    let id: string;
    beforeAll(async () => {
      await upsertManual(A, { kind: "easypaisa", accountTitle: "Ayesha Khan", accountNumber: "0300 1234567", instructions: "Send the exact total", label: "Easypaisa" });
      id = (await getPaymentConfig(A)).manual[0].id;
    });
    it("the order waits for the owner: pending, unpaid, stock reserved, instructions snapshotted", async () => {
      const r = await place(A, `manual:${id}`);
      if (!r.ok) throw new Error(r.error);
      const o = (await orders.findById(A, r.orderId))!;
      expect(o).toMatchObject({ state: "pending", payment: { method: "manual", state: "requires_payment", manual: { label: "Easypaisa", accountNumber: "0300 1234567" } }, stockReserved: true });
      expect(r.needsPayment).toBe(true);
      await upsertManual(A, { id, kind: "easypaisa", accountTitle: "Someone Else", accountNumber: "0300 9999999", instructions: "" });
      expect((await orders.findById(A, r.orderId))!.payment.manual?.accountTitle).toBe("Ayesha Khan"); // later edits never rewrite an order
    });
    it("rejects unknown, hidden and feature-disabled methods", async () => {
      expect(await place(A, "manual:nope")).toMatchObject({ ok: false, code: "method" });
      expect(await place(A, `manual:${id}`, {}, { ...FEAT, wallet: false })).toMatchObject({ ok: false, code: "method" });
      expect(await place(A, "bitcoin")).toMatchObject({ ok: false, code: "method" });
      expect(await place(A, "manual:")).toMatchObject({ ok: false, code: "method" });
    });
    it("the customer reports a reference (validated); staff confirm; double confirm is refused", async () => {
      const r = await place(A, `manual:${id}`);
      if (!r.ok) throw new Error(r.error);
      for (const bad of ["", "ab", "<script>", "x".repeat(61)]) expect(await reportManualPayment(A, r.orderId, bad)).toMatchObject({ ok: false });
      expect(await reportManualPayment(A, r.orderId, "TXN 8841-22")).toEqual({ ok: true });
      expect((await orders.findById(A, r.orderId))!.payment.manual?.reference).toBe("TXN 8841-22");
      expect(await confirmManualPayment(A, r.orderId, { userId: "k", role: "kitchen_ops" })).toMatchObject({ ok: false });
      expect(await confirmManualPayment(A, r.orderId, { userId: "m", role: "manager" })).toEqual({ ok: true });
      expect((await orders.findById(A, r.orderId))!).toMatchObject({ state: "confirmed", payment: { state: "captured" } });
      expect(await confirmManualPayment(A, r.orderId, { userId: "m", role: "manager" })).toMatchObject({ ok: false });
      expect(await reportManualPayment(A, r.orderId, "TXN 1")).toMatchObject({ ok: false }); // already paid
    });
    it("cannot be confirmed by hand into 'confirmed' before payment, and a cancelled order cannot be marked paid", async () => {
      const r = await place(A, `manual:${id}`);
      if (!r.ok) throw new Error(r.error);
      expect(await transitionOrder(A, r.orderId, "confirmed", { userId: "u", role: "store_owner" }, { emails: false, storeName: "S" })).toMatchObject({ ok: false });
      await transitionOrder(A, r.orderId, "cancelled", { userId: "u", role: "store_owner" }, { emails: false, storeName: "S" });
      expect(await confirmManualPayment(A, r.orderId, { userId: "m", role: "manager" })).toMatchObject({ ok: false });
    });
    it("unpaid manual orders get 3 days, unlike the 30 minutes for card", async () => {
      const r = await place(A, `manual:${id}`);
      if (!r.ok) throw new Error(r.error);
      const soon = new Date(Date.now() + 2 * 60 * 60_000);
      await expireUnpaidOrders(A, 30 * 60_000, soon);
      expect((await orders.findById(A, r.orderId))!.state).toBe("pending");
      const later = new Date(Date.now() + MANUAL_PAYMENT_WINDOW_MS + 60_000);
      await expireUnpaidOrders(A, 30 * 60_000, later);
      expect((await orders.findById(A, r.orderId))!.state).toBe("cancelled");
    });
    it("the placed email carries the payment instructions", async () => {
      const r = await place(A, `manual:${id}`, { customer: { ...cust, email: "instr@example.com" } });
      if (!r.ok) throw new Error(r.error);
      await processOutbox(A);
      const mail = await (await tenantDb(A)).collection("emails").findOne({ to: "instr@example.com" });
      expect(mail?.body).toContain("0300 9999999");
      expect(mail?.delivery).toBe("recorded");
    });
  });

  describe("email delivery", () => {
    it("sends through the provider when configured, recording the provider id", async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      process.env.EMAIL_FROM = "orders@platform.test";
      const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).authorization) });
        return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
      }));
      const { enqueueEmail } = await import("./outbox");
      await enqueueEmail(A, "test.email", "real@customer.com", { storeName: "Store pay-a" });
      const r = await processOutbox(A);
      expect(r.sent).toBe(1);
      expect(calls[0].url).toBe("https://api.resend.com/emails");
      expect(calls[0].auth).toBe("Bearer re_test_key");
      expect(calls[0].body).toMatchObject({ to: ["real@customer.com"], subject: expect.stringContaining("test email") });
      expect(String(calls[0].body.from)).toContain("<orders@platform.test>");
      expect(String(calls[0].body.html)).toContain("<!doctype html>");
      const rec = await (await tenantDb(A)).collection("emails").findOne({ to: "real@customer.com" });
      expect(rec).toMatchObject({ delivery: "sent", providerId: "msg_1" });
    });
    it("a provider outage retries later instead of losing the message", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 })));
      const { enqueueEmail } = await import("./outbox");
      await enqueueEmail(A, "test.email", "retry@customer.com", { storeName: "S" });
      expect(await processOutbox(A)).toMatchObject({ sent: 0, failed: 1 });
      const row = await (await tenantDb(A)).collection("outbox").findOne({ to: "retry@customer.com" });
      expect(row).toMatchObject({ status: "pending", attempts: 1 });
      expect(String(row?.lastError)).toContain("500");
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
      vi.unstubAllGlobals();
    });
  });

  describe("customer accounts", () => {
    const reg = (ctx: TenantContext, email = "buyer@example.com", password = "Sup3rSecret99") => registerCustomer(ctx, { name: "Buyer One", email, password }, "1.2.3.4");
    it("registers, normalises the email, hashes the password, and refuses duplicates and weak passwords", async () => {
      const r = await reg(A, " Buyer@Example.COM ");
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(r.customer.email).toBe("buyer@example.com");
      expect(JSON.stringify(await (await tenantDb(A)).collection("customers").findOne({ _id: r.customer._id as never }))).not.toContain("Sup3rSecret99");
      expect(await reg(A, "buyer@example.com")).toMatchObject({ ok: false, error: expect.stringContaining("already") });
      expect(await reg(A, "x@example.com", "short")).toMatchObject({ ok: false });
      expect(await reg(A, "x@example.com", "alllettersnodigits")).toMatchObject({ ok: false });
      expect(await reg(A, "not-an-email")).toMatchObject({ ok: false });
      expect(await registerCustomer(A, { name: "", email: "y@example.com", password: "Sup3rSecret99" }, "1.2.3.4")).toMatchObject({ ok: false });
    });
    it("signs in with the right password only, and the same email in another store is a different account", async () => {
      expect(await authenticateCustomer(A, "buyer@example.com", "Sup3rSecret99", "9.9.9.1")).toMatchObject({ ok: true });
      expect(await authenticateCustomer(A, "buyer@example.com", "wrongpassword1", "9.9.9.2")).toMatchObject({ ok: false });
      expect(await authenticateCustomer(A, "nobody@example.com", "Sup3rSecret99", "9.9.9.3")).toMatchObject({ ok: false });
      expect(await authenticateCustomer(B, "buyer@example.com", "Sup3rSecret99", "9.9.9.4")).toMatchObject({ ok: false });
      expect(await reg(B)).toMatchObject({ ok: true });
    });
    it("throttles repeated wrong guesses", async () => {
      const results = [];
      for (let i = 0; i < 14; i++) results.push(await authenticateCustomer(A, "buyer@example.com", "badguess" + i, "7.7.7.7")); // 14 so a minute boundary cannot hide the limit
      expect(results.some((r) => !r.ok && "rateLimited" in r)).toBe(true);
    });

    const linkFrom = async (ctx: TenantContext, to: string, kind: string) => {
      const mail = await (await tenantDb(ctx)).collection("emails").find({ to, type: kind }).sort({ sentAt: -1 }).limit(1).next();
      return /\/account\/(?:reset|link)\/([A-Za-z0-9_-]+)/.exec(String(mail?.body))?.[1] ?? "";
    };
    it("password reset: link works once, expires, cannot be used for another purpose, and signs out old sessions", async () => {
      await sendCustomerLink(A, "buyer@example.com", "reset", "Store", "5.5.5.5");
      const tok = await linkFrom(A, "buyer@example.com", "customer.reset");
      expect(tok.length).toBeGreaterThan(30);
      expect(await consumeCustomerLink(A, tok, "signin")).toBeNull(); // wrong purpose: refused
      const c = await consumeCustomerLink(A, tok, "reset");
      expect(c).toMatchObject({ email: "buyer@example.com", emailVerified: true });
      expect(await consumeCustomerLink(A, tok, "reset")).toBeNull(); // single use
      expect(await resetPassword(A, c!._id, "weak")).toMatchObject({ ok: false });
      expect(await resetPassword(A, c!._id, "BrandNew#Pass77")).toEqual({ ok: true });
      expect(await authenticateCustomer(A, "buyer@example.com", "Sup3rSecret99", "5.5.5.7")).toMatchObject({ ok: false });
      expect(await authenticateCustomer(A, "buyer@example.com", "BrandNew#Pass77", "5.5.5.8")).toMatchObject({ ok: true });
    });
    it("expired and malformed tokens are refused", async () => {
      await sendCustomerLink(A, "buyer@example.com", "signin", "Store", "6.6.6.6");
      const tok = await linkFrom(A, "buyer@example.com", "customer.signin_link");
      await (await tenantDb(A)).collection("customer_tokens").updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await consumeCustomerLink(A, tok, "signin")).toBeNull();
      for (const junk of ["", "short", "../../x", "a".repeat(200), "%00"]) expect(await consumeCustomerLink(A, junk, "signin")).toBeNull();
    });
    it("asking for a link reveals nothing: unknown emails get no message and no error", async () => {
      const before = await (await tenantDb(A)).collection("outbox").countDocuments({ to: "ghost@example.com" });
      await sendCustomerLink(A, "ghost@example.com", "reset", "Store", "4.4.4.4");
      await sendCustomerLink(A, "not-an-email", "reset", "Store", "4.4.4.4");
      expect(await (await tenantDb(A)).collection("outbox").countDocuments({ to: "ghost@example.com" })).toBe(before);
    });
    it("a link from store A cannot sign anyone into store B", async () => {
      await sendCustomerLink(A, "buyer@example.com", "signin", "Store", "3.3.3.3");
      const tok = await linkFrom(A, "buyer@example.com", "customer.signin_link");
      expect(await consumeCustomerLink(B, tok, "signin")).toBeNull();
    });

    it("guest orders join the account only after the email is verified", async () => {
      await place(A, "cod", { customer: { ...cust, email: "newbie@example.com" } });
      const r = await reg(A, "newbie@example.com");
      if (!r.ok) throw new Error(r.error);
      expect(await ordersOf(A, r.customer)).toHaveLength(0); // someone could register with a stranger's email: no peeking at their orders
      await sendCustomerLink(A, "newbie@example.com", "signin", "Store", "2.2.2.2");
      const c = await consumeCustomerLink(A, await linkFrom(A, "newbie@example.com", "customer.signin_link"), "signin");
      expect(await ordersOf(A, c!)).toHaveLength(1);
    });
    it("orders placed while signed in are linked at once; addresses and wishlist are capped and private", async () => {
      const r = await reg(A, "linked@example.com");
      if (!r.ok) throw new Error(r.error);
      const o = await place(A, "cod", { customer: { ...cust, email: "linked@example.com" }, customerId: r.customer._id });
      expect(o.ok).toBe(true);
      expect(await ordersOf(A, r.customer)).toHaveLength(1);
      expect(await addAddress(A, r.customer._id, { label: "Home", address: "x", city: "L", phone: "" })).toMatchObject({ ok: false });
      for (let i = 0; i < 10; i++) expect(await addAddress(A, r.customer._id, { label: `H${i}`, address: "12 Main Street", city: "Lahore", phone: "" })).toEqual({ ok: true });
      expect(await addAddress(A, r.customer._id, { label: "11", address: "12 Main Street", city: "Lahore", phone: "" })).toMatchObject({ ok: false });
      expect(await toggleWishlist(A, r.customer._id, "p1")).toBe(true);
      expect(await toggleWishlist(A, r.customer._id, "p1")).toBe(false);
      expect(await toggleWishlist(B, r.customer._id, "p1")).toBe(false); // not their account in store B
    });
    it("export contains only their own data; deleting wipes the account and personal details on orders", async () => {
      const r = await reg(A, "gone@example.com");
      if (!r.ok) throw new Error(r.error);
      await place(A, "cod", { customer: { ...cust, email: "gone@example.com" }, customerId: r.customer._id });
      const exp = await exportCustomerData(A, r.customer);
      expect(exp.profile.email).toBe("gone@example.com");
      expect(JSON.stringify(exp)).not.toContain("passwordHash");
      expect(exp.orders).toHaveLength(1);
      await deleteCustomerAccount(A, r.customer);
      expect(await authenticateCustomer(A, "gone@example.com", "Sup3rSecret99", "8.8.8.8")).toMatchObject({ ok: false });
      const kept = (await orders.find(A, { "customer.name": "[deleted]" } as never, 10)).filter((x) => x.totalMinor > 0);
      expect(kept.length).toBeGreaterThanOrEqual(1);
      expect(await (await tenantDb(A)).collection("customers").countDocuments({ email: "gone@example.com" })).toBe(0);
    });
  });
});
