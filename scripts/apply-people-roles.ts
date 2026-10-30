/**
 * Idempotent upgrade: applies the scoped parent self-service permission model
 * to an EXISTING database without a full reseed. Safe to run repeatedly.
 *
 *   1. member role gains view-only directory access (people.view)
 *   2. creates the "parent" role (people.view + people.edit.own_household)
 *   3. assigns it to Aisha Bennett (head of the Bennett family, 2 minor kids)
 *      so the scoped self-service flow has a working demo login.
 *
 * Run: bun scripts/apply-people-roles.ts
 */
import { db } from "../src/server/db";

async function main() {
  const org = await db.organization.findFirst({ where: { slug: "grace-chapel" } });
  if (!org) throw new Error("Grace Chapel org not found — run the full seed first (npm run db:seed).");

  // 1. member + volunteer roles → view-only directory access
  for (const key of ["member", "volunteer"]) {
    const role = await db.role.findFirst({ where: { orgId: org.id, key } });
    if (role) {
      await db.rolePermission.upsert({
        where: { roleId_permission: { roleId: role.id, permission: "people.view" } },
        create: { roleId: role.id, permission: "people.view" },
        update: {},
      });
      console.log(`✓ ${key} role: people.view granted`);
    }
  }

  // 2. parent role (scoped self-service)
  let parent = await db.role.findFirst({ where: { orgId: org.id, key: "parent" } });
  if (!parent) {
    parent = await db.role.create({
      data: {
        orgId: org.id,
        key: "parent",
        name: "Parent / Guardian",
        description: "Scoped self-service — may edit only their own household members and linked dependents.",
        isSystem: false,
      },
    });
    console.log("✓ parent role created");
  }
  for (const p of ["people.view", "people.edit.own_household", "portal.use", "comms.chat.use"]) {
    await db.rolePermission.upsert({
      where: { roleId_permission: { roleId: parent.id, permission: p } },
      create: { roleId: parent.id, permission: p },
      update: {},
    });
  }
  console.log("✓ parent role permissions ensured");

  // 3. demo assignment: Aisha Bennett → parent
  const aisha = await db.person.findFirst({
    where: { orgId: org.id, firstName: "Aisha", lastName: "Bennett", deletedAt: null },
  });
  if (aisha) {
    const ms = await db.membership.findFirst({ where: { orgId: org.id, personId: aisha.id } });
    if (ms) {
      const existing = await db.roleAssignment.findFirst({ where: { membershipId: ms.id, roleId: parent.id } });
      if (!existing) {
        await db.roleAssignment.create({
          data: { orgId: org.id, membershipId: ms.id, roleId: parent.id, scopeType: "campus" },
        });
        console.log("✓ Aisha Bennett assigned the parent role");
      } else {
        console.log("• Aisha Bennett already has the parent role");
      }
    } else {
      console.log("! Aisha Bennett has no user membership — create one from Admin → Users");
    }
  } else {
    console.log("! Aisha Bennett person record not found");
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
