// ─────────────────────────────────────────────────────────────────────────────
// scripts/cleanup-demo-events-users.ts
// Clears ALL demo events (and every event-related row) and deletes all
// directory Person records that are NOT linked to a portal login
// (Membership.personId). Portal-linked persons and their User accounts stay.
// Run:  bun scripts/cleanup-demo-events-users.ts
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../src/server/db";

const linked = await db.membership.findMany({ where: { personId: { not: null } }, select: { personId: true } });
const keepIds = linked.map((m) => m.personId!).filter(Boolean);
console.log("Portal-linked persons kept:", keepIds.length);

const victims = await db.person.findMany({ where: { id: { notIn: keepIds } }, select: { id: true, firstName: true, lastName: true, email: true } });
console.log("Non-portal demo persons to delete:", victims.length);
const ids = victims.map((p) => p.id);

const result = await db.$transaction(async (tx) => {
  const out: Record<string, number> = {};

  // ── 1. Demo events + everything hanging off them (safeguard; usually 0) ──
  out.eventRegistrations = (await tx.eventRegistration.deleteMany({})).count;
  out.eventTicketTypes = (await tx.eventTicketType.deleteMany({})).count;
  out.eventProgramItems = (await tx.eventProgramItem.deleteMany({})).count;
  out.attendanceRecords = (await tx.attendanceRecord.deleteMany({})).count;
  out.assignments = (await tx.assignment.deleteMany({})).count;
  out.events = (await tx.event.deleteMany({})).count;

  // ── 2. Dependents of non-portal persons ──
  const victimDonations = await tx.donation.findMany({ where: { personId: { in: ids } }, select: { id: true } });
  const victimCareCases = await tx.careCase.findMany({ where: { personId: { in: ids } }, select: { id: true } });
  out.donationSplits = (await tx.donationSplit.deleteMany({ where: { donationId: { in: victimDonations.map((d) => d.id) } } })).count;
  out.donations = (await tx.donation.deleteMany({ where: { personId: { in: ids } } })).count;
  out.pledges = (await tx.pledge.deleteMany({ where: { personId: { in: ids } } })).count;
  out.careNotes = (await tx.careNote.deleteMany({ where: { careCaseId: { in: victimCareCases.map((c) => c.id) } } })).count;
  out.careCases = (await tx.careCase.deleteMany({ where: { personId: { in: ids } } })).count;
  out.prayerRequests = (await tx.prayerRequest.deleteMany({ where: { personId: { in: ids } } })).count;
  out.chatParticipants = (await tx.chatParticipant.deleteMany({ where: { personId: { in: ids } } })).count;
  out.communicationPrefs = (await tx.communicationPreference.deleteMany({ where: { personId: { in: ids } } })).count;
  out.personMilestones = (await tx.personMilestone.deleteMany({ where: { personId: { in: ids } } })).count;
  out.personNotes = (await tx.personNote.deleteMany({ where: { personId: { in: ids } } })).count;
  out.personConsents = (await tx.personConsent.deleteMany({ where: { personId: { in: ids } } })).count;
  out.personTags = (await tx.personTag.deleteMany({ where: { personId: { in: ids } } })).count;
  out.stageHistory = (await tx.stageHistory.deleteMany({ where: { personId: { in: ids } } })).count;
  out.personRelationships = (await tx.personRelationship.deleteMany({ where: { OR: [{ fromPersonId: { in: ids } }, { toPersonId: { in: ids } }] } })).count;
  out.groupMemberships = (await tx.groupMember.deleteMany({ where: { personId: { in: ids } } })).count;
  out.householdMemberships = (await tx.householdMember.deleteMany({ where: { personId: { in: ids } } })).count;

  // ── 3. The persons themselves ──
  out.persons = (await tx.person.deleteMany({ where: { id: { in: ids } } })).count;

  // ── 4. Households left with zero members (demo artifacts) ──
  const emptyHouseholds = await tx.household.findMany({
    where: { members: { none: {} } },
    select: { id: true },
  });
  out.emptyHouseholds = (await tx.household.deleteMany({ where: { id: { in: emptyHouseholds.map((h) => h.id) } } })).count;

  return out;
});

console.log("\nDeleted:", JSON.stringify(result, null, 2));

// ── Verification ──
console.log("\n=== AFTER ===");
console.log("persons total:", await db.person.count());
console.log("persons remaining:", await db.person.findMany({ select: { firstName: true, lastName: true, email: true } }));
console.log("events:", await db.event.count(), "| registrations:", await db.eventRegistration.count(),
  "| ticketTypes:", await db.eventTicketType.count(), "| programItems:", await db.eventProgramItem.count());
console.log("users (portal accounts, untouched):", await db.user.count());
console.log("memberships:", await db.membership.count());
console.log("households:", await db.household.count(), "| groups:", await db.group.count());
console.log("donations:", await db.donation.count(), "| pledges:", await db.pledge.count());

await db.$disconnect();
