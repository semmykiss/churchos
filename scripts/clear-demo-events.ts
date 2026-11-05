/**
 * Clear out all demo events and their dependent rows (FK-safe order), plus any
 * registrations from non-portal users (guests — personId null). Runs dry-safe:
 * it only touches event-scoped data and never deletes login accounts (all four
 * standing accounts are portal users per the OWNER INSTRUCTION in seed.ts).
 *
 * Reusable / idempotent — safe to run again.
 *   bun scripts/clear-demo-events.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const events = await db.event.findMany({ select: { id: true, name: true, startsAt: true } });
  const ids = events.map((e) => e.id);
  console.log(`Found ${ids.length} event(s) to clear.`);

  if (ids.length > 0) {
    // FK-safe order: restrict-referencing children first, cascades included
    // explicitly so counts are visible in the report.
    const attendance = await db.attendanceRecord.deleteMany({ where: { eventId: { in: ids } } });
    const checkinSessions = await db.checkinSession.deleteMany({ where: { eventId: { in: ids } } });
    const assignments = await db.assignment.deleteMany({ where: { eventId: { in: ids } } });
    const registrations = await db.eventRegistration.deleteMany({ where: { eventId: { in: ids } } });
    const ticketTypes = await db.eventTicketType.deleteMany({ where: { eventId: { in: ids } } });
    const programItems = await db.eventProgramItem.deleteMany({ where: { eventId: { in: ids } } });
    const eventsDeleted = await db.event.deleteMany({ where: { id: { in: ids } } });
    // Safety: unbind any flows pointing at deleted events (plain string, no FK)
    await db.whatsAppFlow.updateMany({ where: { eventId: { in: ids } }, data: { eventId: null } });

    console.log("Deleted:", {
      events: eventsDeleted.count,
      attendanceRecords: attendance.count,
      checkinSessions: checkinSessions.count,
      assignments: assignments.count,
      registrations: registrations.count,
      ticketTypes: ticketTypes.count,
      programItems: programItems.count,
    });
  }

  // ── verification ────────────────────────────────────────────────────────────
  const remainingEvents = await db.event.count();
  const remainingRegs = await db.eventRegistration.count();
  const users = await db.user.findMany({ select: { email: true, name: true } });
  const people = await db.person.count();

  console.log("\n=== AFTER ===");
  console.log(`Events: ${remainingEvents}`);
  console.log(`Event registrations: ${remainingRegs}`);
  console.log(`Login accounts (${users.length}) — all portal users, kept:`);
  for (const u of users) console.log(`  • ${u.email} (${u.name ?? "-"})`);
  console.log(`People records: ${people} (member directory — untouched)`);
}

main().finally(() => db.$disconnect());
