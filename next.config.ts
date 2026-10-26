import type { NextConfig } from "next";

// output: "standalone" is REQUIRED by the sandbox publish pipeline
// (.zscripts/build.sh runs `bun run build` and expects .next/standalone/server.js
// to exist; its self-heal bails out if the config merely mentions standalone
// without producing the entry file — which is exactly what a conditional
// BUILD_STANDALONE spread caused, failing every Publish with an empty package).
// Vercel ignores standalone output and uses its own packaging, so this setting
// is safe for both deployment targets.
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Ensure the pre-seeded SQLite file + Prisma schema ship inside serverless
  // lambdas (read-only demo mode on Vercel; persistent writes need Turso —
  // see DEPLOYMENT.md). Keys cover both /api/auth and /api/auth/route styles.
  outputFileTracingIncludes: {
    "/api/**": ["./db/**", "./prisma/**"],
    "/api/**/*": ["./db/**", "./prisma/**"],
    "/**/*": ["./db/custom.db"],
  },
};

export default nextConfig;
