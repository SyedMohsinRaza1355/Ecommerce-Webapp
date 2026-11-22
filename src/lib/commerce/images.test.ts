import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getClient, closeClient } from "@/lib/db/client";
import { provisionInstance } from "@/lib/platform/provision";
import { issueTenantContext, dbNameFor, type TenantContext } from "@/lib/tenant/context";
import { tenantDb } from "@/lib/tenant/schema";
import { sniffImage, saveImage, loadImage, MAX_IMAGE_BYTES, IMAGE_PATH_RE } from "./images";
import { ProductInput } from "./store";
import type { Actor } from "@/lib/auth/rbac";

const HAS_DB = Boolean(process.env.MONGODB_URI);
const sa: Actor = { userId: "sa-test", role: "super_admin", instanceId: null };
const PLATFORM = `test_img_${Math.random().toString(36).slice(2, 8)}`;
const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(Math.max(0, 16 - b.length)).fill(0)]);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

describe("picture type detection", () => {
  it("accepts real raster pictures by their first bytes", () => {
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(GIF)).toBe("image/gif");
    expect(sniffImage(WEBP)).toBe("image/webp");
  });
  it("refuses SVG, HTML, scripts, empty and truncated data however they are named", () => {
    const text = (s: string) => new TextEncoder().encode(s.padEnd(16, " "));
    expect(sniffImage(text("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(sniffImage(text("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(text("GIF89a<script>"))).toBe("image/gif"); // looks like a GIF: it is only ever served as an image with nosniff and a locked-down policy
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(bytes(0xff, 0xd8))).toBeNull(); // FF D8 then padding is not a JPEG signature
    expect(sniffImage(new Uint8Array(11).fill(0xff))).toBeNull();
    expect(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull(); // RIFF but WAVE, not WEBP
  });
  it("only our own picture paths are accepted as product images", () => {
    expect(IMAGE_PATH_RE.test("/s/demo/img/123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    for (const bad of ["/s/demo/img/../../admin", "//evil.com/x.png", "/s/demo/img/zzz", "javascript:alert(1)", "/s/DEMO/img/123e4567-e89b-12d3-a456-426614174000", "/s/demo/img/123e4567-e89b-12d3-a456-426614174000?x=1", "http://x.com/a.png"]) expect(IMAGE_PATH_RE.test(bad), bad).toBe(false);
    const ok = (imageUrl: string) => ProductInput.safeParse({ name: "x", price: "1", stock: 1, status: "draft", imageUrl }).success;
    expect(ok("/s/demo/img/123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(ok("https://cdn.example.com/a.png")).toBe(true);
    expect(ok("/etc/passwd")).toBe(false);
    expect(ok("javascript:alert(1)")).toBe(false);
  });
});

describe.skipIf(!HAS_DB)("picture storage (Atlas, synthetic tenants)", () => {
  const created: string[] = [];
  let A: TenantContext, B: TenantContext;
  const make = async (sub: string) => {
    const r = await provisionInstance(sa, { name: `Store ${sub}`, subdomain: sub, packId: "restaurant", planId: "pro", ownerEmail: "o@x.com" });
    if (!r.ok) throw new Error(r.message);
    created.push(r.instanceId);
    return issueTenantContext(r.instanceId);
  };
  beforeAll(async () => { process.env.PLATFORM_DB_NAME = PLATFORM; A = await make("img-a"); B = await make("img-b"); });
  afterAll(async () => {
    const client = await getClient();
    for (const id of created) await client.db(dbNameFor(id)).dropDatabase();
    await client.db(PLATFORM).dropDatabase();
    await closeClient();
  });

  it("stores a picture and gives back a path that serves exactly the same bytes", async () => {
    const data = new Uint8Array([...JPEG, 1, 2, 3, 4, 5]);
    const r = await saveImage(A, "img-a", data);
    if (!r.ok) throw new Error(r.error);
    expect(IMAGE_PATH_RE.test(r.url)).toBe(true);
    const id = r.url.split("/").pop()!;
    const got = await loadImage(A, id);
    expect(got?.type).toBe("image/jpeg");
    expect([...got!.data]).toEqual([...data]);
  });
  it("another store cannot read it, and bad ids find nothing", async () => {
    const r = await saveImage(A, "img-a", JPEG);
    if (!r.ok) throw new Error(r.error);
    const id = r.url.split("/").pop()!;
    expect(await loadImage(B, id)).toBeNull();
    for (const bad of ["", "nope", "../../etc/passwd", id + "x", "%00"]) expect(await loadImage(A, bad), bad).toBeNull();
  });
  it("refuses wrong types, empty and oversized files", async () => {
    expect(await saveImage(A, "img-a", new TextEncoder().encode("<svg onload=alert(1)></svg>"))).toMatchObject({ ok: false });
    expect(await saveImage(A, "img-a", new Uint8Array(0))).toMatchObject({ ok: false });
    expect(await saveImage(A, "img-a", new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff))).toMatchObject({ ok: false, error: expect.stringContaining("too big") });
    expect(await (await tenantDb(A)).collection("images").countDocuments({ type: { $nin: ["image/jpeg", "image/png", "image/gif", "image/webp"] } })).toBe(0);
  });
});
