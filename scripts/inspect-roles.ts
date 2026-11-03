/** Read-only: list tenant members + roles for Grace Chapel to plan RBAC tests. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const org = await db.organization.findFirst({ where: { name: { contains: "Grace" } } });
  if (!org) return console.log("no org");
  const memberships = await db.membership.findMany({
    where: { orgId: org.id },
    include: {
      user: { select: { email: true, name: true } },
      roleAssignments: { include: { role: { select: { name: true, key: true } } } },
    },
  });
  console.log("MEMBERSHIPS:");
  for (const m of memberships) {
    const roles = m.roleAssignments.map((ra) => ra.role.name).join(", ") || "(none)";
    console.log(`- ${m.user?.email} | ${m.user?.name} | roles: ${roles} | status: ${m.status}`);
  }
}
main().finally(() => db.$disconnect());
