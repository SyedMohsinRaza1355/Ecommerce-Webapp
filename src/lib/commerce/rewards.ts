import { randomBytes, randomUUID } from "node:crypto";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import type { Order, Settings } from "./types";

// Customer rewards in one place: gift cards (F-044), store credit wallet (F-131), loyalty points (F-050),
// customer groups (F-049) and referrals (F-062). Gift cards, credit and points are all "balances" that are
// taken off an order's total (split payment, F-132); whatever is left is paid by the customer's chosen method.
export type RewardFeatures = { giftCards?: boolean; credit?: boolean; loyalty?: boolean; groups?: boolean };
export type Rewards = { giftCode?: string; giftMinor?: number; creditMinor?: number; points?: number; pointsMinor?: number; groupName?: string; groupMinor?: number; restored?: boolean };

export const DEFAULT_LOYALTY = { earnPer100: 5, pointMinor: 20 };
export const loyaltyOf = (s: Pick<Settings, "loyalty">) => ({ ...DEFAULT_LOYALTY, ...(s.loyalty ?? {}) });

const col = async (ctx: TenantContext, name: string) => (await tenantDb(ctx)).collection(name);
const cust = async (ctx: TenantContext) => (await tenantDb(ctx)).collection("customers");

// ---------------- gift cards ----------------
export type GiftCard = { _id: string; code: string; initialMinor: number; balanceMinor: number; note: string; active: boolean; expiresAt: Date | null; createdAt: Date };
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => { const b = randomBytes(8); const c = (i: number) => CODE_CHARS[b[i] % CODE_CHARS.length]; return `GC-${c(0)}${c(1)}${c(2)}${c(3)}-${c(4)}${c(5)}${c(6)}${c(7)}`; };
export const normaliseCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

export async function issueGiftCard(ctx: TenantContext, i: { amountMinor: number; note: string; expiresAt: string }, now = new Date()): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(i.amountMinor) || i.amountMinor < 100 || i.amountMinor > 100_000_000) return { ok: false, error: "Enter an amount for the card." };
  const expiresAt = i.expiresAt ? new Date(i.expiresAt) : null;
  if (expiresAt && (Number.isNaN(+expiresAt) || expiresAt <= now)) return { ok: false, error: "The expiry must be a future date." };
  const note = i.note.trim().slice(0, 80);
  const c = await col(ctx, "gift_cards");
  for (let n = 0; n < 5; n++) {
    const code = makeCode();
    try {
      await c.insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, code, initialMinor: i.amountMinor, balanceMinor: i.amountMinor, note, active: true, expiresAt, createdAt: now });
      return { ok: true, code };
    } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
  }
  return { ok: false, error: "Could not make a unique code. Try again." };
}
export async function listGiftCards(ctx: TenantContext): Promise<GiftCard[]> {
  return (await (await col(ctx, "gift_cards")).find({ instanceId: ctx.instanceId } as never).sort({ createdAt: -1 }).limit(200).toArray()) as unknown as GiftCard[];
}
export async function setGiftCardActive(ctx: TenantContext, id: string, active: boolean) {
  await (await col(ctx, "gift_cards")).updateOne({ _id: id as never, instanceId: ctx.instanceId }, { $set: { active } });
}
/** What a code is worth right now (0 if unknown, switched off or expired). The same answer for every bad code. */
export async function giftCardBalance(ctx: TenantContext, raw: string, now = new Date()): Promise<{ code: string; balanceMinor: number } | null> {
  const code = normaliseCode(raw);
  if (!/^GC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return null;
  const g = await (await col(ctx, "gift_cards")).findOne({ instanceId: ctx.instanceId, code, active: true } as never) as GiftCard | null;
  if (!g || g.balanceMinor <= 0 || (g.expiresAt && g.expiresAt <= now)) return null;
  return { code, balanceMinor: g.balanceMinor };
}

// ---------------- groups ----------------
export async function groupDiscountMinor(ctx: TenantContext, settings: Settings, customerId: string | undefined, baseMinor: number): Promise<{ name: string; minor: number } | null> {
  if (!customerId || baseMinor <= 0) return null;
  const c = await (await cust(ctx)).findOne({ _id: customerId as never, instanceId: ctx.instanceId }, { projection: { groupId: 1 } }) as { groupId?: string } | null;
  const g = c?.groupId ? (settings.groups ?? []).find((x) => x.id === c.groupId) : undefined;
  if (!g || g.percentBps <= 0) return null;
  return { name: g.name, minor: Math.min(Math.round((baseMinor * g.percentBps) / 10000), baseMinor) };
}

// ---------------- customer balances ----------------
export type Balances = { creditMinor: number; points: number; groupName?: string; referralCode: string };
export async function balancesOf(ctx: TenantContext, customerId: string): Promise<Balances> {
  const c = await (await cust(ctx)).findOne({ _id: customerId as never, instanceId: ctx.instanceId }) as { creditMinor?: number; points?: number; groupId?: string; referralCode?: string } | null;
  return { creditMinor: Math.max(c?.creditMinor ?? 0, 0), points: Math.max(c?.points ?? 0, 0), referralCode: c?.referralCode ?? "" };
}
export async function ensureReferralCode(ctx: TenantContext, customerId: string): Promise<string> {
  const c = await cust(ctx);
  const cur = await c.findOne({ _id: customerId as never, instanceId: ctx.instanceId }, { projection: { referralCode: 1 } }) as { referralCode?: string } | null;
  if (cur?.referralCode) return cur.referralCode;
  for (let n = 0; n < 5; n++) {
    const code = `FRIEND-${randomBytes(3).toString("hex").toUpperCase()}`;
    const r = await c.updateOne({ _id: customerId as never, instanceId: ctx.instanceId, referralCode: { $exists: false } }, { $set: { referralCode: code } });
    if (r.modifiedCount) return code;
    const again = await c.findOne({ _id: customerId as never, instanceId: ctx.instanceId }, { projection: { referralCode: 1 } }) as { referralCode?: string } | null;
    if (again?.referralCode) return again.referralCode;
  }
  return "";
}

type Entry = { customerId: string; kind: "credit" | "points"; delta: number; reason: string };
async function log(ctx: TenantContext, e: Entry, at = new Date()) {
  await (await col(ctx, "reward_ledger")).insertOne({ _id: randomUUID() as never, instanceId: ctx.instanceId, ...e, at });
}
export async function ledgerOf(ctx: TenantContext, customerId: string, limit = 20) {
  return (await (await col(ctx, "reward_ledger")).find({ instanceId: ctx.instanceId, customerId } as never).sort({ at: -1 }).limit(limit).toArray()) as unknown as (Entry & { at: Date })[];
}

export async function grantCredit(ctx: TenantContext, customerId: string, amountMinor: number, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0 || Math.abs(amountMinor) > 100_000_000) return { ok: false, error: "Enter an amount." };
  const filter: Record<string, unknown> = { _id: customerId, instanceId: ctx.instanceId };
  if (amountMinor < 0) filter.creditMinor = { $gte: -amountMinor };
  const r = await (await cust(ctx)).updateOne(filter as never, { $inc: { creditMinor: amountMinor } });
  if (!r.matchedCount) return { ok: false, error: amountMinor < 0 ? "The customer does not have that much credit." : "Customer not found." };
  await log(ctx, { customerId, kind: "credit", delta: amountMinor, reason: reason.trim().slice(0, 80) || (amountMinor > 0 ? "Added by the store" : "Removed by the store") });
  return { ok: true };
}
export async function setCustomerGroup(ctx: TenantContext, customerId: string, groupId: string) {
  const c = await cust(ctx);
  if (groupId) await c.updateOne({ _id: customerId as never, instanceId: ctx.instanceId }, { $set: { groupId } });
  else await c.updateOne({ _id: customerId as never, instanceId: ctx.instanceId }, { $unset: { groupId: "" } });
}

