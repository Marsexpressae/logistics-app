import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Some browsers and tools still ask for /favicon.ico directly.
    return [{ source: "/favicon.ico", destination: "/icon.svg", permanent: false }];
  },
  async headers() {
    return [
      {
        // Browsers must re-check the service worker on every visit so updates are never stuck.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
