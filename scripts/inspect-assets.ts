/**
 * Read-only inspection of asset module data (one org).
 * Run: bun scripts/inspect-assets.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const org = await db.organization.findFirst({ where: { slug: "gracechapel" } })
    ?? await db.organization.findFirst();
  console.log("org:", org?.id, org?.name);

  if (!org) return;

  const assets = await db.asset.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n== assets (${assets.length}) ==`);
  for (const a of assets) {
    console.log(`- ${a.id} | ${a.name} | cat=${a.category} status=${a.status} condition=${a.condition}`);
    console.log(`  cost=${a.purchaseCostCents} value=${a.currentValueCents} acquired=${a.acquiredAt?.toISOString() ?? null}`);
  }

  const maint = await db.assetMaintenanceLog.findMany({ where: { orgId: org.id } });
  console.log(`\n== maintenance (${maint.length}) ==`);
  for (const m of maint) console.log(`- asset=${m.assetId} ${m.description} cost=${m.costCents}`);

  const bookings = await db.assetBooking.findMany({ where: { orgId: org.id } });
  console.log(`\n== bookings (${bookings.length}) ==`);
  for (const b of bookings) console.log(`- asset=${b.assetId} "${b.title}" status=${b.status}`);

  const je = await db.journalEntry.findMany({
    where: { orgId: org.id, sourceType: { in: ["asset_acquisition", "asset_disposal"] } },
    include: { lines: true },
  });
  console.log(`\n== asset journal entries (${je.length}) ==`);
  for (const e of je) {
    console.log(`- ${e.reference} ${e.sourceType} memo="${e.memo}" date=${e.entryDate.toISOString()}`);
    for (const l of e.lines) console.log(`   line acct=${l.accountId} Dr=${l.debitCents} Cr=${l.creditCents}`);
  }
}

main().finally(() => db.$disconnect());
