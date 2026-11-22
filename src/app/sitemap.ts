import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${env().baseDomain}`;
  return ["", "/stores", "/toggles", "/privacy", "/terms"].map((p) => ({ url: `${base}${p}`, lastModified: new Date() }));
}
