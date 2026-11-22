import { describe, it, expect } from "vitest";
import { closeClient, platformDb } from "@/lib/db/client";
import { createSuperAdmin, countSuperAdmins } from "@/lib/platform/users";
import { issueTenantContext } from "@/lib/tenant/context";
import { users } from "@/lib/commerce/staff";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import { signSession } from "@/lib/auth/session";
import { writeFileSync } from "node:fs";

// One-off helper for the black-box suites: PREP_E2E=1 PLATFORM_DB_NAME=e2e_ui npx vitest run src/e2e/prep-e2e.test.ts
// Makes the seeded store's owner ready (two-step on) and makes sure a platform administrator exists.
describe.skipIf(process.env.PREP_E2E !== "1")("prepare the e2e database", () => {
  it("enables two-step for the owner and creates a super admin", async () => {
    const db = await platformDb();
    const inst = await db.collection<InstanceRecord>("instances").findOne({ subdomain: process.env.SEED_SUB ?? "demo-burgers" });
    expect(inst).toBeTruthy();
    const ctx = issueTenantContext(inst!._id);
    const owner = (await users.find(ctx, { role: "store_owner" } as never, 1))[0];
    await users.updateById(ctx, owner._id, { totp: { secret: "AAAAAAAAAAAAAAAA", enabled: true, lastStep: -1 } } as never);
    if ((await countSuperAdmins()) === 0) await createSuperAdmin("e2e-admin@example.com", "E2e-Admin-Pass-2026");
    // optional: a ready-made owner session cookie for manual browser checks
    if (process.env.PREP_COOKIE_FILE) writeFileSync(process.env.PREP_COOKIE_FILE, await signSession({ userId: owner._id, role: "store_owner", instanceId: inst!._id }, process.env.SESSION_SECRET ?? ""));
    await closeClient();
  });
});
