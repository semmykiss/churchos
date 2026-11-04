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
  // PROVEN OOM EVIDENCE (kernel log): next-server killed at anon-rss 1.97GB
  // and again at 1.75GB on this 4GB pod. JS heap is separately capped via
  // NODE_OPTIONS in scripts/dev-watchdog.sh; this value caps the NATIVE
  // (Rust/Turbopack) side. ~0.75 GiB keeps cold compiles comfortable while
  // leaving headroom for browser/spike bursts. scripts/dev-watchdog.sh
  // restarts the server automatically if it ever dies anyway.
  // Next 16.1 option: experimental.turbopackMemoryLimit — BYTES.
  experimental: {
    turbopackMemoryLimit: 786_432_000,
  },
};

export default nextConfig;
