/** Check role access matrices for the assets key. */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const roles = await db.role.findMany({ select: { key: true, name: true, accessMatrix: true } });
  for (const r of roles) {
    let m: Record<string, unknown> = {};
    try { m = r.accessMatrix ? JSON.parse(r.accessMatrix) : {}; } catch { /* ignore */ }
    console.log(`${r.key.padEnd(18)} assets=${m.assets ?? "-"}  (modules=${Object.keys(m).length})`);
  }
}

main().finally(() => db.$disconnect());
