/**
 * ADDITIVE backfill: add the new "assets" module to every stored system-role
 * access matrix so existing tenants see the Assets & Facilities module at the
 * preset level for their role. Custom roles are left untouched (church admins
 * can opt in via Administration → Access levels). Owner roles keep working via
 * the wildcard/full matrix and are updated too for editor consistency.
 *
 * Run once: bun scripts/backfill-assets-matrix.ts
 */
import { PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES, parseAccessMatrix, serializeAccessMatrix, type AccessMatrix } from "../src/server/permissions";

const db = new PrismaClient();

async function main() {
  const roles = await db.role.findMany({ where: { isSystem: true } });
  let updated = 0;
  for (const role of roles) {
    const preset = SYSTEM_ROLES[role.key];
    if (!preset) continue; // custom/system-unknown key — leave alone
    const stored = parseAccessMatrix(role.accessMatrix) ?? {};
    const wanted = role.key === "owner" ? 4 : (preset.matrix.assets ?? 0);
    const current = stored.assets ?? 0;
    if (current === wanted) continue;
    const next: AccessMatrix = { ...stored, assets: wanted };
    await db.role.update({ where: { id: role.id }, data: { accessMatrix: serializeAccessMatrix(next) } });
    updated++;
    console.log(`✓ role "${role.name}" (${role.key}) in org ${role.orgId}: assets ${current} → ${wanted}`);
  }
  console.log(`Done — ${updated} role(s) updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
