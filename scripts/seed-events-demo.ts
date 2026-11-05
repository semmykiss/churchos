// ─────────────────────────────────────────────────────────────────────────────
// scripts/seed-events-demo.ts — ONE-OFF DEMO SEED (backend only)
//
// Seeds the Events & Registration demo for Grace Chapel:
//   • "Holy Ghost Service — Night of Wonders" (convention, free + paid tickets,
//     run-sheet program, member & guest orders incl. waitlist + payment pending)
//   • "Youth Retreat — Mountain Top Experience" (retreat, paid pack, program)
//
// Idempotent: skips events that already exist (orgId + name + startsAt unique).
// Run:  bun scripts/seed-events-demo.ts
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "crypto";
import { db } from "../src/server/db";

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 864e5);
}

function at(base: Date, hours: number, minutes = 0): Date {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function qr(): string {
  return `evt_${randomBytes(16).toString("hex")}`;
}

async function main() {
  const org = await db.organization.findFirst({ where: { slug: "grace-chapel" } });
  if (!org) {
    console.error("Grace Chapel org not found — run the main seed first.");
    process.exit(1);
  }
  const campus = await db.campus.findFirst({ where: { orgId: org.id, isPrimary: true } });
  if (!campus) {
    console.error("Primary campus not found.");
    process.exit(1);
  }
  const people = await db.person.findMany({
    where: { orgId: org.id },
    select: { id: true, firstName: true, lastName: true },
    take: 8,
    orderBy: { createdAt: "asc" },
  });
  console.log(`Org ${org.name} · campus ${campus.name} · ${people.length} people for demo orders.`);

  const today = new Date();
  const now = new Date();

  /* ── Holy Ghost Service ─────────────────────────────────────────────────── */
  const hgStart = at(addDays(today, 10), 20, 0);
  const hgEnd = at(addDays(today, 10), 23, 30);
  let hg = await db.event.findFirst({
    where: { orgId: org.id, name: "Holy Ghost Service — Night of Wonders" },
  });
  if (!hg) {
    hg = await db.event.create({
      data: {
        orgId: org.id,
        campusId: campus.id,
        name: "Holy Ghost Service — Night of Wonders",
        kind: "convention",
        startsAt: hgStart,
        endsAt: hgEnd,
        roomText: "Main Auditorium",
        capacity: 600,
        checkinEnabled: false,
        status: "scheduled",
        createdByName: "David Adeyemi",
        registrationEnabled: true,
        registrationCapacity: 500,
        registrationDeadline: at(addDays(today, 9), 12, 0),
        registrationNote: "Free buses leave from the main gate at 5:30pm. Come with your QR ticket.",
      },
    });
    console.log("created event: Holy Ghost Service");
  } else {
    console.log("event exists: Holy Ghost Service — skipping event creation");
  }

  const hgTypes = await db.eventTicketType.findMany({ where: { eventId: hg.id } });
  let general = hgTypes.find((t) => t.name === "General");
  let vip = hgTypes.find((t) => t.name === "VIP (Dinner + Front Row)");
  let students = hgTypes.find((t) => t.name === "Students");
  if (!general) {
    general = await db.eventTicketType.create({
      data: {
        orgId: org.id, eventId: hg.id, name: "General",
        description: "Free seating — arrive early for the best spots.",
        priceCents: 0, capacity: 400, maxPerOrder: 5, sortOrder: 0,
      },
    });
  }
  if (!vip) {
    vip = await db.eventTicketType.create({
      data: {
        orgId: org.id, eventId: hg.id, name: "VIP (Dinner + Front Row)",
        description: "Reserved front-row seating and pre-service dinner from 6pm.",
        priceCents: 1_500_000, capacity: 50, maxPerOrder: 4, sortOrder: 1,
      },
    });
  }
  if (!students) {
    students = await db.eventTicketType.create({
      data: {
        orgId: org.id, eventId: hg.id, name: "Students",
        description: "Campus fellowship block — valid student ID required at the door.",
        priceCents: 50_000, capacity: 60, maxPerOrder: 2, sortOrder: 2,
      },
    });
  }
  const hgTypeByName = { general, vip, students };
  console.log("ticket types ready:", Object.keys(hgTypeByName).map((k) => hgTypeByName[k as keyof typeof hgTypeByName].name).join(", "));

  const hgProgram = await db.eventProgramItem.count({ where: { eventId: hg.id } });
  if (hgProgram === 0) {
    await db.eventProgramItem.createMany({
      data: [
        { orgId: org.id, eventId: hg.id, title: "Praise & worship", speaker: "Grace Chapel Choir", startsAt: at(hgStart, 20, 0), endsAt: at(hgStart, 20, 45), roomText: "Main Auditorium", notes: "Live stream starts 20:15" },
        { orgId: org.id, eventId: hg.id, title: "Word ministration", speaker: "Pastor David Adeyemi", startsAt: at(hgStart, 20, 45), endsAt: at(hgStart, 21, 45), roomText: "Main Auditorium" },
        { orgId: org.id, eventId: hg.id, title: "Intercession for the nation", speaker: "Prayer Band", startsAt: at(hgStart, 21, 45), endsAt: at(hgStart, 22, 0), roomText: "Main Auditorium" },
        { orgId: org.id, eventId: hg.id, title: "Holy Ghost blast — altar ministry", speaker: "Pastor David Adeyemi", startsAt: at(hgStart, 22, 0), endsAt: at(hgStart, 23, 0), roomText: "Main Auditorium", notes: "Ushers on all aisles" },
        { orgId: org.id, eventId: hg.id, title: "Thanksgiving & benediction", startsAt: at(hgStart, 23, 0), endsAt: at(hgStart, 23, 30), roomText: "Main Auditorium" },
      ],
    });
    console.log("program seeded: Holy Ghost Service");
  }

  const hgRegs = await db.eventRegistration.count({ where: { eventId: hg.id } });
  if (hgRegs === 0 && people.length >= 5) {
    const [p1, p2, p3, p4, p5] = people;
    await db.eventRegistration.createMany({
      data: [
        { orgId: org.id, eventId: hg.id, ticketTypeId: general.id, personId: p1.id, quantity: 4, status: "confirmed", paymentMethod: "free", qrToken: qr(), checkedInSeats: 2, checkedInAt: new Date(now.getTime() - 3600e3), checkedInBy: "Grace Marcus", createdByName: "Grace Marcus" },
        { orgId: org.id, eventId: hg.id, ticketTypeId: vip.id, personId: p2.id, quantity: 2, status: "confirmed", paymentMethod: "transfer", paymentRef: "manual_trf_88412", amountDueCents: 3_000_000, amountPaidCents: 3_000_000, paidAt: new Date(now.getTime() - 86400e3), qrToken: qr(), createdByName: "Grace Marcus" },
        { orgId: org.id, eventId: hg.id, ticketTypeId: general.id, personId: p3.id, quantity: 1, status: "confirmed", paymentMethod: "free", qrToken: qr(), createdByName: "Tom Bello" },
        { orgId: org.id, eventId: hg.id, ticketTypeId: students.id, personId: p4.id, quantity: 2, status: "pending_payment", amountDueCents: 100_000, qrToken: qr(), createdByName: "Tom Bello" },
        { orgId: org.id, eventId: hg.id, ticketTypeId: general.id, personId: p5.id, quantity: 3, status: "pending_payment", amountDueCents: 0, qrToken: qr(), createdByName: "Grace Marcus", notes: "Single mother — office to confirm fee waiver" },
        { orgId: org.id, eventId: hg.id, ticketTypeId: vip.id, guestName: "Chief Mrs. Adaeze Obi", guestEmail: "adaeze.obi@example.com", guestPhone: "+2348020001122", quantity: 2, status: "confirmed", paymentMethod: "cash", paymentRef: "manual_rcpt_1177", amountDueCents: 3_000_000, amountPaidCents: 3_000_000, paidAt: new Date(now.getTime() - 2 * 86400e3), qrToken: qr(), createdByName: "Grace Marcus" },
        { orgId: org.id, eventId: hg.id, ticketTypeId: general.id, guestName: "Emeka & Family", guestEmail: "emeka@example.com", quantity: 5, status: "waitlist", qrToken: qr(), createdByName: "Tom Bello" },
      ],
    });
    await db.eventTicketType.update({ where: { id: general.id }, data: { soldCount: 8 } });
    await db.eventTicketType.update({ where: { id: vip.id }, data: { soldCount: 4 } });
    await db.eventTicketType.update({ where: { id: students.id }, data: { soldCount: 2 } });
    console.log("orders seeded: Holy Ghost Service (7 orders incl. waitlist + pending)");
  }

  /* ── Youth Retreat ──────────────────────────────────────────────────────── */
  const rtStart = at(addDays(today, 24), 16, 0);
  const rtEnd = at(addDays(today, 26), 14, 0);
  let rt = await db.event.findFirst({
    where: { orgId: org.id, name: "Youth Retreat — Mountain Top Experience" },
  });
  if (!rt) {
    rt = await db.event.create({
      data: {
        orgId: org.id,
        campusId: campus.id,
        name: "Youth Retreat — Mountain Top Experience",
        kind: "retreat",
        startsAt: rtStart,
        endsAt: rtEnd,
        roomText: "Camp Mount Zion Grounds, Jos",
        capacity: 100,
        checkinEnabled: false,
        status: "scheduled",
        createdByName: "Tom Bello",
        registrationEnabled: true,
        registrationCapacity: 80,
        registrationDeadline: at(addDays(today, 20), 23, 59),
        registrationNote: "Fee covers lodging, meals and materials. Bring a Bible and warm clothing.",
      },
    });
    console.log("created event: Youth Retreat");
  } else {
    console.log("event exists: Youth Retreat — skipping event creation");
  }

  const rtType = await db.eventTicketType.findFirst({ where: { eventId: rt.id, name: "Retreat Pack" } });
  if (!rtType) {
    await db.eventTicketType.create({
      data: {
        orgId: org.id, eventId: rt.id, name: "Retreat Pack",
        description: "2 nights lodging + all meals + study materials.",
        priceCents: 1_000_000, capacity: 80, maxPerOrder: 2, sortOrder: 0,
      },
    });
    console.log("ticket type seeded: Retreat Pack");
  }

  const rtProgram = await db.eventProgramItem.count({ where: { eventId: rt.id } });
  if (rtProgram === 0) {
    await db.eventProgramItem.createMany({
      data: [
        { orgId: org.id, eventId: rt.id, title: "Arrival & camp setup", startsAt: at(rtStart, 16, 0), endsAt: at(rtStart, 18, 0), notes: "Register at the pavilion" },
        { orgId: org.id, eventId: rt.id, title: "Bonfire worship night", speaker: "Youth Choir", startsAt: at(rtStart, 19, 0), endsAt: at(rtStart, 21, 30) },
        { orgId: org.id, eventId: rt.id, title: "Morning glory", startsAt: at(addDays(rtStart, 1), 6, 0), endsAt: at(addDays(rtStart, 1), 7, 0) },
        { orgId: org.id, eventId: rt.id, title: "Sessions & workshops", speaker: "Guest ministers", startsAt: at(addDays(rtStart, 1), 9, 0), endsAt: at(addDays(rtStart, 1), 16, 0) },
        { orgId: org.id, eventId: rt.id, title: "Commissioning & departure", startsAt: at(rtEnd, 11, 0), endsAt: rtEnd },
      ],
    });
    console.log("program seeded: Youth Retreat");
  }

  console.log("\nDone. Demo events & registration data ready.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
