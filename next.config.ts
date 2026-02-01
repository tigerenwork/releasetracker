import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Disable turbopack for now since we need webpack config for better-sqlite3
  turbopack: {},
};

export default nextConfig;