// ---------------- using balances on an order ----------------
export type BalanceRequest = { giftCode?: string; useCredit?: boolean; usePoints?: boolean; customerId?: string };

/** Takes gift card, credit and points off `totalMinor` in that order, each with an atomic "only if enough is left" update. */
export async function applyBalances(ctx: TenantContext, settings: Settings, on: RewardFeatures, req: BalanceRequest, totalMinor: number, now = new Date()): Promise<{ ok: true; rewards: Rewards; usedMinor: number } | { ok: false; error: string }> {
  const rewards: Rewards = {};
  let left = totalMinor;
  const undo = async () => { await restoreBalances(ctx, { ...rewards }, req.customerId); };
  if (req.giftCode?.trim()) {
    if (!on.giftCards) return { ok: false, error: "Gift cards are not accepted here." };
    const g = await giftCardBalance(ctx, req.giftCode, now);
    if (!g) return { ok: false, error: "That gift card is not valid or has no balance left." };
    const use = Math.min(g.balanceMinor, left);
    if (use > 0) {
      const r = await (await col(ctx, "gift_cards")).updateOne({ instanceId: ctx.instanceId, code: g.code, active: true, balanceMinor: { $gte: use } } as never, { $inc: { balanceMinor: -use } });
      if (r.matchedCount !== 1) return { ok: false, error: "That gift card was just used. Check its balance and try again." };
      rewards.giftCode = g.code; rewards.giftMinor = use; left -= use;
    }
  }
  if (req.useCredit && on.credit && req.customerId && left > 0) {
    const have = (await balancesOf(ctx, req.customerId)).creditMinor;
    const use = Math.min(have, left);
    if (use > 0) {
      const r = await (await cust(ctx)).updateOne({ _id: req.customerId as never, instanceId: ctx.instanceId, creditMinor: { $gte: use } }, { $inc: { creditMinor: -use } });
      if (r.matchedCount !== 1) { await undo(); return { ok: false, error: "Your store credit changed. Please try again." }; }
      rewards.creditMinor = use; left -= use;
    }
  }
  if (req.usePoints && on.loyalty && req.customerId && left > 0) {
    const L = loyaltyOf(settings);
    const have = (await balancesOf(ctx, req.customerId)).points;
    const pts = Math.min(have, Math.ceil(left / L.pointMinor));
    if (pts > 0) {
      const value = Math.min(pts * L.pointMinor, left);
      const r = await (await cust(ctx)).updateOne({ _id: req.customerId as never, instanceId: ctx.instanceId, points: { $gte: pts } }, { $inc: { points: -pts } });
      if (r.matchedCount !== 1) { await undo(); return { ok: false, error: "Your points changed. Please try again." }; }
      rewards.points = pts; rewards.pointsMinor = value; left -= value;
    }
  }
  return { ok: true, rewards, usedMinor: totalMinor - left };
}

