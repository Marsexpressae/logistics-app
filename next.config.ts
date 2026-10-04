import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hides the little round "N" developer button in the local copy. Build and runtime errors still show.
  devIndicators: false,
  async redirects() {
    // Some browsers and tools still ask for /favicon.ico directly.
    return [
      { source: "/favicon.ico", destination: "/icon.svg", permanent: false },
      // Users and Roles now live under Settings; old bookmarks still work.
      { source: "/users", destination: "/settings/users", permanent: false },
      { source: "/roles", destination: "/settings/roles", permanent: false },
    ];
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
