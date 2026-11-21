import { randomUUID } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";

// Transactional-outbox style delivery (SRS 13): events are stored first, then a worker
// sends with bounded exponential backoff and a dead-letter state. The "provider" is a
// simulated mailer that records messages so they can be inspected in the admin.
export type EmailType = "order.placed" | "order.paid" | "order.status" | "order.cancelled" | "order.refunded" | "support.signin";

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

export function renderEmail(type: EmailType, data: Record<string, unknown>): { subject: string; body: string } {
  const no = `#${data.orderNo ?? ""}`;
  const store = String(data.storeName ?? "Our store");
  switch (type) {
    case "order.placed": return { subject: `${store}: we received order ${no}`, body: `Thank you for your order ${no}. Total: ${data.total}. You can follow it here: ${data.trackUrl}` };
    case "order.paid": return { subject: `${store}: payment received for order ${no}`, body: `We received your payment for order ${no}. Track it here: ${data.trackUrl}` };
    case "order.status": return { subject: `${store}: order ${no} is now ${data.status}`, body: `Your order ${no} is now "${data.status}". Track it here: ${data.trackUrl}` };
    case "order.cancelled": return { subject: `${store}: order ${no} was cancelled`, body: `Your order ${no} was cancelled. If you paid, a refund will follow.` };
    case "support.signin": return { subject: `${store}: platform support signed in to your store`, body: `A platform administrator signed in to your store for support at ${data.at}. Reason: ${data.reason}. The session lasts 30 minutes and cannot change your password, email or two-step settings.` };
    case "order.refunded": return { subject: `${store}: refund for order ${no}`, body: `A refund of ${data.amount} was issued for order ${no}.` };
  }
}

/** Sends due messages. `failFor` lets tests simulate a provider outage. */
export async function processOutbox(ctx: TenantContext, opts: { limit?: number; failFor?: (to: string) => boolean; now?: Date } = {}) {
  const db = await tenantDb(ctx);
  const now = opts.now ?? new Date();
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
      await db.collection("emails").insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, outboxId: m._id, to: m.to, ...msg, type: m.type, sentAt: new Date() });
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