/** Puts balances back (an order that failed to save, or was cancelled). Safe to call once per order. */
export async function restoreBalances(ctx: TenantContext, r: Rewards, customerId?: string): Promise<void> {
  if (r.giftCode && r.giftMinor) await (await col(ctx, "gift_cards")).updateOne({ instanceId: ctx.instanceId, code: r.giftCode }, { $inc: { balanceMinor: r.giftMinor } });
  if (customerId && (r.creditMinor || r.points)) await (await cust(ctx)).updateOne({ _id: customerId as never, instanceId: ctx.instanceId }, { $inc: { creditMinor: r.creditMinor ?? 0, points: r.points ?? 0 } });
  if (customerId && r.creditMinor) await log(ctx, { customerId, kind: "credit", delta: r.creditMinor, reason: "Returned from a cancelled order" });
  if (customerId && r.points) await log(ctx, { customerId, kind: "points", delta: r.points, reason: "Returned from a cancelled order" });
}

/** On cancellation: give the balances back exactly once. */
export async function restoreOrderRewards(ctx: TenantContext, order: Pick<Order, "_id" | "rewards" | "customerId">): Promise<void> {
  if (!order.rewards || (!order.rewards.giftMinor && !order.rewards.creditMinor && !order.rewards.points)) return;
  const c = (await tenantDb(ctx)).collection("orders");
  const flipped = await c.updateOne({ _id: order._id as never, instanceId: ctx.instanceId, "rewards.restored": { $ne: true } }, { $set: { "rewards.restored": true } });
  if (flipped.modifiedCount) await restoreBalances(ctx, order.rewards, order.customerId);
}

// ---------------- earning ----------------
/** When an order is completed: points for the customer and, on a first order, a referral reward for the friend who invited them. Once per order. */
export async function awardOnCompletion(ctx: TenantContext, settings: Settings, on: RewardFeatures & { referral?: boolean }, order: Order): Promise<void> {
  if (!order.customerId) return;
  const c = (await tenantDb(ctx)).collection("orders");
  const mark = await c.updateOne({ _id: order._id as never, instanceId: ctx.instanceId, rewardsAwarded: { $ne: true } }, { $set: { rewardsAwarded: true } });
  if (!mark.modifiedCount) return;
  if (on.loyalty) {
    const L = loyaltyOf(settings);
    const paid = Math.max(order.totalMinor - (order.payment.refundedMinor ?? 0), 0);
    const pts = Math.floor((paid / 10000) * L.earnPer100);
    if (pts > 0) {
      await (await cust(ctx)).updateOne({ _id: order.customerId as never, instanceId: ctx.instanceId }, { $inc: { points: pts } });
      await log(ctx, { customerId: order.customerId, kind: "points", delta: pts, reason: `Order #${order.orderNo}` });
    }
  }
  if (on.credit && settings.referral?.rewardMinor) {
    const me = await (await cust(ctx)).findOne({ _id: order.customerId as never, instanceId: ctx.instanceId }, { projection: { referredBy: 1, referralPaid: 1 } }) as { referredBy?: string; referralPaid?: boolean } | null;
    if (me?.referredBy && !me.referralPaid) {
      const flip = await (await cust(ctx)).updateOne({ _id: order.customerId as never, instanceId: ctx.instanceId, referralPaid: { $ne: true } }, { $set: { referralPaid: true } });
      if (flip.modifiedCount) await grantCredit(ctx, me.referredBy, settings.referral.rewardMinor, "A friend you invited placed their first order");
    }
  }
}

/** A new account that used a friend's code gets a welcome credit and remembers who invited them. */
export async function applyReferral(ctx: TenantContext, settings: Settings, newCustomerId: string, codeRaw: string): Promise<void> {
  const code = codeRaw.trim().toUpperCase();
  if (!code || !settings.referral?.rewardMinor) return;
  const friend = await (await cust(ctx)).findOne({ instanceId: ctx.instanceId, referralCode: code }, { projection: { _id: 1 } }) as { _id: string } | null;
  if (!friend || String(friend._id) === newCustomerId) return;
  const set = await (await cust(ctx)).updateOne({ _id: newCustomerId as never, instanceId: ctx.instanceId, referredBy: { $exists: false } }, { $set: { referredBy: String(friend._id) } });
  if (!set.modifiedCount) return;
  await grantCredit(ctx, newCustomerId, settings.referral.rewardMinor, "Welcome gift from a friend's invitation");
}
