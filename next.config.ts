import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [
      // AR Quick Look on iOS expects the USDZ media type; the default is application/octet-stream
      { source: "/models/:file(.*\\.usdz)", headers: [{ key: "Content-Type", value: "model/vnd.usdz+zip" }] },
      // Media and models are versioned with ?v=<hash> by the pipeline manifest, so they can be cached hard.
      { source: "/(media|models)/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
