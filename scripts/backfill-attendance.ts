// One-off repair: door check-ins that succeeded on the registration counter but
// crashed before writing their AttendanceRecord row (the checkedInBy bug).
// Idempotent — upserts by (personId, eventId).
import { db } from "../src/server/db";

const regs = await db.eventRegistration.findMany({
  where: { checkedInSeats: { gt: 0 }, personId: { not: null } },
  include: { event: { select: { name: true } } },
});

let fixed = 0;
for (const r of regs) {
  const existing = await db.attendanceRecord.findUnique({
    where: { personId_eventId: { personId: r.personId!, eventId: r.eventId } },
  });
  if (existing) continue;
  await db.attendanceRecord.create({
    data: {
      orgId: r.orgId,
      personId: r.personId!,
      eventId: r.eventId,
      status: "checked_in",
      method: "kiosk",
      checkedInAt: r.checkedInAt ?? r.updatedAt,
      checkedInByName: r.checkedInBy ?? undefined,
    },
  });
  fixed++;
  console.log(`backfilled attendance: ${r.personId} @ ${r.event.name} (${r.checkedInSeats} seats)`);
}
console.log(`done — ${fixed} row(s) backfilled, ${regs.length} order(s) scanned`);

await db.$disconnect();
