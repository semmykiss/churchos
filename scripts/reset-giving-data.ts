/**
 * One-off maintenance (owner-ordered):
 *  1. Split the merged "Tithes & Offerings" system fund into separate
 *     "Tithe" (110) + "Offering" (115) categories.
 *  2. Clear ALL giving transactions for the demo church so the owner can
 *     start recording fresh ones:
 *     - DonationSplit + Donation (every status)
 *     - Batch (count sheets / offering batches)
 *     - JournalEntry(sourceType in donation/online_gift/reversal/backfill) + lines
 *     - Giving notifications that reference the deleted sheets
 *  Kept on purpose: funds, chart of accounts, payment methods, recurring-gift
 *  schedules, pledges/covenants, people, users, roles, audit trail.
 *
 * TENANT SAFETY: every delete is scoped to the Grace Chapel orgId — the
 * partner portal and any other org are untouched. No user is created or
 * removed (owner instruction: maintain only the current users).
 *
 * Usage: bun scripts/reset-giving-data.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** Journal sources that exist only because a gift/batch was posted. */
const GIFT_JE_SOURCES = ["donation", "online_gift", "reversal", "backfill"];

async function main() {
  const org = await db.organization.findFirst({ where: { slug: "grace-chapel" }, select: { id: true, name: true } });
  if (!org) throw new Error("Grace Chapel org not found — refusing to run.");
  const orgId = org.id;
  console.log(`Tenant: ${org.name} (${orgId})`);

  // ── 1. Funds: split the merged category ────────────────────────────────────
  const merged = await db.fund.findFirst({ where: { orgId, name: "Tithes & Offerings" } });
  if (merged) {
    await db.fund.update({ where: { id: merged.id }, data: { name: "Tithe", type: "tithe", isSystemFund: true, isTaxDeductible: true } });
    console.log(`[fund] renamed "Tithes & Offerings" (code ${merged.code}) -> "Tithe"`);
  }
  const offering = await db.fund.findFirst({ where: { orgId, code: "115" } });
  if (!offering) {
    await db.fund.create({
      data: { orgId, name: "Offering", code: "115", type: "general", isSystemFund: true, isTaxDeductible: true, sortOrder: 2 },
    });
    console.log('[fund] created "Offering" (code 115, system)');
  } else if (offering.name !== "Offering") {
    await db.fund.update({ where: { id: offering.id }, data: { name: "Offering" } });
    console.log(`[fund] normalized fund 115 -> "Offering"`);
  }

  // ── 2. Wipe transactions (tenant-scoped, children first) ──────────────────
  const jeIds = (
    await db.journalEntry.findMany({
      where: { orgId, sourceType: { in: GIFT_JE_SOURCES } },
      select: { id: true },
    })
  ).map((je) => je.id);

  const delJELines = jeIds.length ? await db.journalLine.deleteMany({ where: { orgId, journalEntryId: { in: jeIds } } }) : { count: 0 };
  const delJE = jeIds.length ? await db.journalEntry.deleteMany({ where: { orgId, id: { in: jeIds } } }) : { count: 0 };
  const delSplits = await db.donationSplit.deleteMany({ where: { orgId } });
  const delDonations = await db.donation.deleteMany({ where: { orgId } });
  const delBatches = await db.batch.deleteMany({ where: { orgId } });
  // notifications that point at wiped sheets (giving module only)
  const delNotifs = await db.notification.deleteMany({ where: { orgId, module: "giving" } });

  console.log(`[wipe] journalLines=${delJELines.count} journalEntries=${delJE.count} splits=${delSplits.count} donations=${delDonations.count} batches=${delBatches.count} givingNotifications=${delNotifs.count}`);

  // ── 3. Verify end state ─────────────────────────────────────────────────────
  const funds = await db.fund.findMany({ where: { orgId }, orderBy: { sortOrder: "asc" }, select: { name: true, code: true } });
  console.log(`[verify] donations=${await db.donation.count({ where: { orgId } })} batches=${await db.batch.count({ where: { orgId } })} JEs=${await db.journalEntry.count({ where: { orgId } })}`);
  console.log(`[verify] funds: ${funds.map((f) => `${f.name} (${f.code})`).join(", ")}`);
  console.log("DONE — clean slate, ready for fresh transactions.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
