/**
 * One-off inspection of giving data (read-only).
 * Usage: bun scripts/inspect-giving.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true, slug: true } });
  console.log("ORGS:", orgs.map((o) => `${o.name} (${o.slug}) ${o.id}`).join(" | "));

  for (const o of orgs) {
    const memberships = await db.membership.findMany({
      where: { orgId: o.id },
      select: { user: { select: { email: true, name: true } }, userId: true },
    });
    const donations = await db.donation.count({ where: { orgId: o.id } });
    const batches = await db.batch.count({ where: { orgId: o.id } });
    const jes = await db.journalEntry.count({ where: { orgId: o.id } });
    const pledges = await db.pledge.count({ where: { orgId: o.id } });
    const rg = await db.recurringGift.count({ where: { orgId: o.id } });
    const stmts = await db.givingStatement.count({ where: { orgId: o.id } });
    const op = await db.onlinePayment.count({ where: { orgId: o.id } });
    const notifs = await db.notification.count({ where: { orgId: o.id } });
    const commitments = await db.givingCommitment.count({ where: { orgId: o.id } });
    const paymentMethods = await db.paymentMethod.count({ where: { orgId: o.id } });
    const groups = await db.group.count({ where: { orgId: o.id } });
    const people = await db.person.count({ where: { orgId: o.id } });
    console.log(`\nORG ${o.name} (${o.id})`);
    console.log(`  people=${people} memberships=${memberships.length} groups=${groups}`);
    console.log(`  donations=${donations} batches=${batches} JEs=${jes} pledges=${pledges} recurring=${rg} statements=${stmts} onlinePay=${op} notifications=${notifs} commitments=${commitments} paymentMethods=${paymentMethods}`);
    console.log("  members:", memberships.map((m) => `${m.user.name} <${m.user.email}>`).join(", "));

    const batchRows = await db.batch.findMany({ where: { orgId: o.id }, select: { name: true, serviceName: true, status: true, verificationStatus: true, totalCents: true, countedByOne: true, countedByTwo: true } });
    for (const b of batchRows) {
      console.log(`   batch: ${b.name} | svc=${b.serviceName} | ${b.status}/${b.verificationStatus} | ${(b.totalCents / 100).toLocaleString()} | by: ${b.countedByOne} + ${b.countedByTwo}`);
    }
    const jeRows = await db.journalEntry.findMany({ where: { orgId: o.id }, select: { sourceType: true, memo: true, entryDate: true } });
    for (const je of jeRows.slice(0, 30)) {
      console.log(`   JE: ${je.sourceType} | ${je.memo?.slice(0, 60)} | ${je.entryDate.toISOString().slice(0, 10)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
