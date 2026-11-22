import { loadStore } from "@/lib/commerce/load";
import { loadImage } from "@/lib/commerce/images";

export const dynamic = "force-dynamic";

/** Serves a store's uploaded picture. The store comes from the address, so a picture id from another store finds nothing. */
export async function GET(_req: Request, { params }: { params: Promise<{ sub: string; id: string }> }) {
  const { sub, id } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") return new Response("Not found", { status: 404 });
  const img = await loadImage(s.ctx, id);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "content-type": img.type,
      "cache-control": "public, max-age=31536000, immutable", // ids never change content
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}
