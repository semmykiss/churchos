/** Cleanup: remove temp GL-test assets + their journals (restores DB to
 *  keyboard + projector state). Temp assets were created by test-asset-gl.sh. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const NAMES = ["GL Gain Path Test Bench", "GL Writeoff Test Chair"];

async function main() {
  const org = await db.organization.findFirst({ where: { name: { contains: "Grace" } } });
  if (!org) return console.log("no org");
  const assets = await db.asset.findMany({ where: { orgId: org.id, name: { in: NAMES } } });
  for (const a of assets) {
    const entries = await db.journalEntry.findMany({
      where: { orgId: org.id, sourceType: { in: ["asset_acquisition", "asset_disposal"] }, sourceId: a.id },
      select: { id: true, reference: true },
    });
    for (const e of entries) {
      const l = await db.journalLine.deleteMany({ where: { journalEntryId: e.id } });
      await db.journalEntry.delete({ where: { id: e.id } });
      console.log(`deleted JE ${e.reference} (+${l.count} lines) for "${a.name}"`);
    }
    const m = await db.assetMaintenanceLog.count({ where: { assetId: a.id } });
    const b = await db.assetBooking.count({ where: { assetId: a.id } });
    if (m || b) { console.log(`  SKIP — asset has ${m} maintenance / ${b} bookings`); continue; }
    await db.asset.delete({ where: { id: a.id } });
    console.log(`deleted asset "${a.name}" (${a.id})`);
  }
  const left = await db.asset.findMany({ where: { orgId: org.id }, select: { name: true, status: true } });
  const jn = await db.journalEntry.count({ where: { orgId: org.id, sourceType: { in: ["asset_acquisition", "asset_disposal"] } } });
  console.log(`\nremaining assets: ${left.map((a) => `${a.name} [${a.status}]`).join(", ")}`);
  console.log(`remaining asset journals: ${jn} (expect 2)`);
}
main().finally(() => db.$disconnect());
