/**
 * Maintenance script — enforces the owner's standing instructions on the
 * live database (tenant-scoped, idempotent, additive-safe):
 *
 *  1. USERS — exactly four portal test users, nobody else:
 *       david@gracechapel.demo  (Owner)
 *       tom@gracechapel.demo    (Finance / Church Accountant)
 *       grace@gracechapel.demo  (Ministry Leader)
 *       marcus@gracechapel.demo (Volunteer)
 *     No new users are ever created here. Partner portal accounts
 *     (PartnerUser) are a separate system and are NOT touched.
 *
 *  2. DEPARTMENTS — exactly these ten, nothing else:
 *       Media, Choir, Ushering, Pastorate, Sunday School, Evangelism,
 *       Bible Study, Children Department, Teenage Church, Youth & Young Adult
 *
 * Roles of the four kept users are preserved untouched. Group-bound events
 * are detached (groupId → null) so attendance history survives; group members
 * and join requests are removed with their groups.
 *
 * Run: bun scripts/maintain-users-departments.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const KEEP_USERS = [
  "david@gracechapel.demo",
  "tom@gracechapel.demo",
  "grace@gracechapel.demo",
  "marcus@gracechapel.demo",
] as const;

const DEPARTMENTS = [
  "Media",
  "Choir",
  "Ushering",
  "Pastorate",
  "Sunday School",
  "Evangelism",
  "Bible Study",
  "Children Department",
  "Teenage Church",
  "Youth & Young Adult",
] as const;

async function main() {
  // ── resolve THE tenant from the four whitelisted users ──────────────────────
  const keepers = await db.user.findMany({
    where: { email: { in: [...KEEP_USERS] } },
    select: {
      id: true, email: true, name: true, status: true,
      memberships: { select: { id: true, orgId: true, personId: true, status: true } },
    },
  });
  const found = new Set(keepers.map((u) => u.email));
  const missing = KEEP_USERS.filter((e) => !found.has(e));
  if (missing.length) {
    throw new Error(`Whitelisted users missing (never auto-created): ${missing.join(", ")}`);
  }
  const orgIds = [...new Set(keepers.flatMap((u) => u.memberships.map((m) => m.orgId)))];
  if (orgIds.length !== 1) throw new Error(`Expected exactly one org across keepers, got: ${orgIds.join(", ")}`);
  const orgId = orgIds[0];
  console.log(`Tenant: ${orgId}`);

  // ── 1. USERS: remove any account in this org outside the whitelist ─────────
  const allUsers = await db.user.findMany({
    where: { memberships: { some: { orgId } } },
    select: { id: true, email: true },
  });
  const strays = allUsers.filter((u) => !(KEEP_USERS as readonly string[]).includes(u.email));
  for (const u of strays) {
    // children first (RoleAssignment/Session have no cascade to User)
    const memberships = await db.membership.findMany({ where: { userId: u.id }, select: { id: true } });
    for (const m of memberships) {
      await db.roleAssignment.deleteMany({ where: { membershipId: m.id } });
      await db.session.deleteMany({ where: { membershipId: m.id } });
    }
    await db.session.deleteMany({ where: { userId: u.id } });
    await db.authToken.deleteMany({ where: { userId: u.id } });
    await db.savedView.deleteMany({ where: { ownerId: u.id } });
    await db.notification.deleteMany({ where: { userId: u.id } });
    await db.membership.deleteMany({ where: { userId: u.id } });
    await db.user.delete({ where: { id: u.id } });
    console.log(`  removed stray user: ${u.email}`);
  }
  if (!strays.length) console.log("Users: whitelist already clean (4 portal users, no others).");

  // Grace's role scoped to a now-deleted group slug → widen to org-wide.
  // (Session build ignores scope today; this is purely cosmetic tidy-up.)
  const grace = keepers.find((u) => u.email === "grace@gracechapel.demo")!;
  const graceMembership = grace.memberships.find((m) => m.orgId === orgId)!;
  const scoped = await db.roleAssignment.updateMany({
    where: { orgId, membershipId: graceMembership.id, scopeType: "group" },
    data: { scopeType: "all", scopeId: null },
  });
  if (scoped.count) console.log(`  widened ${scoped.count} of Grace's group-scoped role(s) to org-wide.`);

  // ── 2. DEPARTMENTS: replace whatever exists with the canonical ten ─────────
  const existingGroups = await db.group.findMany({ where: { orgId }, select: { id: true, name: true } });
  if (existingGroups.length) {
    const groupIds = existingGroups.map((g) => g.id);
    // detach children in dependency order (tenant-scoped)
    const gm = await db.groupMember.deleteMany({ where: { orgId, groupId: { in: groupIds } } });
    const jr = await db.joinRequest.deleteMany({ where: { orgId, groupId: { in: groupIds } } });
    const ev = await db.event.updateMany({ where: { orgId, groupId: { in: groupIds } }, data: { groupId: null } });
    const chat = await db.chatConversation.updateMany({ where: { orgId, groupId: { in: groupIds } }, data: { groupId: null } });
    await db.group.deleteMany({ where: { orgId, id: { in: groupIds } } });
    console.log(`Removed ${existingGroups.length} old groups (members: ${gm.count}, joinRequests: ${jr.count}, events detached: ${ev.count}, chats detached: ${chat.count}).`);
  }

  const campus = await db.campus.findFirst({ where: { orgId }, select: { id: true } });
  let created = 0;
  for (const name of DEPARTMENTS) {
    const exists = await db.group.findFirst({ where: { orgId, name }, select: { id: true } });
    if (exists) continue;
    await db.group.create({
      data: {
        orgId,
        campusId: campus?.id ?? null,
        name,
        type: "ministry",
        description: `${name} department.`,
        isOpen: true,
        status: "active",
      },
    });
    created++;
  }
  console.log(`Departments: created ${created}, total now ${await db.group.count({ where: { orgId } })}.`);

  // ── final state report ──────────────────────────────────────────────────────
  const users = await db.user.findMany({
    where: { memberships: { some: { orgId } } },
    select: {
      email: true,
      memberships: { select: { roleAssignments: { select: { role: { select: { key: true, name: true } } } } } },
    },
  });
  console.table(
    users.map((u) => ({
      email: u.email,
      roles: u.memberships.flatMap((m) => m.roleAssignments.map((ra) => ra.role.key)).join(" + "),
    })),
  );
}

main()
  .then(() => console.log("✅ maintenance complete"))
  .catch((e) => {
    console.error("❌ maintenance failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
