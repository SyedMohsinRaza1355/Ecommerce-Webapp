import { describe, it, expect } from "vitest";
import { appendFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { closeClient, platformDb } from "@/lib/db/client";
import { issueTenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { hashPassword } from "@/lib/auth/password";
import { users } from "@/lib/commerce/staff";
import { categories, createProduct, getSettings, products, ProductInput, slugify } from "@/lib/commerce/store";
import { setOwnerFeature } from "@/lib/commerce/features";
import { saveImage } from "@/lib/commerce/images";
import { placeOrder, placeStaffOrder, type Features } from "@/lib/commerce/orders";
import { savePromo } from "@/lib/commerce/rules";
import { savePage } from "@/lib/commerce/extras";
import { registerCustomer } from "@/lib/commerce/customers";
import { upsertManual } from "@/lib/payments/config";
import { clearResolutionCache } from "@/lib/tenant/resolve";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import type { Order } from "@/lib/commerce/types";
import { allArt } from "./demo-art";
import { issueGiftCard } from "@/lib/commerce/rewards";
import { saveSupplier, listSuppliers, createPurchaseOrder, listPurchaseOrders, setPurchaseOrderStatus, receivePurchaseOrder, bookTable, localNow, bookableDates, slotTimes, DEFAULT_BOOKING } from "@/lib/commerce/operations";
import { parseMajor } from "@/lib/money/money";

// Makes the demo store look like a busy, real restaurant: pictures, menu, deals, staff, customers, a month of orders.
// SEED_FULL=1 SEED_SUB=demo PLATFORM_DB_NAME=platform npx vitest run src/e2e/seed-demo-full.test.ts
// Safe to run again: it clears the store's catalogue, orders and customers first (the owner account and settings stay).
const SUB = process.env.SEED_SUB ?? "demo";
const CREDS = process.env.SEED_CREDS_FILE ?? "files and creds/demo-credentials.txt";

// small deterministic random numbers so every run builds the same restaurant
let seed = 20261122;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;

const NAMES = ["Ayesha Khan", "Bilal Ahmed", "Hamza Malik", "Sana Iqbal", "Usman Tariq", "Fatima Noor", "Ali Raza", "Maryam Siddiqui", "Hassan Butt", "Zainab Shah", "Omar Farooq", "Hira Anwar", "Saad Mehmood", "Noor Fatima", "Danish Aslam", "Iqra Javed", "Talha Qureshi", "Amna Rashid", "Faizan Ali", "Laiba Chaudhry"];
const AREAS = ["Gulberg", "DHA", "Johar Town"];
const STREETS = ["House 12, Street 4", "Flat 7, Block C", "House 88, Main Boulevard", "Plot 21, Phase 3", "House 5, Street 9", "Flat 14, Tower B"];

describe.skipIf(process.env.SEED_FULL !== "1")("full demo store", () => {
  it("builds the restaurant", async () => {
    const db = await platformDb();
    const inst = await db.collection<InstanceRecord>("instances").findOne({ subdomain: SUB });
    if (!inst) throw new Error(`Store "${SUB}" does not exist. Run the basic seed first.`);
    const ctx = issueTenantContext(inst._id);
    const owner = { userId: "seed", role: "store_owner" as const, instanceId: inst._id };
    const t = await tenantDb(ctx);

    // ---- clear the old catalogue, orders and customers ----
    const keep = new Set(["users", "settings", "payment_config"]);
    for (const c of await t.listCollections().toArray()) if (!keep.has(c.name) && !c.name.startsWith("system.")) await t.collection(c.name).deleteMany({});
    await t.collection("users").deleteMany({ instanceId: inst._id, email: { $ne: "owner@demo.test" } } as never);

    // ---- features ----
    for (const f of ["F-109"]) await setOwnerFeature(inst, owner, f, false, true).catch(() => undefined);
    const ON = ["F-017", "F-034", "F-016", "F-035", "F-125", "F-124", "F-054", "F-055", "F-056", "F-009", "F-045", "F-048", "F-058", "F-078", "F-079", "F-084", "F-134", "F-141", "F-077", "F-121", "F-065", "F-018", "F-071", "F-057", "F-020", "F-106", "F-144", "F-103", "F-053", "F-063", "F-042", "F-072", "F-083", "F-002", "F-003", "F-004", "F-006", "F-008", "F-014", "F-021", "F-138", "F-145", "F-112", "F-010", "F-019", "F-039", "F-044", "F-131", "F-132", "F-050", "F-049", "F-062", "F-025", "F-118", "F-127", "F-060", "F-129", "F-119"];
    const failed: string[] = [];
    for (const f of ON) { const r = await setOwnerFeature(inst, owner, f, true, true).catch((e) => ({ ok: false, error: String(e) })); if (!r.ok) failed.push(`${f}: ${"error" in r ? r.error : ""}`); }
    if (failed.length) console.log("Could not switch on:", failed.join(" | "));

    // ---- pictures ----
    const img: Record<string, string> = {};
    for (const a of allArt()) {
      const bytes = await sharp(Buffer.from(a.svg)).webp({ quality: 82 }).toBuffer();
      const r = await saveImage(ctx, SUB, bytes);
      if (!r.ok) throw new Error(`${a.file}: ${r.error}`);
      img[a.file] = r.url;
    }
    await t.collection("rate_limits").deleteMany({ key: { $regex: `^img:` } } as never).catch(() => undefined);

    // ---- categories ----
    const cat: Record<string, string> = {};
    let order = 1;
    for (const name of ["Burgers", "Chicken", "Sides", "Drinks", "Desserts", "Deals"]) {
      const id = `cat-${slugify(name)}`;
      await categories.insert(ctx, { _id: id, name, slug: slugify(name), sortOrder: order++ } as never);
      cat[name] = id;
    }

    // ---- menu ----
    const extras = "modifier Extras* max 3 : Extra cheese +60; Crispy bacon +120; Jalapenos +40; Extra patty +250";
    const spice = "variant Spice level! : Mild; Medium; Hot";
    type P = { name: string; price: number; compare?: number; cat: string; art: string; stock: number; desc: string; opts?: string; attrs?: string; sku: string; gallery?: string[] };
    const MENU: P[] = [
      { name: "Classic Beef Burger", price: 590, cat: "Burgers", art: "classic-beef", stock: 60, sku: "BRG-CLS", desc: "A juicy beef patty, melted cheddar, crisp lettuce, tomato and our house sauce in a toasted sesame bun.", opts: extras, attrs: "Weight: 260 g\nCalories: 690\nServes: 1" },
      { name: "Double Smash Burger", price: 790, compare: 890, cat: "Burgers", art: "double-smash", stock: 45, sku: "BRG-DSM", desc: "Two smashed beef patties with crispy edges, double cheddar, pickles, onions and burger sauce. Our best seller.", opts: extras, attrs: "Weight: 340 g\nCalories: 940\nServes: 1", gallery: ["mighty-stack"] },
      { name: "Zinger Burger", price: 490, cat: "Burgers", art: "zinger", stock: 70, sku: "BRG-ZNG", desc: "Crispy fried chicken fillet with a kick, lettuce and creamy mayo in a toasted bun.", opts: `${spice}\n${extras}`, attrs: "Weight: 280 g\nCalories: 620\nServes: 1" },
      { name: "Cheese Melt Burger", price: 650, cat: "Burgers", art: "cheese-melt", stock: 40, sku: "BRG-CHM", desc: "A beef patty buried under molten cheddar and mozzarella. Simple and rich.", opts: extras, attrs: "Weight: 250 g\nCalories: 780\nServes: 1" },
      { name: "BBQ Bacon Burger", price: 850, cat: "Burgers", art: "bbq-bacon", stock: 30, sku: "BRG-BBQ", desc: "Beef patty, crispy beef bacon, smoky BBQ sauce, onion rings and cheddar.", opts: extras, attrs: "Weight: 320 g\nCalories: 910\nServes: 1" },
      { name: "Veggie Garden Burger", price: 520, cat: "Burgers", art: "veggie", stock: 25, sku: "BRG-VEG", desc: "A crunchy vegetable and chickpea patty with fresh greens and herb mayo.", opts: extras, attrs: "Weight: 270 g\nCalories: 540\nVegetarian: Yes" },
      { name: "Mighty Stack", price: 1090, cat: "Burgers", art: "mighty-stack", stock: 18, sku: "BRG-MTY", desc: "Three patties, triple cheese and bacon. Bring an appetite.", opts: extras, attrs: "Weight: 520 g\nCalories: 1480\nServes: 1 hungry person" },
      { name: "Crispy Chicken Nuggets", price: 390, cat: "Chicken", art: "nuggets", stock: 80, sku: "CHK-NUG", desc: "Six golden nuggets with your choice of dip.", opts: "variant Pieces! : 6 pieces; 9 pieces +150; 12 pieces +290\nvariant Dip! : Garlic mayo; Hot sauce; BBQ", attrs: "Calories: 380" },
      { name: "Hot Wings", price: 520, cat: "Chicken", art: "wings", stock: 50, sku: "CHK-WNG", desc: "Six wings tossed in our fiery hot sauce, served with ranch.", opts: spice, attrs: "Pieces: 6\nCalories: 540" },
      { name: "Chicken Strips", price: 480, cat: "Chicken", art: "strips", stock: 45, sku: "CHK-STR", desc: "Hand-breaded chicken tenders, crisp outside and juicy inside.", attrs: "Pieces: 4\nCalories: 460" },
      { name: "Crispy Fries", price: 190, cat: "Sides", art: "fries", stock: 120, sku: "SDE-FRY", desc: "Golden fries with a pinch of masala salt.", opts: "variant Size! : Regular; Large +80", attrs: "Calories: 320" },
      { name: "Loaded Cheese Fries", price: 340, cat: "Sides", art: "loaded-fries", stock: 60, sku: "SDE-LDF", desc: "Fries buried in cheese sauce, beef bacon bits and spring onion.", attrs: "Calories: 680" },
      { name: "Onion Rings", price: 260, cat: "Sides", art: "onion-rings", stock: 5, sku: "SDE-ONR", desc: "Thick-cut, beer-battered and extra crunchy.", attrs: "Pieces: 8\nCalories: 410" },
      { name: "Creamy Coleslaw", price: 120, cat: "Sides", art: "coleslaw", stock: 40, sku: "SDE-CLS", desc: "Fresh cabbage and carrot in a light creamy dressing.", attrs: "Calories: 150" },
      { name: "Chilled Cola", price: 120, cat: "Drinks", art: "cola", stock: 200, sku: "DRK-COL", desc: "Ice-cold cola.", opts: "variant Size! : 330 ml; 500 ml +40; 1 litre +110" },
      { name: "Mint Lemonade", price: 220, cat: "Drinks", art: "lemonade", stock: 60, sku: "DRK-LMN", desc: "Fresh lemon and mint, lightly sweetened and served over ice." },
      { name: "Chocolate Shake", price: 380, cat: "Drinks", art: "choc-shake", stock: 40, sku: "DRK-CHS", desc: "Thick chocolate milkshake topped with whipped cream." },
      { name: "Mango Shake", price: 360, cat: "Drinks", art: "mango-shake", stock: 35, sku: "DRK-MNG", desc: "Made with ripe Sindhri mangoes. Seasonal." },
      { name: "Mineral Water", price: 70, cat: "Drinks", art: "water", stock: 300, sku: "DRK-WTR", desc: "500 ml bottled water." },
      { name: "Fudge Brownie", price: 260, cat: "Desserts", art: "brownie", stock: 0, sku: "DST-BRN", desc: "Warm fudgy brownie with vanilla ice cream. Sold out today, back tomorrow." },
      { name: "Ice Cream Sundae", price: 280, cat: "Desserts", art: "sundae", stock: 30, sku: "DST-SND", desc: "Vanilla and strawberry scoops with chocolate sauce and a cherry." },
    ];
    const pid: Record<string, string> = {};
    for (const m of MENU) {
      const res = await createProduct(ctx, ProductInput.parse({
        name: m.name, price: String(m.price), compareAt: m.compare ? String(m.compare) : "", stock: 5000, categoryId: cat[m.cat], description: m.desc,
        status: "published", trackStock: true, imageUrl: img[m.art], sku: m.sku, optionsText: m.opts ?? "", attributesText: m.attrs ?? "",
        galleryText: [m.art, ...(m.gallery ?? [])].length > 1 ? [img[m.art], ...(m.gallery ?? []).map((g) => img[g])].join("\n") : "",
      }), "PKR");
      if (!res.ok) throw new Error(`${m.name}: ${res.error}`);
      pid[m.name] = res.id;
    }
    // combo deals are bundles of real menu items, so stock stays correct
    const DEALS = [
      { name: "Lunch Deal", price: 850, compare: 1050, art: "deal-lunch", parts: [["Classic Beef Burger", 1], ["Crispy Fries", 1], ["Chilled Cola", 1]], desc: "Any classic burger, fries and a cold drink. The easy lunch." },
      { name: "Student Combo", price: 690, compare: 800, art: "deal-student", parts: [["Zinger Burger", 1], ["Crispy Fries", 1]], desc: "A zinger and fries at a student price. Show your card at pickup." },
      { name: "Date Night Duo", price: 1690, compare: 2140, art: "deal-duo", parts: [["Cheese Melt Burger", 1], ["Zinger Burger", 1], ["Loaded Cheese Fries", 1], ["Chocolate Shake", 1]], desc: "Two burgers, loaded fries and a shake to share." },
      { name: "Family Feast", price: 2990, compare: 3920, art: "deal-family", parts: [["Double Smash Burger", 1], ["Zinger Burger", 1], ["Classic Beef Burger", 1], ["Crispy Chicken Nuggets", 1], ["Crispy Fries", 2], ["Chilled Cola", 3]], desc: "Three burgers, nuggets, two fries and three drinks. Feeds four." },
    ] as const;
    for (const d of DEALS) {
      const res = await createProduct(ctx, ProductInput.parse({
        name: d.name, price: String(d.price), compareAt: String(d.compare), stock: 999, categoryId: cat.Deals, description: d.desc, status: "published", trackStock: false,
        imageUrl: img[d.art], sku: `DEAL-${slugify(d.name).toUpperCase().slice(0, 8)}`, bundleText: d.parts.map(([n, q]) => `${q} x ${pid[n]}`).join("\n"),
      }), "PKR");
      if (!res.ok) throw new Error(`${d.name}: ${res.error}`);
      pid[d.name] = res.id;
    }

    // ---- store settings ----
    const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "11:00", close: "23:30" }]));
    await t.collection("settings").updateOne({ instanceId: inst._id }, {
      $set: {
        currency: "PKR", taxBps: 1600, shippingFlatMinor: 15000, freeShippingOverMinor: 200000, contactEmail: "hello@demoburgers.example",
        "branding.storeName": "Demo Burgers", "branding.tagline": "Smashed fresh. Delivered hot.", "branding.primary": "#e0451b", "branding.logoUrl": img.logo,
        announcement: "Free delivery over Rs 2,000. Order before 11 PM tonight.", font: "rounded", locale: "en",
        fulfilment: { delivery: true, pickup: true, dineIn: true },
        locations: [{ id: "gulberg", name: "Gulberg (main branch)", address: "MM Alam Road, Gulberg III, Lahore" }, { id: "dha", name: "DHA Phase 5", address: "Y Block Commercial, DHA Phase 5, Lahore" }],
        zones: [{ id: "z1", name: "Gulberg", cities: ["Gulberg"], feeMinor: 10000 }, { id: "z2", name: "DHA", cities: ["DHA"], feeMinor: 20000 }, { id: "z3", name: "Johar Town", cities: ["Johar Town"], feeMinor: 15000 }],
        hours, returnNote: "Wrong or cold order? Tell us within 2 hours and we will remake it or refund you.",
        hero: [
          { title: "Smashed fresh, every order", text: "Our Double Smash is back with extra crispy edges.", imageUrl: img["hero-smash"], link: `/s/${SUB}/products` },
          { title: "Lunch Deal: Rs 850", text: "Burger, fries and a drink. Save Rs 200.", imageUrl: img["hero-deals"], link: `/s/${SUB}/products?cat=${cat.Deals}` },
          { title: "Save room for dessert", text: "Thick shakes, sundaes and fudge brownies.", imageUrl: img["hero-sweet"], link: `/s/${SUB}/products?cat=${cat.Desserts}` },
        ],
        homeSections: ["categories", "featured", "trust"], maxActive: 40,
      },
    }, { upsert: true });
    await t.collection("payment_config").updateOne({ _id: "config", instanceId: inst._id } as never, { $set: { testMode: true } }, { upsert: true });
    await upsertManual(ctx, { kind: "easypaisa", accountTitle: "Demo Burgers", accountNumber: "0300 1234567", instructions: "Send the total, then enter the transaction ID on your order page." });
    await upsertManual(ctx, { kind: "jazzcash", accountTitle: "Demo Burgers", accountNumber: "0301 7654321", instructions: "Send the total, then enter the transaction ID on your order page." });
    const mm = (await t.collection<{ manual: { id: string; enabled?: boolean }[] }>("payment_config").findOne({ _id: "config" } as never))?.manual ?? [];
    await t.collection("payment_config").updateOne({ _id: "config" } as never, { $set: { manual: mm.map((m) => ({ ...m, enabled: true })) } });
    clearResolutionCache();

    // ---- promotions and codes ----
    const settings = await getSettings(ctx);
    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16);
    expect(await savePromo(ctx, { name: "Weekend Smash Sale: 15% off burgers", kind: "flash", percent: "15", min: "", categoryId: cat.Burgers, startsAt: "", endsAt: soon(3) }, "PKR")).toEqual({ ok: true });
    expect(await savePromo(ctx, { name: "Spend Rs 2,500, save 10%", kind: "auto", percent: "10", min: "2500", categoryId: "", startsAt: "", endsAt: "" }, "PKR")).toEqual({ ok: true });
    expect(await savePromo(ctx, { name: "Buy 2 fries, get 1 free", kind: "bxgy", percent: "", min: "", categoryId: "", startsAt: "", endsAt: soon(14), productId: pid["Crispy Fries"], buyQty: "2", getQty: "1" }, "PKR")).toEqual({ ok: true });
    for (const [code, bps] of [["WELCOME10", 1000], ["WEEKDAY10", 1000], ["BIGEAT15", 1500]] as const) await t.collection("discounts").insertOne({ instanceId: inst._id, code, percentBps: bps, active: true, maxUses: null, used: 0, expiresAt: null, createdAt: new Date() } as never);

    // ---- people: staff and customers ----
    const staffPw = () => `Demo-${randomBytes(5).toString("hex")}-9`;
    const staff = [["manager@demo.test", "manager"], ["cashier@demo.test", "cashier"], ["kitchen@demo.test", "kitchen_ops"]] as const;
    const creds: string[] = [];
    for (const [email, role] of staff) {
      const pw = staffPw();
      await users.insert(ctx, { _id: randomUUID(), email, passwordHash: await hashPassword(pw), role, createdAt: new Date(Date.now() - 20 * 86_400_000) } as never);
      creds.push(`${role === "kitchen_ops" ? "Kitchen" : role[0].toUpperCase() + role.slice(1)}: ${email} / ${pw}`);
    }
    const custPw = staffPw();
    const customers: { id: string; name: string; email: string; phone: string; area: string; street: string }[] = [];
    for (const [i, name] of NAMES.slice(0, 14).entries()) {
      const email = i === 0 ? "customer@demo.test" : `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
      const phone = `+92 3${10 + i} ${String(1000000 + i * 137731).slice(0, 7)}`;
      const r = await registerCustomer(ctx, { name, email, password: i === 0 ? custPw : `${staffPw()}x`, phone }, `10.9.${i}.1`);
      if (!r.ok) throw new Error(`${name}: ${r.error}`);
      const area = AREAS[i % 3], street = STREETS[i % STREETS.length];
      await t.collection("customers").updateOne({ _id: r.customer._id as never }, { $set: { emailVerified: true, addresses: [{ id: randomUUID().slice(0, 8), label: "Home", name, phone, address: `${street}, ${area}`, city: area }], createdAt: new Date(Date.now() - (30 - i) * 86_400_000) } });
      customers.push({ id: r.customer._id, name, email, phone, area, street });
    }

    // ---- a month of orders ----
    const FEAT: Features = { shipping: true, freeShipping: true, tax: true, discounts: true, cod: true, card: false, emails: false, stockTracking: true, orderTypes: true, pickup: true, tableQr: true, zones: true, couponLimits: false };
    const sellable = [...MENU.filter((m) => m.stock > 0 || m.name !== "Fudge Brownie"), ...DEALS.map((d) => ({ ...d, stock: 999 }))];
    const weights = (n: string) => (/Deal|Combo|Duo|Feast/.test(n) ? 1.4 : /Classic|Double|Zinger|Fries|Cola/.test(n) ? 3 : 1);
    const pool = sellable.flatMap((m) => Array(Math.round(weights(m.name) * 2)).fill(m.name) as string[]);
    const totalOrders = 90;
    let nOrder = 0;
    const optionIds = async (productId: string): Promise<string[]> => {
      const p = (await products.findById(ctx, productId))!;
      const sel: string[] = [];
      for (const g of p.options ?? []) if (g.kind === "variant" || (g.required)) sel.push(pick(g.choices.slice(0, 2)).id);
      for (const g of p.options ?? []) if (g.kind === "modifier" && chance(0.2)) sel.push(pick(g.choices).id);
      return sel;
    };
    const line = async (name: string) => ({ productId: pid[name], qty: chance(0.2) ? 2 : 1, sel: await optionIds(pid[name]) });
    const placed: { id: string; at: Date }[] = [];
    const nowMs = Date.now();
    for (let i = 0; i < totalOrders; i++) {
      // spread over 28 days, a few days busier, newest ones close to now so the kitchen has live work
      const ageMin = i >= totalOrders - 6 ? 8 + (totalOrders - 1 - i) * 7 : Math.round((1 - Math.pow(i / (totalOrders - 6), 0.85)) * 28 * 1440) + 90;
      let at = new Date(nowMs - ageMin * 60_000);
      const hourPk = (at.getUTCHours() + 5) % 24;
      if (ageMin > 90 && (hourPk < 12 || hourPk >= 23)) at = new Date(at.getTime() + ((hourPk < 12 ? 12 - hourPk : -(hourPk - 21)) * 3600_000));
      const c = chance(0.7) ? pick(customers) : null;
      const who = c ?? { name: pick(NAMES), email: `${randomBytes(3).toString("hex")}@example.com`, phone: `+92 300 ${String(1000000 + Math.floor(rnd() * 8999999))}`, area: pick(AREAS), street: pick(STREETS), id: "" };
      const kind = rnd();
      const type = kind < 0.52 ? "delivery" : kind < 0.74 ? "pickup" : "dine_in";
      const nItems = 1 + Math.floor(rnd() * 3);
      const names = [...new Set(Array.from({ length: nItems }, () => pick(pool)))];
      const items = await Promise.all(names.map(line));
      const r = await placeOrder(ctx, settings, FEAT, "Demo Burgers", {
        items, method: "cod", idempotencyKey: `seed-${SUB}-${i}-${randomBytes(4).toString("hex")}`, now: at,
        customer: { name: who.name, email: who.email, phone: who.phone, address: type === "delivery" ? `${who.street}, ${who.area}` : "", city: type === "delivery" ? who.area : "", ...(chance(0.15) ? { notes: pick(["No onions please", "Extra napkins", "Ring the bell twice", "Less spicy"]) } : {}) },
        customerId: c?.id || undefined, discountCode: chance(0.12) ? pick(["WELCOME10", "WEEKDAY10"]) : undefined,
        fulfilment: type === "delivery" ? undefined : type === "pickup" ? { type, locationId: pick(["gulberg", "dha"]) } : { type, table: String(1 + Math.floor(rnd() * 12)) },
      });
      if (!r.ok) throw new Error(`order ${i}: ${r.error}`);
      placed.push({ id: r.orderId, at });
      nOrder++;
    }
    // give each order a believable life: payment, progress, completion; the newest are still in the kitchen
    const col = t.collection<Order>("orders");
    const pay = ["card", "cod", "cod", "manual"] as const;
    const live = ["pending", "confirmed", "processing", "processing", "ready", "ready"] as const;
    for (const [i, p] of placed.entries()) {
      const o = (await col.findOne({ _id: p.id as never }))!;
      const t0 = p.at.getTime();
      const method = pick(pay);
      const isLive = i >= placed.length - 6;
      const cancelled = !isLive && chance(0.05);
      const state = isLive ? live[i - (placed.length - 6)] : cancelled ? "cancelled" : "completed";
      const by = pick(["owner", "manager", "kitchen"]);
      const steps: { to: string; mins: number }[] = [{ to: "confirmed", mins: 2 }, { to: "processing", mins: 6 }, { to: "ready", mins: 17 }];
      if (!isLive && !cancelled) steps.push({ to: "fulfilled", mins: 31 + Math.floor(rnd() * 20) }, { to: "completed", mins: 60 + Math.floor(rnd() * 30) });
      const order = ["pending", "confirmed", "processing", "ready", "fulfilled", "completed"];
      const reached = cancelled ? steps.slice(0, 1) : steps.filter((s) => order.indexOf(s.to) <= order.indexOf(state));
      const history: Order["history"] = [{ at: p.at, kind: "order", to: "pending", by: "customer" }];
      let prev = "pending";
      for (const s of reached) { history.push({ at: new Date(t0 + s.mins * 60_000), kind: "order", from: prev, to: s.to, by }); prev = s.to; }
      let paymentState: string = method === "cod" ? (state === "completed" ? "captured" : "cod_due") : "captured";
      if (method !== "cod" && state === "pending") paymentState = method === "card" ? "captured" : "requires_payment";
      let refunds: Order["payment"]["refunds"] = [], refunded = 0;
      if (cancelled) {
        history.push({ at: new Date(t0 + 12 * 60_000), kind: "order", from: prev, to: "cancelled", by: "owner", note: pick(["Customer called to cancel", "Out of an ingredient", "Duplicate order"]) });
        if (method !== "cod") { paymentState = "refunded"; refunded = o.totalMinor; refunds = [{ id: randomUUID(), amountMinor: o.totalMinor, at: new Date(t0 + 20 * 60_000) }]; }
        else paymentState = "failed";
        if (method === "cod") paymentState = "cod_due";
      }
      if (paymentState === "captured" && method !== "cod") history.push({ at: new Date(t0 + 60_000), kind: "payment", from: "requires_payment", to: "captured", by: "system" });
      const manual = method === "manual" ? (() => { const k = pick(["easypaisa", "jazzcash"] as const); return { methodId: k, label: k === "easypaisa" ? "Easypaisa" : "JazzCash", kind: k, accountTitle: "Demo Burgers", accountNumber: k === "easypaisa" ? "0300 1234567" : "0301 7654321", instructions: "", ...(paymentState === "captured" ? { reference: `TX${Math.floor(1e9 + rnd() * 9e9)}`, reportedAt: new Date(t0 + 120_000) } : {}) }; })() : undefined;
      await col.updateOne({ _id: p.id as never }, { $set: {
        state, createdAt: p.at, updatedAt: history[history.length - 1].at, history,
        payment: { method, state: paymentState as never, ...(method === "card" ? { provider: "test", intentRef: `pi_demo_${randomBytes(6).toString("hex")}` } : {}), ...(manual ? { manual } : {}), refundedMinor: refunded, refunds },
        ...(cancelled ? { stockReserved: false } : {}),
      } });
    }
    // in-store till sales by the cashier
    const cashier = (await users.find(ctx, { email: "cashier@demo.test" } as never, 1))[0];
    let pos = 0;
    for (let i = 0; i < 12; i++) {
      const r = await placeStaffOrder(ctx, settings, FEAT, { userId: cashier._id, role: "cashier", instanceId: inst._id } as never, {
        items: [await line(pick(pool)), ...(chance(0.5) ? [await line(pick(pool))] : [])], tender: pick(["cash", "cash", "card"] as const), receivedMinor: 500000, idempotencyKey: `seed-pos-${SUB}-${i}-${randomBytes(6).toString("hex")}`,
      } as never);
      if (r.ok) { pos++; const at = new Date(nowMs - (2 + i * 7) * 3600_000); await col.updateOne({ _id: r.orderId as never }, { $set: { createdAt: at, updatedAt: at, "history.$[].at": at } }); }
    }

    // ---- stock the way a real kitchen would have it after a month ----
    const stockNow: Record<string, number> = { "Classic Beef Burger": 34, "Double Smash Burger": 21, "Zinger Burger": 42, "Cheese Melt Burger": 22, "BBQ Bacon Burger": 17, "Veggie Garden Burger": 14, "Mighty Stack": 9, "Crispy Chicken Nuggets": 48, "Hot Wings": 27, "Chicken Strips": 25, "Crispy Fries": 70, "Loaded Cheese Fries": 33, "Onion Rings": 5, "Creamy Coleslaw": 22, "Chilled Cola": 130, "Mint Lemonade": 31, "Chocolate Shake": 22, "Mango Shake": 18, "Mineral Water": 210, "Fudge Brownie": 0, "Ice Cream Sundae": 16 };
    for (const [n, s] of Object.entries(stockNow)) await t.collection("products").updateOne({ _id: pid[n] as never, instanceId: inst._id } as never, { $set: { stock: s } });
    // two products have back-in-stock waiters
    await t.collection("stock_alerts").insertMany([{ _id: randomUUID(), instanceId: inst._id, productId: pid["Fudge Brownie"], email: "waiting.one@example.com", notified: false, createdAt: new Date() }, { _id: randomUUID(), instanceId: inst._id, productId: pid["Fudge Brownie"], email: "waiting.two@example.com", notified: false, createdAt: new Date() }] as never);

    // ---- reviews ----
    const REV: [string, number, string][] = [
      ["Double Smash Burger", 5, "Crispy edges, juicy inside. Best smash burger in Lahore."], ["Double Smash Burger", 5, "Ordered twice this week already."], ["Double Smash Burger", 4, "Great taste, arrived a little warm instead of hot."],
      ["Zinger Burger", 5, "Proper crunch and the right amount of heat."], ["Zinger Burger", 4, "Very good. Medium spice is perfect."], ["Zinger Burger", 5, ""],
      ["Classic Beef Burger", 5, "Simple and perfect."], ["Classic Beef Burger", 4, "Tasty and filling."], ["BBQ Bacon Burger", 5, "The BBQ sauce is the star."], ["BBQ Bacon Burger", 4, "Rich. One is plenty."],
      ["Crispy Fries", 5, "Hot and crispy even after delivery."], ["Crispy Fries", 4, "Good portion."], ["Loaded Cheese Fries", 5, "Share with friends or do not share at all."], ["Hot Wings", 4, "Real heat, order the ranch."],
      ["Chocolate Shake", 5, "Thick and not too sweet."], ["Mint Lemonade", 5, "So refreshing."], ["Veggie Garden Burger", 4, "Surprisingly good for a veggie burger."], ["Mighty Stack", 5, "Challenge accepted and completed."],
      ["Lunch Deal", 5, "Great value for lunch."], ["Family Feast", 5, "Fed the whole family with leftovers."], ["Date Night Duo", 4, "Nice combo, the shake was great."], ["Crispy Chicken Nuggets", 4, "Kids loved them."],
      ["Ice Cream Sundae", 5, "A lovely end to the meal."], ["Onion Rings", 4, "Crunchy and not greasy."],
    ];
    for (const [i, [name, rating, text]] of REV.entries()) {
      const c = customers[i % customers.length];
      await t.collection("reviews").insertOne({ _id: randomUUID() as never, instanceId: inst._id, productId: pid[name], customerId: c.id, rating, text, name: c.name.split(" ")[0], verifiedBuyer: true, status: "published", createdAt: new Date(nowMs - (i + 1) * 17 * 3600_000), updatedAt: new Date() });
    }

    // ---- pages, blog, inbox, newsletter ----
    await savePage(ctx, { title: "About us", body: "Demo Burgers started in 2019 with one grill and one idea: smash the patty thin, get crispy edges, and serve it before it cools.\n\nToday we run two kitchens in Lahore, make our sauces in-house every morning and bake our buns fresh each day.\n\nEverything you see on this page is a demo store built to show what an online restaurant looks like on Storeforge.", published: true, inFooter: true });
    await savePage(ctx, { title: "Delivery and returns", body: "We deliver in Gulberg, DHA and Johar Town. Delivery takes 30 to 45 minutes.\n\nDelivery fees: Gulberg Rs 100, Johar Town Rs 150, DHA Rs 200. Orders over Rs 2,000 are delivered free.\n\nIf something is wrong with your order, tell us within 2 hours and we will remake it or refund you.", published: true, inFooter: true });
    await savePage(ctx, { title: "Frequently asked questions", body: "Is the meat halal?\nYes, all of our meat is halal.\n\nCan I change my order after placing it?\nCall us quickly and we will do our best before the kitchen starts.\n\nDo you take card payments?\nYes, plus cash on delivery, Easypaisa and JazzCash.", published: true, inFooter: true });
    await savePage(ctx, { title: "How to build the perfect smash burger", kind: "post", body: "The secret is heat and speed. Use a very hot flat grill, roll the beef into a loose ball, and press it flat the moment it hits the surface.\n\nSeason after pressing, never before. Flip once, add cheese, and let it melt for ten seconds.\n\nA toasted bun is not optional.", published: true, inFooter: false });
    await savePage(ctx, { title: "Our sauces, explained", kind: "post", body: "House sauce is mayo, ketchup, a little pickle brine and a pinch of smoked paprika. Hot sauce is fermented chillies, garlic and vinegar. BBQ is slow-cooked with jaggery.\n\nAll three are made in our kitchen every morning.", published: true, inFooter: false });
    await savePage(ctx, { title: "Weekend Smash Sale is on", kind: "post", body: "This weekend every burger is 15% off. The sale ends Monday morning, and it stacks with free delivery on orders over Rs 2,000.", published: true, inFooter: false });
    await t.collection("contact_messages").insertMany([
      { _id: randomUUID(), instanceId: inst._id, name: "Sara Hussain", email: "sara.hussain@example.com", message: "Do you do large orders for office lunches? We would be about 25 people on Friday.", read: false, createdAt: new Date(nowMs - 3 * 3600_000) },
      { _id: randomUUID(), instanceId: inst._id, name: "Kamran Yusuf", email: "kamran.y@example.com", message: "Thank you for the quick delivery yesterday, the burgers were still hot!", read: true, createdAt: new Date(nowMs - 30 * 3600_000) },
      { _id: randomUUID(), instanceId: inst._id, name: "Rabia Zafar", email: "rabia.z@example.com", message: "Is there a vegan option other than the veggie burger?", read: false, createdAt: new Date(nowMs - 52 * 3600_000) },
    ] as never);
    await t.collection("newsletter").insertMany(Array.from({ length: 24 }, (_, i) => ({ _id: randomUUID(), instanceId: inst._id, email: `subscriber${i + 1}@example.com`, createdAt: new Date(nowMs - i * 29 * 3600_000) })) as never);

    // ---- rewards, suppliers, bookings ----
    await t.collection("settings").updateOne({ instanceId: inst._id }, { $set: { loyalty: { earnPer100: 5, pointMinor: 20 }, groups: [{ id: "vip", name: "VIP", percentBps: 1000 }, { id: "students", name: "Students", percentBps: 500 }], referral: { rewardMinor: 20000 }, booking: { capacity: 4, maxParty: 8, from: "12:00", to: "22:00", slotMinutes: 60, daysAhead: 14 } } });
    const bump = async (c: typeof customers[number], set: Record<string, unknown>) => t.collection("customers").updateOne({ _id: c.id as never }, { $set: set });
    await bump(customers[0], { points: 240, creditMinor: 30000, groupId: "vip", referralCode: "FRIEND-DEMO01" });
    await bump(customers[1], { points: 85, groupId: "students" });
    await bump(customers[2], { points: 410, creditMinor: 20000 });
    await t.collection("reward_ledger").insertMany([
      { _id: randomUUID(), instanceId: inst._id, customerId: customers[0].id, kind: "points", delta: 140, reason: "Order #12", at: new Date(nowMs - 9 * 86_400_000) },
      { _id: randomUUID(), instanceId: inst._id, customerId: customers[0].id, kind: "points", delta: 100, reason: "Order #31", at: new Date(nowMs - 3 * 86_400_000) },
      { _id: randomUUID(), instanceId: inst._id, customerId: customers[0].id, kind: "credit", delta: 30000, reason: "Apology for a late delivery", at: new Date(nowMs - 2 * 86_400_000) },
    ] as never);
    const gift1 = await issueGiftCard(ctx, { amountMinor: 200000, note: "Demo gift card", expiresAt: "" });
    const gift2 = await issueGiftCard(ctx, { amountMinor: 50000, note: "Birthday gift", expiresAt: "" });
    for (const [n, who] of [["Fresh Meats Co.", "0300 5551001"], ["Golden Bun Bakery", "0321 5552002"], ["Cool Drinks Distributors", "0333 5553003"], ["Lahore Dairy Farms", "0345 5554004"]] as const) await saveSupplier(ctx, { name: n, phone: who, email: `${slugify(n)}@example.com`, note: "Delivers Mon, Wed and Fri before 9 AM" });
    const sups = await listSuppliers(ctx);
    const sup = (n: string) => sups.find((x) => x.name.startsWith(n))!._id;
    const cost = (x: string) => parseMajor(x, "PKR").minor;
    await createPurchaseOrder(ctx, { supplierId: sup("Fresh"), text: "BRG-CLS x 40 @ 210\nBRG-DSM x 30 @ 340\nCHK-WNG x 30 @ 190", note: "Weekly meat order" }, cost);
    await createPurchaseOrder(ctx, { supplierId: sup("Golden"), text: "BRG-ZNG x 60 @ 150", note: "Buns" }, cost);
    await createPurchaseOrder(ctx, { supplierId: sup("Cool"), text: "DRK-COL x 120 @ 55\nDRK-WTR x 150 @ 30", note: "" }, cost);
    const poList = await listPurchaseOrders(ctx);
    for (const po of poList) {
      if (po.no === 1) { await setPurchaseOrderStatus(ctx, po._id, "ordered"); }
      if (po.no === 2) { await setPurchaseOrderStatus(ctx, po._id, "ordered"); }
    }
    await t.collection("purchase_orders").updateOne({ instanceId: inst._id, no: 3 } as never, { $set: { createdAt: new Date(nowMs - 6 * 86_400_000) } });
    // an old, already delivered purchase order (stock is set separately below, so this only records history)
    await t.collection("purchase_orders").insertOne({ _id: randomUUID(), instanceId: inst._id, no: 0, supplierId: sup("Lahore"), supplierName: "Lahore Dairy Farms", lines: [{ productId: pid["Chocolate Shake"], name: "Chocolate Shake", sku: "DRK-CHS", qty: 40, costMinor: 16000 }], totalMinor: 640000, status: "received", note: "", createdAt: new Date(nowMs - 12 * 86_400_000), receivedAt: new Date(nowMs - 11 * 86_400_000) } as never);
    void receivePurchaseOrder;
    const bcfg = { ...DEFAULT_BOOKING, capacity: 4, maxParty: 8, from: "12:00", to: "22:00", slotMinutes: 60, daysAhead: 14 };
    const days = bookableDates(bcfg, new Date()).slice(1, 5);
    const slots = slotTimes(bcfg);
    const guestNames = ["Sara Hussain", "Kamran Yusuf", "Rabia Zafar", "Imran Sheikh", "Mehwish Ali", "Daniyal Khan", "Hina Rauf", "Farhan Mir", "Anum Tahir", "Waqas Butt", "Sadia Noor", "Junaid Iqbal"];
    let booked = 0;
    for (const [i, name] of guestNames.entries()) {
      const r = await bookTable(ctx, bcfg, { date: days[i % days.length], time: slots[2 + ((i * 3) % 8)], party: String(2 + (i % 5)), name, email: `${slugify(name)}@example.com`, phone: `0300 ${String(2000000 + i * 4321)}`, note: i % 4 === 0 ? "Birthday dinner" : "" }, `10.7.${i}.1`, { email: null, storeName: "Demo Burgers" });
      if (r.ok) booked++;
    }
    void localNow;

    // ---- credentials ----
    const text = `\nDemo store people (made ${new Date().toISOString().slice(0, 10)}; sign-in at /s/${SUB}/admin/login, two-step sign-in is switched off for this demo store)\n${creds.join("\n")}\nShopper account: customer@demo.test / ${custPw} (sign in at /s/${SUB}/account/login)\nGift cards to try at checkout: ${gift1.ok ? gift1.code : ""} (Rs 2,000), ${gift2.ok ? gift2.code : ""} (Rs 500)\n`;
    appendFileSync(CREDS, text, "utf8");
    console.log(`${booked} bookings, `);
    console.log(`Built ${nOrder} online orders and ${pos} till sales, ${MENU.length + DEALS.length} products, ${customers.length} customers.`);
    await closeClient();
  }, 600_000);
});
