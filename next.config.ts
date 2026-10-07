import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [
      // AR Quick Look on iOS expects the USDZ media type; it is linked without a version, so it gets a short cache.
      { source: "/models/:file(.*\\.usdz)", headers: [{ key: "Content-Type", value: "model/vnd.usdz+zip" }, { key: "Cache-Control", value: "public, max-age=3600" }] },
      // GLB files are requested with ?v=<content hash> by the manifest; media file names carry a content hash.
      { source: "/models/:file(.*\\.(?:glb|json|hdr))", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/media/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/draco/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default nextConfig;
