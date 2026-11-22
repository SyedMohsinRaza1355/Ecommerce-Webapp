import { randomUUID } from "node:crypto";
import { Binary } from "mongodb";
import { tenantDb } from "@/lib/tenant/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { rateLimit } from "@/lib/auth/ratelimit";

// Picture uploads without any outside service: small, already-shrunk images are kept in the
// store's own database and served from the store's own address. Only real raster images are accepted
// (never SVG, which can carry scripts).
export const MAX_IMAGE_BYTES = 300 * 1024;
export const MAX_IMAGES_PER_STORE = 200;

export type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Decides the type from the file's first bytes, ignoring whatever name or type the browser claimed. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export const IMAGE_PATH_RE = /^\/s\/[a-z0-9-]{1,40}\/img\/[0-9a-f-]{36}$/;

export async function saveImage(ctx: TenantContext, sub: string, bytes: Uint8Array): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (bytes.length === 0) return { ok: false, error: "Choose a picture first." };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: `That picture is too big (${Math.round(bytes.length / 1024)} KB). The limit is ${MAX_IMAGE_BYTES / 1024} KB; pictures are shrunk automatically, so try a different one.` };
  const type = sniffImage(bytes);
  if (!type) return { ok: false, error: "Only JPG, PNG, WebP or GIF pictures are allowed." };
  if (!(await rateLimit(`img:${ctx.instanceId}`, 40, 10 * 60_000)).ok) return { ok: false, error: "Too many uploads. Wait a few minutes." };
  const c = (await tenantDb(ctx)).collection("images");
  if ((await c.countDocuments({ instanceId: ctx.instanceId })) >= MAX_IMAGES_PER_STORE) return { ok: false, error: `Your picture library is full (${MAX_IMAGES_PER_STORE} pictures).` };
  const id = randomUUID();
  await c.insertOne({ _id: id as never, instanceId: ctx.instanceId, type, size: bytes.length, data: new Binary(Buffer.from(bytes)), createdAt: new Date() });
  return { ok: true, url: `/s/${sub}/img/${id}` };
}

export async function loadImage(ctx: TenantContext, id: string): Promise<{ type: ImageType; data: Buffer } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const d = await (await tenantDb(ctx)).collection("images").findOne({ _id: id as never, instanceId: ctx.instanceId });
  if (!d) return null;
  return { type: d.type as ImageType, data: Buffer.from((d.data as Binary).buffer) };
}
