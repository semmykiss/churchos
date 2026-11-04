/** Read-only: list GL accounts for the org. Run: bun scripts/inspect-accounts.ts */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const org = await db.organization.findFirst();
  if (!org) return;
  const accounts = await db.account.findMany({
    where: { orgId: org.id },
    orderBy: { code: "asc" },
    select: { code: true, name: true, type: true, isActive: true },
  });
  console.log(`org ${org.id} — ${accounts.length} accounts`);
  for (const a of accounts) console.log(`${a.code.padEnd(6)} ${a.type.padEnd(10)} ${a.isActive ? " " : "ARCHIVED"} ${a.name}`);
}
main().finally(() => db.$disconnect());
