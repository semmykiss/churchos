// Inspect current users / events before cleanup
import { db } from "../src/server/db";

const users = await db.user.findMany({ include: { memberships: { include: { roleAssignments: true } } }, orderBy: { createdAt: "asc" } });
console.log("=== USERS (" + users.length + ") ===");
for (const u of users) {
  const perms = u.memberships
    .map((m) => `${m.roleAssignments.map((r) => `${r.role}${r.permissions && r.permissions.length ? ":" + r.permissions.join("+") : ""}`).join(",") || "(no role)"}`)
    .join(" | ");
  console.log(`${u.email} :: ${u.name} :: ${perms}`);
}

console.log("\n=== EVENTS ===");
const events = await db.event.findMany({
  select: { id: true, name: true, startsAt: true, status: true, _count: { select: { registrations: true, ticketTypes: true, programItems: true, attendance: true } } },
  orderBy: { startsAt: "asc" },
});
for (const e of events)
  console.log(`${e.name} :: ${e.startsAt.toISOString().slice(0, 10)} :: ${e.status} :: reg=${e._count.registrations} tt=${e._count.ticketTypes} prog=${e._count.programItems} att=${e._count.attendance}`);
console.log("total events:", events.length);

console.log("\n=== RELATED COUNTS ===");
for (const t of ["eventRegistration", "eventTicketType", "eventProgramItem", "person", "membership", "session", "attendanceRecord"]) {
  console.log(t + ":", await (db as any)[t].count());
}
await db.$disconnect();
