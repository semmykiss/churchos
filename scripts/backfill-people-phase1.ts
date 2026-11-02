// ─────────────────────────────────────────────────────────────────────────────
// scripts/backfill-people-phase1.ts — idempotent Phase 1 backfill (People CRM)
//
//   1. phoneE164      ← normalizeToE164(phone)   (Nigeria default, never throws;
//                       unparseable raw values keep phoneE164 null)
//   2. lastAttendedAt ← latest AttendanceRecord.checkedInAt per person
//                       (derived like phoneE164 — fully re-derivable, so the
//                       migration stays reversible via the .down.sql)
//
// Safe to run repeatedly after db:push. NEVER re-seeds anything.
// Run:  bun scripts/backfill-people-phase1.ts
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../src/server/db";
import { normalizeToE164 } from "../src/lib/phone";

async function main() {
  const people = await db.person.findMany({
    select: { id: true, phone: true, phoneE164: true, lastAttendedAt: true },
  });
  console.log(`Backfilling ${people.length} people…`);

  let phoneFixed = 0;
  let phoneUnparseable = 0;
  let attendanceFixed = 0;

  // 1) phoneE164 from raw phone
  for (const p of people) {
    const norm = normalizeToE164(p.phone);
    if (!norm) {
      if (p.phone && p.phone.trim()) phoneUnparseable++;
      if (p.phoneE164 !== null) {
        await db.person.update({ where: { id: p.id }, data: { phoneE164: null } });
        phoneFixed++;
      }
      continue;
    }
    if (p.phoneE164 !== norm) {
      await db.person.update({ where: { id: p.id }, data: { phoneE164: norm } });
      phoneFixed++;
    }
  }

  // 2) lastAttendedAt from attendance records (one grouped query)
  const latest = await db.attendanceRecord.groupBy({
    by: ["personId"],
    _max: { checkedInAt: true },
  });
  const latestByPerson = new Map(latest.map((l) => [l.personId, l._max.checkedInAt]));
  for (const p of people) {
    const max = latestByPerson.get(p.id) ?? null;
    if ((p.lastAttendedAt?.getTime() ?? 0) !== (max?.getTime() ?? 0)) {
      await db.person.update({ where: { id: p.id }, data: { lastAttendedAt: max } });
      attendanceFixed++;
    }
  }

  console.log(`phoneE164 updated: ${phoneFixed} (unparseable raw kept null: ${phoneUnparseable})`);
  console.log(`lastAttendedAt updated: ${attendanceFixed}`);
}

main()
  .then(async () => { await db.$disconnect(); process.exit(0); })
  .catch(async (err) => {
    console.error("FAILED:", err);
    await db.$disconnect();
    process.exit(1);
  });
