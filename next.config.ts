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
  // Next 16.1 option: experimental.turbopackMemoryLimit — BYTES (~1.25 GiB).
  experimental: {
    turbopackMemoryLimit: 1_310_720_000,
  },
};

export default nextConfig;
