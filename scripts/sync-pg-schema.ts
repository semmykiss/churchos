/**
 * Generate prisma/schema.postgres.prisma from prisma/schema.prisma.
 *
 * Why two schemas: local dev (and this sandbox) runs on SQLite; Vercel's
 * serverless runtime needs a hosted database (Neon / Vercel Postgres). Prisma
 * bakes the provider into the generated client, so the deployment build uses
 * the postgres twin of the schema. Models live ONLY in schema.prisma — run
 * this script after every schema change so the twin never drifts:
 *
 *   bun run schema:sync:pg
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "prisma/schema.prisma";
const OUT = "prisma/schema.postgres.prisma";

const src = readFileSync(SRC, "utf8");

// Replace the datasource block (provider sqlite → postgresql + Vercel targets).
const pgDatasource = `datasource db {
  provider      = "postgresql"
  url           = env("DATABASE_URL")
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}`;

const replaced = src.replace(
  /datasource\s+db\s*\{[\s\S]*?\}/,
  pgDatasource,
);
if (replaced === src) {
  console.error("sync-pg-schema: could not find the datasource block in schema.prisma");
  process.exit(1);
}
if (!replaced.includes('provider      = "postgresql"')) {
  console.error("sync-pg-schema: datasource replacement failed");
  process.exit(1);
}

writeFileSync(OUT, replaced);
console.log(`sync-pg-schema: wrote ${OUT} (postgresql twin of schema.prisma)`);
