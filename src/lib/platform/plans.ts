import { platformDb } from "@/lib/db/client";
import { TOGGLES } from "@/lib/toggles/catalog";
import { ensurePlatform } from "./setup";

export type Plan = {
  _id: string; // slug
  slug: string;
  name: string;
  includedToggles: string[];
  quotas: { staffSeats: number; skus: number; storageMb: number };
  defaults?: Record<string, boolean>;
};

const ids = (f: (t: (typeof TOGGLES)[number]) => boolean) => TOGGLES.filter(f).map((t) => t.id);

// Plan prices and limits are a business decision (D-6); these are editable starting values.
const STARTER_EXCLUDED = new Set(["F-089", "F-099", "F-100", "F-105", "F-104", "F-101", "F-142", "F-124", "F-125", "F-117", "F-123", "F-136", "F-066", "F-102", "F-143", "F-116", "F-082"]);
const GROWTH_EXCLUDED = new Set(["F-124", "F-125", "F-117", "F-136", "F-102"]);

export const DEFAULT_PLANS: Plan[] = [
  { _id: "starter", slug: "starter", name: "Starter", includedToggles: ids((t) => !STARTER_EXCLUDED.has(t.id)), quotas: { staffSeats: 1, skus: 100, storageMb: 500 } },
  { _id: "growth", slug: "growth", name: "Growth", includedToggles: ids((t) => !GROWTH_EXCLUDED.has(t.id)), quotas: { staffSeats: 5, skus: 2000, storageMb: 5000 } },
  { _id: "pro", slug: "pro", name: "Pro", includedToggles: ids(() => true), quotas: { staffSeats: 25, skus: 50000, storageMb: 50000 } },
];

export async function ensureDefaultPlans(): Promise<void> {
  await ensurePlatform();
  const col = (await platformDb()).collection<Plan>("plans");
  for (const p of DEFAULT_PLANS) await col.updateOne({ _id: p._id }, { $setOnInsert: p }, { upsert: true });
}

export async function listPlans(): Promise<Plan[]> {
  await ensureDefaultPlans();
  return (await platformDb()).collection<Plan>("plans").find({}).sort({ _id: 1 }).toArray();
}
