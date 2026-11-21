import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#4f46e5", width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PLATFORM_BASE_DOMAIN && !process.env.PLATFORM_BASE_DOMAIN.startsWith("localhost") ? `https://${process.env.PLATFORM_BASE_DOMAIN}` : "http://localhost:3000"),
  title: "Multi-Tenant Ecommerce Platform",
  description: "Launch a complete online store for any business.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
