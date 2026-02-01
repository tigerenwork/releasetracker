import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Enable standalone output for Docker deployment
  output: 'standalone',
  // Disable turbopack for now since we need webpack config for better-sqlite3
  turbopack: {},
};

export default nextConfig;
