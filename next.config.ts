import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  outputFileTracingIncludes: { "/api/brief": ["./public/fonts/NotoSans-*.ttf"] },
  async headers() {
    return [{ source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};
export default config;
