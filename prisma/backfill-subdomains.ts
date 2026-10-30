/**
 * One-time backfill — existing tenants into SubdomainRegistry (spec §8:
 * "existing tenants are backfilled with a generated subdomain without
 * disrupting their current access/data"). Idempotent — safe to re-run.
 * Run: bun prisma/backfill-subdomains.ts
 */
import { backfillSubdomainRegistry } from "../src/server/services/tenant/subdomain";

backfillSubdomainRegistry()
  .then((r) => {
    console.log(`[backfill] reserved ${r.reserved} subdomain(s), skipped ${r.skipped} (already registered).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exit(1);
  });
