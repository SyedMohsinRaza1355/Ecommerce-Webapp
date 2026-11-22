import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { createProduct, getSettings, ProductInput, products } from "./store";
import { placeOrder, orders, lookupOrderToken, findOrderByToken, type Features } from "./orders";
import {
  csvCell, toCsv, parseCsv, exportCsv, importProductsCsv, savePage, listPages, getPageBySlug, deletePage, subscribeNewsletter, saveContactMessage,
  ratingSummary, listReviews, setReviewStatus, productReport, customerReport, taxReport, buildBackup, lowStockItems, salesByDay, attentionCounts,
} from "./extras";
import type { Actor } from "@/lib/auth/rbac";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const FEAT: Features = { shipping: true, freeShipping: false, tax: true, discounts: true, cod: true, card: true, emails: true, stockTracking: true, lowStock: true };
const PLATFORM = `test_extras_${Math.random().toString(36).slice(2, 8)}`;
const cust = { name: "Ayesha Khan", email: "ayesha@example.com", phone: "+92 300 1234567", address: "12 Main Street", city: "Lahore" };
let n = 0;
const key = () => `idem-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;

describe("CSV safety and parsing", () => {
  it("neutralises spreadsheet formulas and quotes awkward cells", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(csvCell(bad).startsWith("'")).toBe(true);
    expect(csvCell(-5)).toBe("-5"); // real numbers stay numbers
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(toCsv([["a", "b"], [1, "x\ny"]])).toBe('a,b\r\n1,"x\ny"\r\n');
  });
  it("parses quotes, embedded commas and newlines, CRLF and a BOM; ignores blank lines", () => {
    expect(parseCsv('﻿name,price\r\n"Burger, large",450\r\n\r\n"He said ""wow""",10\n')).toEqual([["name", "price"], ["Burger, large", "450"], ['He said "wow"', "10"]]);
    expect(parseCsv('a,b\n"multi\nline",2')).toEqual([["a", "b"], ["multi\nline", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });
  it("round-trips export-style data", () => {
    const rows = [["name", "note"], ["A, B", 'q"uote'], ["=bad", "ok"]];
    const parsed = parseCsv(toCsv(rows));
    expect(parsed[1]).toEqual(["A, B", 'q"uote']);
    expect(parsed[2][0]).toBe("'=bad");
  });
});

describe.skipIf(!HAS_DB)("store features (Atlas, synthetic tenants)", () => {
  const created: string[] = [];
  let A: TenantContext, B: TenantContext, P: string, Q: string;
  async function makeStore(sub: string) {
    const r = await provisionInstance(sa, { name: `Store ${sub}`, subdomain: sub, packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId);
    return issueTenantContext(r.instanceId);
  }
  const mk = async (ctx: TenantContext, name: string, price: string, stock: number) => {
    const r = await createProduct(ctx, ProductInput.parse({ name, price, stock, status: "published", trackStock: true }), "PKR");
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };
  const place = async (ctx: TenantContext, items: { productId: string; qty: number }[], over: Partial<Features> = {}, email = cust.email) =>
    placeOrder(ctx, await getSettings(ctx), { ...FEAT, ...over }, "Test Store", { items, customer: { ...cust, email }, method: "cod", idempotencyKey: key() });

  beforeAll(async () => {
    process.env.PLATFORM_DB_NAME = PLATFORM;
    A = await makeStore("ext-a");
    B = await makeStore("ext-b");
    await (await tenantDb(A)).collection("settings").updateOne({ instanceId: A.instanceId }, { $set: { taxBps: 1000, shippingFlatMinor: 0, contactEmail: "owner@store.test" } });
    P = await mk(A, "Zinger", "100", 50);
    Q = await mk(A, "Fries", "40", 6);
    await mk(B, "Other store item", "5", 5);
  });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  describe("maintenance mode and low stock", () => {
    it("maintenance mode pauses ordering without touching stock", async () => {
      const before = (await products.findById(A, P))!.stock;
      expect(await place(A, [{ productId: P, qty: 1 }], { maintenance: true })).toMatchObject({ ok: false, error: expect.stringContaining("maintenance") });
      expect((await products.findById(A, P))!.stock).toBe(before);
      expect(await place(A, [{ productId: P, qty: 1 }], { maintenance: false })).toMatchObject({ ok: true });
    });
    it("emails the owner once when an item first drops to the threshold, not on every later order", async () => {
      const db = await tenantDb(A);
      const count = () => db.collection("outbox").countDocuments({ to: "owner@store.test", type: "stock.low" });
      expect(await count()).toBe(0);
      expect(await place(A, [{ productId: Q, qty: 1 }])).toMatchObject({ ok: true }); // 6 -> 5: reaches the line
      expect(await count()).toBe(1);
      expect(await place(A, [{ productId: Q, qty: 1 }])).toMatchObject({ ok: true }); // 5 -> 4: already low, no repeat
      expect(await count()).toBe(1);
      expect((await lowStockItems(A)).map((p) => p.name)).toContain("Fries");
    });
    it("no email when the feature is off or no contact address is set", async () => {
      const db = await tenantDb(B);
      const bp = (await products.find(B, {}, 1))[0];
      await placeOrder(B, await getSettings(B), FEAT, "S", { items: [{ productId: bp._id, qty: 5 }], customer: cust, method: "cod", idempotencyKey: key() });
      expect(await db.collection("outbox").countDocuments({ type: "stock.low" })).toBe(0);
    });
  });

  describe("custom pages", () => {
    it("creates, publishes, hides drafts, rejects reserved addresses and duplicates, never mixes stores", async () => {
      const r = await savePage(A, { title: "About us", body: "We bake.\n\nSince 2020.", published: true, inFooter: true });
      expect(r).toMatchObject({ ok: true });
      expect((await getPageBySlug(A, "about-us"))?.title).toBe("About us");
      expect(await getPageBySlug(B, "about-us")).toBeNull();
      expect(await savePage(A, { title: "Cart", body: "", published: true, inFooter: false })).toMatchObject({ ok: false });
      expect(await savePage(A, { title: "Admin", body: "", published: true, inFooter: false })).toMatchObject({ ok: false });
      expect(await savePage(A, { title: "About us", body: "dup", published: true, inFooter: false })).toMatchObject({ ok: false, error: expect.stringContaining("already") });
      expect(await savePage(A, { title: "x", body: "", published: true, inFooter: false })).toMatchObject({ ok: false });
      expect(await savePage(A, { title: "Long", body: "x".repeat(20001), published: true, inFooter: false })).toMatchObject({ ok: false });
      const d = await savePage(A, { title: "Secret draft", body: "soon", published: false, inFooter: true });
      if (!d.ok) throw new Error(d.error);
      expect(await getPageBySlug(A, "secret-draft")).toBeNull();
      expect((await listPages(A, true)).map((p) => p.slug)).not.toContain("secret-draft");
      expect((await listPages(A)).map((p) => p.slug)).toContain("secret-draft");
      await deletePage(A, d.id);
      expect((await listPages(A)).map((p) => p.slug)).not.toContain("secret-draft");
    });
    it("stores markup as inert text (it is rendered as text, never as HTML)", async () => {
      await savePage(A, { title: "Policy", body: "<script>alert(1)</script>", published: true, inFooter: false });
      expect((await getPageBySlug(A, "policy"))?.body).toBe("<script>alert(1)</script>");
    });
  });

  describe("newsletter and contact form", () => {
    it("subscribes once, tolerates repeats, validates and rate limits", async () => {
      expect(await subscribeNewsletter(A, " Fan@Example.com ", "1.1.1.1", { storeName: "S", welcome: true })).toEqual({ ok: true });
      expect(await subscribeNewsletter(A, "fan@example.com", "1.1.1.2", { storeName: "S", welcome: true })).toEqual({ ok: true });
      expect(await (await tenantDb(A)).collection("newsletter").countDocuments({ email: "fan@example.com" })).toBe(1);
      expect(await (await tenantDb(A)).collection("outbox").countDocuments({ to: "fan@example.com" })).toBe(1);
      expect(await subscribeNewsletter(A, "nope", "1.1.1.3", { storeName: "S", welcome: false })).toMatchObject({ ok: false });
      let last;
      for (let i = 0; i < 7; i++) last = await subscribeNewsletter(A, `bulk${i}@example.com`, "2.2.2.2", { storeName: "S", welcome: false });
      expect(last).toMatchObject({ ok: false, error: expect.stringContaining("Too many") });
      expect(await (await tenantDb(B)).collection("newsletter").countDocuments({})).toBe(0);
    });
    it("stores a message and notifies the owner; bots (honeypot) get a fake success and nothing is stored", async () => {
      const ok = await saveContactMessage(A, { name: "Sara", email: "sara@example.com", message: "Where is my order?" }, "3.3.3.3", "owner@store.test", "S");
      expect(ok).toEqual({ ok: true });
      const db = await tenantDb(A);
      expect(await db.collection("contact_messages").countDocuments({ email: "sara@example.com" })).toBe(1);
      expect(await db.collection("outbox").countDocuments({ type: "contact.message", to: "owner@store.test" })).toBe(1);
      expect(await saveContactMessage(A, { name: "Bot", email: "bot@example.com", message: "buy pills now", honeypot: "http://spam" }, "3.3.3.4", "owner@store.test", "S")).toEqual({ ok: true });
      expect(await db.collection("contact_messages").countDocuments({ email: "bot@example.com" })).toBe(0);
      for (const bad of [{ name: "", email: "a@b.co", message: "hello there" }, { name: "Sara", email: "bad", message: "hello there" }, { name: "Sara", email: "a@b.co", message: "hi" }, { name: "Sara", email: "a@b.co", message: "x".repeat(2001) }]) {
        expect(await saveContactMessage(A, bad, "3.3.3.5", null, "S")).toMatchObject({ ok: false });
      }
    });
  });

  describe("reviews", () => {
    it("averages published reviews only; hidden and deleted ones disappear; stores stay separate", async () => {
      const c = (await tenantDb(A)).collection("reviews");
      const row = (customerId: string, rating: number, status = "published") => ({ _id: `r-${customerId}` as never, instanceId: A.instanceId, productId: P, customerId, rating, text: "ok", name: "X", verifiedBuyer: true, status, createdAt: new Date() });
      await c.insertMany([row("c1", 5), row("c2", 4), row("c3", 1, "hidden")]);
      expect(await ratingSummary(A, P)).toEqual({ count: 2, average: 4.5 });
      expect((await listReviews(A, P)).map((r) => r.rating).sort()).toEqual([4, 5]);
      await setReviewStatus(A, "r-c1", "hidden");
      expect(await ratingSummary(A, P)).toEqual({ count: 1, average: 4 });
      await setReviewStatus(A, "r-c2", "deleted");
      expect(await ratingSummary(A, P)).toEqual({ count: 0, average: 0 });
      expect(await ratingSummary(B, P)).toEqual({ count: 0, average: 0 });
      await expect(c.insertOne(row("c3", 2))).rejects.toThrow(); // one review per customer per product
    });
  });

  describe("CSV export and import", () => {
    it("exports orders and products; formulas typed by customers are defused", async () => {
      await place(A, [{ productId: P, qty: 1 }], {}, "evil@example.com");
      await (await tenantDb(A)).collection("orders").updateOne({ "customer.email": "evil@example.com" }, { $set: { "customer.name": "=cmd|' /C calc'!A0" } });
      const csv = await exportCsv(A, "orders");
      expect(csv.split("\r\n")[0]).toContain("order,date,status");
      expect(csv).toContain("'=cmd");
      expect(csv).not.toMatch(/,=cmd/);
      expect(await exportCsv(A, "products")).toContain("Zinger,100.00,");
      expect(await exportCsv(B, "orders")).not.toContain("Zinger");
    });
    it("imports valid rows, reports bad ones by line, creates categories, and never crosses stores", async () => {
      const csv = [
        "name,price,stock,category,description,status",
        "Pizza,799.50,10,Mains,Cheesy,published",
        "Pasta,450,5,mains,Creamy,draft",
        ",100,1,Mains,,published",
        "Cake,abc,1,Sweets,,published",
        "Tea,60,,Drinks,,published",
        '"Naan, garlic",80,20,Mains,"with ""butter""",published',
      ].join("\n");
      const r = await importProductsCsv(A, csv, "PKR");
      expect(r.created).toBe(4);
      expect(r.errors.map((e) => e.row)).toEqual([4, 5]);
      const all = await products.find(A, {}, 200);
      expect(all.find((p) => p.name === "Pizza")).toMatchObject({ priceMinor: 79950, stock: 10, status: "published" });
      expect(all.find((p) => p.name === "Pasta")?.status).toBe("draft");
      expect(all.find((p) => p.name === "Tea")?.trackStock).toBe(false);
      expect(all.find((p) => p.name === "Naan, garlic")?.description).toBe('with "butter"');
      const cats = await (await tenantDb(A)).collection("categories").find({ instanceId: A.instanceId }).toArray();
      expect(cats.filter((c) => c.slug === "mains")).toHaveLength(1); // "Mains" and "mains" share one category
      expect((await products.find(B, {}, 50)).some((p) => p.name === "Pizza")).toBe(false);
    });
    it("rejects files without the required columns, empty files and oversized imports", async () => {
      expect((await importProductsCsv(A, "title,cost\nx,1", "PKR")).created).toBe(0);
      expect((await importProductsCsv(A, "name,price", "PKR")).errors[0].message).toMatch(/header row/);
      expect((await importProductsCsv(A, "", "PKR")).created).toBe(0);
      const big = "name,price\n" + Array.from({ length: 501 }, (_, i) => `P${i},1`).join("\n");
      expect((await importProductsCsv(A, big, "PKR")).errors[0].message).toMatch(/500/);
      expect((await importProductsCsv(A, "name,price\n" + "x".repeat(1_000_001), "PKR")).errors[0].message).toMatch(/too large/);
    });
  });

  describe("reports and backup", () => {
    it("reports count only live orders and sum correctly", async () => {
      const from = new Date(Date.now() - 86_400_000), to = new Date(Date.now() + 86_400_000);
      const p = await productReport(A, from, to);
      const z = p.find((x) => x.name === "Zinger")!;
      expect(z.qty).toBeGreaterThanOrEqual(2);
      expect(z.revenueMinor).toBe(z.qty * 10000);
      const c = await customerReport(A, from, to);
      expect(c.find((x) => x._id === cust.email)!.orders).toBeGreaterThanOrEqual(2);
      const t = await taxReport(A, from, to);
      expect(t).toHaveLength(1);
      expect(t[0].taxMinor).toBeGreaterThan(0);
      expect(t[0].totalMinor).toBe(t[0].subtotalMinor - t[0].discountMinor + t[0].shippingMinor + t[0].taxMinor);
      // cancelled orders are excluded
      const o = (await orders.find(A, {}, 1))[0];
      await (await orders.collection(A)).updateOne({ _id: o._id } as never, { $set: { state: "cancelled" } });
      const t2 = await taxReport(A, from, to);
      expect(t2[0].orders).toBe(t[0].orders - 1);
      expect(await productReport(A, new Date(0), new Date(1000))).toEqual([]);
      const tb = await taxReport(B, from, to); // store B only ever sold 5 x 5.00 in the low-stock test
      expect(tb).toHaveLength(1);
      expect(tb[0]).toMatchObject({ orders: 1, subtotalMinor: 2500 });
    });
    it("the dashboard chart has one entry per day, fills empty days with zero, nets out refunds and ignores other stores", async () => {
      const days = await salesByDay(A, 7);
      expect(days).toHaveLength(7);
      expect(new Set(days.map((d) => d.day)).size).toBe(7);
      expect(days.slice(0, 6).every((d) => d.totalMinor === 0 && d.orders === 0)).toBe(true); // everything was sold today
      const today = days[6];
      const live = await (await tenantDb(A)).collection("orders").aggregate([{ $match: { instanceId: A.instanceId, state: { $ne: "cancelled" }, "payment.state": { $in: ["captured", "cod_due", "partially_refunded", "refunded"] } } }, { $group: { _id: null, t: { $sum: { $subtract: ["$totalMinor", { $ifNull: ["$payment.refundedMinor", 0] }] } }, n: { $sum: 1 } } }]).toArray();
      expect(today.totalMinor).toBe(live[0].t);
      expect(today.orders).toBe(live[0].n);
      expect((await salesByDay(A, 7, new Date(Date.now() + 40 * 86_400_000))).every((d) => d.totalMinor === 0)).toBe(true); // a window that does not include today
      const b = await salesByDay(B, 7);
      expect(b.reduce((n, d) => n + d.totalMinor, 0)).toBeLessThan(today.totalMinor);
    });
    it("guests find an order only with the right number AND email; everything else looks the same", async () => {
      const o = (await orders.find(A, { "customer.email": cust.email } as never, 1))[0];
      const tok = await lookupOrderToken(A, String(o.orderNo), " Ayesha@Example.com ", "5.5.5.1");
      expect(tok).toBeTruthy();
      expect((await findOrderByToken(A, tok!))!._id).toBe(o._id);
      expect(await lookupOrderToken(A, `#${o.orderNo}`, cust.email, "5.5.5.1")).toBe(tok); // the # is tolerated
      for (const [no, em] of [[String(o.orderNo), "wrong@example.com"], ["999999", cust.email], ["abc", cust.email], ["", ""], [String(o.orderNo), "not-an-email"]]) expect(await lookupOrderToken(A, no, em, "5.5.5.2"), `${no}/${em}`).toBeNull();
      const other = await lookupOrderToken(B, String(o.orderNo), cust.email, "5.5.5.3"); // store B has its own order with this number and email
      if (other) expect(await findOrderByToken(A, other)).toBeNull(); // but its link can never open store A's order
    });
    it("lookups are rate limited so numbers and emails cannot be guessed", async () => {
      const o = (await orders.find(A, {}, 1))[0];
      let blocked = false;
      for (let i = 0; i < 20; i++) if ((await lookupOrderToken(A, String(o.orderNo), `guess${i}@example.com`, "5.5.5.9")) === null && i > 10) blocked = true;
      expect(blocked).toBe(true);
      expect(await lookupOrderToken(A, String(o.orderNo), o.customer.email, "5.5.5.9")).toBeNull(); // even the right answer is refused while limited
    });
    it("the attention panel counts what needs action and nothing from other stores", async () => {
      const col = await orders.collection(A);
      const base = (await orders.find(A, {}, 1))[0];
      const mk = (extra: object) => ({ ...base, _id: `att-${Math.random()}`, orderNo: Math.floor(Math.random() * 1e8) + 10_000, idempotencyKey: key(), trackingHash: `h-${Math.random()}`, ...extra });
      await col.insertMany([
        mk({ state: "pending", payment: { method: "manual", state: "requires_payment", refundedMinor: 0, refunds: [], manual: { methodId: "m", label: "EP", kind: "easypaisa", accountTitle: "A", accountNumber: "1", instructions: "", reference: "TXN1" } } }),
        mk({ state: "pending", payment: { method: "manual", state: "requires_payment", refundedMinor: 0, refunds: [], manual: { methodId: "m", label: "EP", kind: "easypaisa", accountTitle: "A", accountNumber: "1", instructions: "" } } }),
        mk({ state: "confirmed", createdAt: new Date(Date.now() - 3600_000) }),
        mk({ state: "cancelled", flags: { refundRequired: true } }),
      ] as never);
      const a = await attentionCounts(A);
      expect(a.manualWaiting).toBe(2);
      expect(a.manualReported).toBe(1);
      expect(a.stale).toBeGreaterThanOrEqual(1);
      expect(a.refundsDue).toBe(1);
      expect(a.lowStock).toBeGreaterThanOrEqual(1);
      expect(await attentionCounts(B)).toMatchObject({ manualWaiting: 0, manualReported: 0, stale: 0, refundsDue: 0 });
    });
    it("the backup includes the store's data but no password hashes, 2-step secrets or payment keys, and nothing from other stores", async () => {
      const c = await (await tenantDb(A)).collection("customers").insertOne({ _id: "cb" as never, instanceId: A.instanceId, email: "bk@example.com", name: "B", passwordHash: "$2b$12$secret", emailVerified: true, addresses: [], wishlist: [], createdAt: new Date() });
      void c;
      await (await tenantDb(A)).collection("payment_config").updateOne({ _id: "config" as never, instanceId: A.instanceId }, { $set: { stripe: { keyEnc: "v1.x.y.z" } } }, { upsert: true });
      const b = await buildBackup(A);
      const text = JSON.stringify(b);
      expect(b.format).toBe("storeforge-backup-v1");
      expect(b.counts.products).toBeGreaterThan(3);
      expect(text).toContain("bk@example.com");
      expect(text).not.toContain("passwordHash");
      expect(text).not.toContain("$2b$12$secret");
      expect(text).not.toContain("keyEnc");
      expect(text).not.toContain("Other store item");
      expect(Object.keys(b.data)).not.toContain("users");
      expect(Object.keys(b.data)).not.toContain("payment_config");
    });
  });
});
