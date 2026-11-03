/**
 * Read-only inspection of asset GL posting state.
 * Verifies: assets, their GL journals (acquisition/disposal), and that every
 * asset journal is balanced (debits == credits).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const org = await db.organization.findFirst({ where: { name: { contains: "Grace" } } });
  if (!org) { console.log("No Grace tenant found"); return; }
  console.log("ORG:", org.name, org.id);

  const assets = await db.asset.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n== ASSETS (${assets.length}) ==`);
  for (const a of assets) {
    console.log(`- ${a.name} [${a.tag ?? "no tag"}] cat=${a.category} status=${a.status} cost=${a.purchaseCostCents ?? null} curVal=${a.currentValueCents ?? null}`);
    if (a.status === "disposed") {
      console.log(`    disposedAt=${a.disposedAt?.toISOString()} proceeds=${a.disposalProceedsCents} bookValue=${a.disposalBookValueCents} by=${a.disposedByName}`);
    }
  }

  const maint = await db.assetMaintenanceLog.count({ where: { orgId: org.id } });
  const bookings = await db.assetBooking.findMany({ where: { orgId: org.id } });
  console.log(`\nmaintenance logs: ${maint}`);
  console.log(`bookings: ${bookings.length}`);
  for (const b of bookings) console.log(`  - ${b.title} status=${b.status}`);

  const journals = await db.journalEntry.findMany({
    where: { orgId: org.id, sourceType: { in: ["asset_acquisition", "asset_disposal"] } },
    include: { lines: true },
    orderBy: { entryDate: "asc" },
  });
  console.log(`\n== ASSET GL JOURNALS (${journals.length}) ==`);
  for (const j of journals) {
    const debits = j.lines.reduce((s, l) => s + l.debitCents, 0);
    const credits = j.lines.reduce((s, l) => s + l.creditCents, 0);
    const acctIds = [...new Set(j.lines.map((l) => l.accountId))];
    const accts = await db.account.findMany({ where: { id: { in: acctIds } }, select: { id: true, code: true, name: true } });
    const amap = new Map(accts.map((a) => [a.id, a] as const));
    console.log(`\n${j.reference} [${j.sourceType}] date=${j.entryDate.toISOString().slice(0, 10)} memo="${j.memo}" reversedBy=${j.reversedByEntryId ?? "-"}`);
    for (const l of j.lines) {
      const a = amap.get(l.accountId);
      console.log(`   ${l.debitCents ? "Dr" : "Cr"} ${a?.code ?? "?"} ${a?.name ?? "?"} — ${(l.debitCents || l.creditCents) / 100} NGN`);
    }
    console.log(`   balanced: ${debits === credits ? "YES ✓" : `NO ✗ (D=${debits} C=${credits})`}`);
    // cross-check sourceId belongs to this org
    if (j.sourceId) {
      const src = await db.asset.findFirst({ where: { id: j.sourceId, orgId: org.id } });
      console.log(`   source asset: ${src ? src.name : "MISSING!"}`);
    }
  }

  // confirm the chart has the fixed-asset + gain/loss accounts
  const codes = ["1000", "1500", "1510", "1520", "1530", "4600", "5900"];
  const chart = await db.account.findMany({ where: { orgId: org.id, code: { in: codes } }, select: { code: true, name: true, type: true } });
  console.log(`\n== CHART ACCOUNTS PRESENT ==`);
  const have = new Set(chart.map((c) => c.code));
  for (const c of codes) {
    const a = chart.find((x) => x.code === c);
    console.log(`  ${c}: ${a ? `${a.name} (${a.type})` : "MISSING!"}`);
  }
}

main().finally(() => db.$disconnect());
