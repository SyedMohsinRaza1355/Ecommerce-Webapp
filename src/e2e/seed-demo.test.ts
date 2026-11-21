import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { getClient, closeClient, platformDb } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { hashPassword } from "@/lib/auth/password";
import { users } from "@/lib/commerce/staff";
import { createProduct, ProductInput } from "@/lib/commerce/store";
import { setOwnerFeature } from "@/lib/commerce/features";
import { ensurePlatform } from "@/lib/platform/setup";
import type { InstanceRecord } from "@/lib/tenant/resolve";

// One-off helper: SEED_DEMO=1 PLATFORM_DB_NAME=platform npx vitest run src/e2e/seed-demo.test.ts
// Creates a ready-to-browse demo store. Credentials go to a git-ignored file, never to the console.
describe.skipIf(process.env.SEED_DEMO !== "1")("seed demo store", () => {
  it("creates the demo store, owner, catalogue and discount (idempotent)", async () => {
    await ensurePlatform();
    const db = await platformDb();
    let inst = await db.collection<InstanceRecord>("instances").findOne({ subdomain: "demo" });
    let password = "";
    if (!inst) {
      const r = await provisionInstance({ userId: "seed", role: "super_admin", instanceId: null }, { name: "Demo Burgers", subdomain: "demo", packId: "restaurant", planId: "pro", ownerEmail: "owner@demo.test" });
      if (!r.ok) throw new Error(r.message);
      inst = (await db.collection<InstanceRecord>("instances").findOne({ _id: r.instanceId as never }))!;
      const ctx = issueTenantContext(inst._id);
      password = `Demo-${randomBytes(6).toString("hex")}-9`;
      await users.insert(ctx, { _id: randomUUID(), email: "owner@demo.test", passwordHash: await hashPassword(password), role: "store_owner", createdAt: new Date() } as never);
      const t = await tenantDb(ctx);
      await t.collection("settings").updateOne({ instanceId: inst._id }, { $set: { currency: "PKR", taxBps: 1700, shippingFlatMinor: 15000, freeShippingOverMinor: 200000, contactEmail: "hello@demo.test", "branding.tagline": "Crispy, juicy and fast", "branding.primary": "#c2410c" } });
      const mk = async (name: string, price: string, stock: number, categoryId: string, description: string, extra: Record<string, unknown> = {}) => {
        const res = await createProduct(ctx, ProductInput.parse({ name, price, stock, categoryId, description, status: "published", trackStock: true, ...extra }), "PKR");
        if (!res.ok) throw new Error(res.error);
      };
      await mk("Zinger Burger", "450", 40, "cat-1", "Crispy fried chicken fillet, lettuce and our signature sauce in a toasted bun.");
      await mk("Double Smash Burger", "690", 25, "cat-1", "Two smashed beef patties, cheddar, pickles and burger sauce.", { compareAt: "790" });
      await mk("Crispy Fries", "150", 60, "cat-2", "Golden fries with a pinch of masala salt.");
      await mk("Onion Rings", "190", 4, "cat-2", "Thick-cut, beer-battered and extra crunchy.");
      await mk("Chilled Cola", "90", 100, "cat-3", "330 ml can, served cold.");
      await mk("Mint Lemonade", "160", 30, "cat-3", "Fresh lemon and mint, lightly sweetened.");
      await mk("Chocolate Brownie", "220", 0, "cat-4", "Warm fudgy brownie. Sold out today.");
      await mk("Lunch Deal", "650", 20, "cat-5", "Any burger, fries and a drink.", { compareAt: "800" });
      await t.collection("discounts").insertOne({ instanceId: inst._id, code: "WEEKDAY10", percentBps: 1000, active: true, maxUses: null, used: 0, expiresAt: null, createdAt: new Date() });
      await setOwnerFeature(inst, { userId: "seed", role: "store_owner", instanceId: inst._id }, "F-065", true, true);
      mkdirSync("files and creds", { recursive: true });
      writeFileSync("files and creds/demo-credentials.txt", `Demo store owner (git-ignored file, local only)\nStore admin: /s/demo/admin/login\nEmail: owner@demo.test\nPassword: ${password}\nNote: two-step sign in is required, you will be asked to set it up at first sign in.\n`);
    }
    expect(inst).toBeTruthy();
    await closeClient();
    void getClient;
  });
});
