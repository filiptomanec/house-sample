import type { NextConfig } from "next";
import path from "node:path";
import { SITE } from "./src/lib/site-config";

/**
 * Security headers on every response (pages, files, the 404 page). frame-ancestors lets only the site itself and the
 * origins in SITE.embedOrigins show it in an iframe (X-Frame-Options is not sent: CSP supersedes it and it cannot list
 * origins). Permissions-Policy switches off the powerful features the site never uses. Asserted by e2e/tests/headers.spec.ts.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: [`frame-ancestors 'self' ${SITE.embedOrigins.join(" ")}`, "base-uri 'self'", "object-src 'none'"].join("; ") },
];

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  poweredByHeader: false,
  experimental: {
    // the root layout sits under the dynamic [locale] segment, so unmatched URLs outside a locale (/index.html,
    // /models/x.glb, and whatever the platform short-circuits) get src/app/global-not-found.tsx instead of Next's default
    globalNotFound: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // AR Quick Look on iOS expects the USDZ media type; it is linked without a version, so it gets a short cache.
      { source: "/models/:file(.*\\.usdz)", headers: [{ key: "Content-Type", value: "model/vnd.usdz+zip" }, { key: "Cache-Control", value: "public, max-age=3600" }] },
      // GLB files are requested with ?v=<content hash> by the manifest; media file names carry a content hash.
      { source: "/models/:file(.*\\.(?:glb|hdr))", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/media/:path*/:file(.*\\.(?:jpg|jpeg|png|webp|avif|mp4))", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/media/:file(.*\\.(?:jpg|jpeg|png|webp|avif|mp4))", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/draco/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default nextConfig;
