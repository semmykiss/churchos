import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const orgId = "cmvu5zyeo0000rcc602zcnf83";
  const ms = await db.membership.findMany({
    where: { orgId },
    select: { user: { select: { email: true, name: true } }, roleAssignments: { select: { role: { select: { name: true, key: true, accessMatrix: true } } } } },
  });
  for (const m of ms) {
    const roles = m.roleAssignments.map((r) => r.role.name).join(", ");
    console.log(`${m.user?.email} — ${m.user?.name} — roles: ${roles || "none"}`);
  }
}
main().finally(() => db.$disconnect());
