import type { NextConfig } from "next";

// Vercel: default Next.js build (no standalone). Docker/self-host: BUILD_STANDALONE=true
const nextConfig: NextConfig = {
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" as const } : {}),
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
