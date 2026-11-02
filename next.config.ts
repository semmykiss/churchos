import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Small-sandbox guard: the dev-server API graph is large; cap Turbopack's
  // heap so it collects garbage instead of being reaped by the OOM killer
  // mid-compile (which otherwise loops: respawn → compile → OOM → respawn).
  turbopack: {
    memoryLimit: 1536,
  },
};

export default nextConfig;
