import type { NextConfig } from "next";

// Security headers for every response (OWASP ASVS L2, SRS NFR-09). The Content-Security-Policy with a
// per-request nonce is set in src/proxy.ts.

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      { source: "/s/:sub/admin/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/s/:sub/cart", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/s/:sub/checkout", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/s/:sub/pay/:token", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/s/:sub/order/:token", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
