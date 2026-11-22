import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { closeClient, platformDb } from "@/lib/db/client";
import { signSession } from "@/lib/auth/session";
import { issueTenantContext } from "@/lib/tenant/context";
import { users } from "@/lib/commerce/staff";
import { orders } from "@/lib/commerce/orders";
import type { InstanceRecord } from "@/lib/tenant/resolve";

// Standards checks against a RUNNING server. E2E=1 PLATFORM_DB_NAME=e2e_ui PLATFORM_BASE_DOMAIN=localhost:3100 npx vitest run src/e2e
const ENABLED = process.env.E2E === "1";
const PORT = Number(process.env.E2E_PORT ?? 3100);
const SECRET = process.env.SESSION_SECRET ?? "";
const SUB = "demo-burgers";

type Res = { status: number; body: string; headers: http.IncomingHttpHeaders; ms: number };
function call(path: string, o: { cookie?: string; method?: string } = {}): Promise<Res> {
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, path, method: o.method ?? "GET", headers: { host: `localhost:${PORT}`, ...(o.cookie ? { cookie: o.cookie } : {}) } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers, ms: performance.now() - t0 }));
    });
    r.on("error", reject);
    r.end();
  });
}

let ownerCookie = "";
let orderToken = "";

describe.skipIf(!ENABLED)("standards: PCI scope, PWA, privacy rights, performance", () => {
  beforeAll(async () => {
    const db = await platformDb();
    const inst = (await db.collection<InstanceRecord>("instances").findOne({ subdomain: SUB }))!;
    const ctx = issueTenantContext(inst._id);
    const owner = (await users.find(ctx, { role: "store_owner" } as never, 1))[0];
    ownerCookie = `store_session=${await signSession({ userId: owner._id, role: "store_owner", instanceId: inst._id }, SECRET)}`;
    const o = (await orders.find(ctx, {}, 1))[0];
    if (o) orderToken = (await import("@/lib/commerce/orders")).trackingTokenFor(inst._id, o._id);
  });
  afterAll(closeClient);

  describe("PCI DSS SAQ-A: card data never enters our pages", () => {
    const CARD_FIELD = /name="(card|cardnumber|card-number|cc|ccnumber|pan|cvv|cvc|expiry|exp-?date)"|autocomplete="cc-/i;
    it.each([`/s/${SUB}`, `/s/${SUB}/products`, `/s/${SUB}/product/zinger-burger`, `/s/${SUB}/cart`, `/s/${SUB}/checkout`])("%s has no card input fields", async (p) => {
      const r = await call(p);
      expect(r.body).not.toMatch(CARD_FIELD);
    });
    it("the payment page contains no card inputs either", async () => {
      if (!orderToken) return;
      const r = await call(`/s/${SUB}/pay/${orderToken}`);
      expect(r.body).not.toMatch(CARD_FIELD);
      expect(r.body).not.toMatch(/type="(text|tel|number)"[^>]*(card|cvv)/i);
    });
  });

  describe("PWA and web standards", () => {
    it("serves a valid web app manifest with an icon", async () => {
      const r = await call(`/s/${SUB}/manifest.webmanifest`);
      expect(r.status).toBe(200);
      const m = JSON.parse(r.body);
      expect(m).toMatchObject({ display: "standalone", scope: `/s/${SUB}/`, start_url: `/s/${SUB}` });
      expect(m.name).toBeTruthy();
      expect(m.icons.length).toBeGreaterThan(0);
      const icon = await call(m.icons[0].src);
      expect(icon.status).toBe(200);
      expect(icon.headers["content-type"]).toContain("image/svg+xml");
      expect(icon.body).toContain("<svg");
    });
    it("the service worker never caches private pages and is scoped to the store", async () => {
      const r = await call(`/s/${SUB}/sw.js`);
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toContain("javascript");
      expect(r.headers["service-worker-allowed"]).toBe(`/s/${SUB}/`);
      expect(r.body).toContain("admin|cart|checkout|pay|order");
      expect(r.body).not.toMatch(/cache\.put|caches\.open\(CACHE\)\.then\(c => c\.addAll/);
    });
    it("pages declare language, direction, a viewport and a canonical link on product pages", async () => {
      const r = await call(`/s/${SUB}/product/zinger-burger`);
      expect(r.body).toMatch(/<html lang="en"/);
      expect(r.body).toMatch(/lang="(en|ur)" dir="(ltr|rtl)"/);
      expect(r.body).toContain('name="viewport"');
      expect(r.body).toContain('rel="canonical"');
      expect(r.body).toContain("application/ld+json");
    });
    it("JSON-LD is valid JSON with offer details", async () => {
      const r = await call(`/s/${SUB}/product/zinger-burger`);
      const m = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(r.body);
      expect(m).toBeTruthy();
      const ld = JSON.parse(m![1].replace(/\\u003c/g, "<"));
      expect(ld["@type"]).toBe("Product");
      expect(ld.offers.priceCurrency).toBe("PKR");
    });
    it("skip link, landmarks and a single h1 are present", async () => {
      const r = await call(`/s/${SUB}`);
      expect(r.body).toContain('href="#main"');
      expect(r.body).toMatch(/<main id="main"/);
      expect(r.body).toMatch(/<header/);
      expect(r.body).toMatch(/<footer/);
      expect((r.body.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    });
    it("the 404 page is friendly and not a stack trace", async () => {
      const r = await call("/definitely-not-a-page");
      expect(r.status).toBe(404);
      expect(r.body).not.toMatch(/at \w+ \(|node_modules|ECONNREFUSED/);
    });
  });

  describe("privacy rights", () => {
    it("customer data export is owner-only and returns only that customer's data", async () => {
      expect((await call(`/s/${SUB}/admin/privacy/export?email=ayesha@test.local`)).status).toBe(403);
      const r = await call(`/s/${SUB}/admin/privacy/export?email=ayesha@test.local`, { cookie: ownerCookie });
      expect(r.status).toBe(200);
      const j = JSON.parse(r.body);
      expect(j.subject).toBe("ayesha@test.local");
      for (const o of j.orders) expect(o.customer.email).toBe("ayesha@test.local");
      expect(r.headers["cache-control"]).toBe("no-store");
      expect((await call(`/s/${SUB}/admin/privacy/export?email=not-an-email`, { cookie: ownerCookie })).status).toBe(400);
    });
    it("only essential cookies are set by storefront pages", async () => {
      const r = await call(`/s/${SUB}`);
      expect(r.headers["set-cookie"]).toBeUndefined();
    });
  });

  describe("link integrity: no broken internal links", () => {
    async function crawl(start: string[], cookie?: string, max = 60) {
      const seen = new Set<string>();
      const queue = [...start];
      const broken: string[] = [];
      while (queue.length && seen.size < max) {
        const path = queue.shift()!;
        if (seen.has(path)) continue;
        seen.add(path);
        const r = await call(path, { cookie });
        if (r.status >= 400) {
          broken.push(`${path} -> ${r.status}`);
          continue;
        }
        if (!/text\/html/.test(String(r.headers["content-type"]))) continue;
        for (const m of r.body.matchAll(/href="(\/[^"#]*)"/g)) {
          const href = m[1].replace(/&amp;/g, "&");
          if (href.startsWith("//") || href.startsWith("/_next") || /\.(css|js|svg|png|ico)$/.test(href)) continue;
          if (!seen.has(href)) queue.push(href);
        }
      }
      return { seen: seen.size, broken };
    }
    it("every link reachable from the storefront works", async () => {
      const r = await crawl([`/s/${SUB}`]);
      expect(r.broken).toEqual([]);
      expect(r.seen).toBeGreaterThan(8);
    });
    it("every link reachable from the store admin works", async () => {
      const r = await crawl([`/s/${SUB}/admin`], ownerCookie, 80);
      expect(r.broken).toEqual([]);
      expect(r.seen).toBeGreaterThan(10);
    });
  });

  describe("performance and load (local, against the real database)", () => {
    const percentile = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
    it("200 storefront requests at concurrency 20: no errors and sensible latency", async () => {
      const paths = [`/s/${SUB}`, `/s/${SUB}/products`, `/s/${SUB}/product/zinger-burger`, `/s/${SUB}/products?q=burger`];
      const lat: number[] = [];
      let errors = 0;
      for (let batch = 0; batch < 10; batch++) {
        const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call(paths[(batch + i) % paths.length])));
        for (const r of rs) {
          lat.push(r.ms);
          if (r.status >= 500) errors++;
        }
      }
      expect(errors).toBe(0);
      expect(percentile(lat, 50)).toBeLessThan(1500);
      expect(percentile(lat, 95)).toBeLessThan(5000);
      console.log(`load: p50=${percentile(lat, 50).toFixed(0)}ms p95=${percentile(lat, 95).toFixed(0)}ms p99=${percentile(lat, 99).toFixed(0)}ms n=${lat.length}`);
    });
    it("static platform pages are fast", async () => {
      const r = await call("/privacy");
      expect(r.ms).toBeLessThan(1000);
    });
  });
  describe("growth, rewards and back-office screens", () => {
    const ADMIN = ["quotes", "returns", "receive", "funnel", "links", "setup", "start", "promotions", "rewards", "suppliers", "bookings", "qr", "products"];
    it.each(ADMIN)("/admin/%s renders for the owner and is closed to strangers", async (page) => {
      expect((await call(`/s/${SUB}/admin/${page}`, { cookie: ownerCookie })).status).toBe(200);
      expect([302, 303, 307]).toContain((await call(`/s/${SUB}/admin/${page}`)).status);
    });
    it("keeps optional public features closed until the owner switches them on", async () => {
      expect((await call(`/s/${SUB}/feed.xml`)).status).toBe(404);
      expect((await call(`/s/${SUB}/book`)).status).toBe(404);
      expect((await call(`/s/${SUB}/compare`)).status).toBe(404);
    });
    it("keeps secret links secret", async () => {
      expect((await call(`/s/${SUB}/live/not-the-secret/orders`)).status).toBe(404);
      expect((await call(`/s/${SUB}/product/zinger-burger?preview=forged`)).status).toBe(200); // published: normal page, preview ignored
      expect((await call(`/s/${SUB}/cart/restore/short`)).status).toBe(307);
      expect((await call(`/s/${SUB}/suggest?q=zing`)).status).toBe(200);
      expect((await call(`/s/${SUB}/t/5`)).status).toBe(307);
    });
  });
});
