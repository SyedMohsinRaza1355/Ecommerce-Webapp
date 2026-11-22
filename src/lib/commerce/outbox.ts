import { randomUUID } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { htmlEmail, sendMail } from "@/lib/email/send";

// Transactional-outbox style delivery (SRS 13): events are stored first, then a worker
// sends with bounded exponential backoff and a dead-letter state. The "provider" is a
// simulated mailer that records messages so they can be inspected in the admin.
export type EmailType = "order.placed" | "order.paid" | "order.status" | "order.cancelled" | "order.refunded" | "support.signin"
  | "campaign" | "customer.welcome" | "customer.signin_link" | "customer.reset" | "contact.message" | "stock.low" | "newsletter.welcome" | "test.email";

type OutboxDoc = {
  _id: string;
  instanceId: string;
  type: EmailType;
  to: string;
  data: Record<string, unknown>;
  status: "pending" | "sent" | "dead";
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
  lastError?: string;
};

export const MAX_ATTEMPTS = 5;
export const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);

export async function enqueueEmail(ctx: TenantContext, type: EmailType, to: string, data: Record<string, unknown>): Promise<void> {
  if (!to) return;
  const db = await tenantDb(ctx);
  await db.collection<OutboxDoc>("outbox").insertOne({
    _id: randomUUID(), instanceId: ctx.instanceId, type, to, data, status: "pending", attempts: 0,
    nextAttemptAt: new Date(), createdAt: new Date(),
  });
}

export type Rendered = { subject: string; body: string; heading: string; paragraphs: string[]; button?: { label: string; url: string } };

export function renderEmail(type: EmailType, data: Record<string, unknown>): Rendered {
  const no = `#${data.orderNo ?? ""}`;
  const store = String(data.storeName ?? "Our store");
  const track = data.trackUrl ? { label: "Track your order", url: String(data.trackUrl) } : undefined;
  const mk = (subject: string, heading: string, paragraphs: string[], button?: { label: string; url: string }): Rendered => ({ subject, heading, paragraphs, button, body: [...paragraphs, button ? `${button.label}: ${button.url}` : ""].filter(Boolean).join(" ") });
  switch (type) {
    case "order.placed": return mk(`${store}: we received order ${no}`, `Thank you for your order ${no}`, [`Total: ${data.total}.`, ...(data.payTo ? [`Please pay to ${data.payTo} Use order ${no} as the reference, then enter your receipt number on the order page.`] : [])], track);
    case "order.paid": return mk(`${store}: payment received for order ${no}`, "Payment received", [`We received your payment for order ${no}.`], track);
    case "order.status": return mk(`${store}: order ${no} is now ${data.status}`, `Order ${no}: ${data.status}`, [`Your order ${no} is now "${data.status}".`], track);
    case "order.cancelled": return mk(`${store}: order ${no} was cancelled`, "Order cancelled", [`Your order ${no} was cancelled. If you paid, a refund will follow.`]);
    case "support.signin": return mk(`${store}: platform support signed in to your store`, "Support access", [`A platform administrator signed in to your store for support at ${data.at}. Reason: ${data.reason}.`, "The session lasts 30 minutes and cannot change your password, email or two-step settings."]);
    case "order.refunded": return mk(`${store}: refund for order ${no}`, "Refund issued", [`A refund of ${data.amount} was issued for order ${no}.`]);
    case "campaign": return mk(String(data.subject ?? `News from ${store}`), String(data.subject ?? `News from ${store}`), [...String(data.message ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), `To stop getting these emails, open: ${data.unsubscribeUrl}`]);
    case "customer.welcome": return mk(`Welcome to ${store}`, `Welcome, ${data.name ?? "friend"}`, ["Your account is ready. You can follow orders and save your delivery details."], data.url ? { label: "Open my account", url: String(data.url) } : undefined);
    case "customer.signin_link": return mk(`${store}: your sign-in link`, "Sign in without a password", ["Use this button to sign in. The link works once and expires in 15 minutes."], { label: "Sign in", url: String(data.url) });
    case "customer.reset": return mk(`${store}: reset your password`, "Reset your password", ["Use this button to choose a new password. The link works once and expires in 30 minutes. If you did not ask for this, ignore this email."], { label: "Choose a new password", url: String(data.url) });
    case "contact.message": return mk(`${store}: message from ${data.name}`, `New message from ${data.name}`, [`Email: ${data.email}`, String(data.message ?? "")]);
    case "stock.low": return mk(`${store}: low stock alert`, "Low stock", [String(data.summary ?? "Some products are running low.")]);
    case "newsletter.welcome": return mk(`${store}: you are subscribed`, "You are subscribed", ["Thanks for subscribing. You can unsubscribe at any time by replying to this email."]);
    case "test.email": return mk(`${store}: test email`, "Email is working", ["This is a test message. If you can read it, customers will receive your order emails."]);
  }
}

/** Sends due messages. `failFor` lets tests simulate a provider outage. */
export async function processOutbox(ctx: TenantContext, opts: { limit?: number; failFor?: (to: string) => boolean; now?: Date } = {}) {
  const db = await tenantDb(ctx);
  const now = opts.now ?? new Date();
  const settings = await db.collection<{ branding?: { primary?: string; storeName?: string }; contactEmail?: string }>("settings").findOne({ instanceId: ctx.instanceId });
  const due = await db.collection<OutboxDoc>("outbox")
    .find({ instanceId: ctx.instanceId, status: "pending", nextAttemptAt: { $lte: now } })
    .limit(opts.limit ?? 25).toArray();
  let sent = 0, failed = 0, dead = 0;
  for (const m of due) {
    // claim: only one worker may process a message at a time
    const claim = await db.collection<OutboxDoc>("outbox").findOneAndUpdate(
      { _id: m._id, instanceId: ctx.instanceId, status: "pending", attempts: m.attempts },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );
    if (!claim) continue;
    try {
      if (opts.failFor?.(m.to)) throw new Error("provider unavailable");
      const msg = renderEmail(m.type, m.data);
      const storeName = settings?.branding?.storeName || String(m.data.storeName ?? "Store");
      const out = await sendMail({
        to: m.to, subject: msg.subject, text: msg.body, fromName: storeName, replyTo: settings?.contactEmail || undefined,
        html: htmlEmail({ store: storeName, color: settings?.branding?.primary ?? "#4f46e5", heading: msg.heading, paragraphs: msg.paragraphs, button: msg.button }),
      });
      await db.collection("emails").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, outboxId: m._id, to: m.to, subject: msg.subject, body: msg.body, type: m.type, delivery: out.mode, providerId: out.id, sentAt: new Date() });
      await db.collection<OutboxDoc>("outbox").updateOne({ _id: m._id, instanceId: ctx.instanceId }, { $set: { status: "sent" } });
      sent++;
    } catch (e) {
      const attempts = claim.attempts;
      const isDead = attempts >= MAX_ATTEMPTS;
      await db.collection<OutboxDoc>("outbox").updateOne(
        { _id: m._id, instanceId: ctx.instanceId },
        { $set: { status: isDead ? "dead" : "pending", nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError: (e as Error).message } },
      );
      isDead ? dead++ : failed++;
    }
  }
  return { sent, failed, dead };
}
