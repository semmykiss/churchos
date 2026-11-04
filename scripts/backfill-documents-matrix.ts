/**
 * Backfill: enable the Documents (DMS) module for EXISTING tenants.
 *
 * The preset role matrices in src/server/permissions.ts now carry a
 * "documents" level, but roles already stored in the DB keep their own
 * accessMatrix JSON snapshot — they never see new modules automatically.
 * This script (idempotent, ADDITIVE only):
 *   1. injects the preset documents level into every system role whose stored
 *      matrix lacks the key (custom roles are left OFF for an admin to grant);
 *   2. adds the documents.approve extra to pastor / ministry_leader roles;
 *   3. creates the per-org DocumentSettings row (DMS admin policy defaults).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** role key → documents module level (mirrors SYSTEM_ROLES presets). */
const PRESET_LEVEL: Record<string, number> = {
  owner: 4, // owner keeps "*" anyway — listed for completeness
  campus_admin: 4,
  finance: 2,
  pastor: 2,
  head_usher: 1,
  minister: 2,
  ministry_leader: 3,
  volunteer: 1,
  member: 1,
  parent: 1,
};

/** role keys that get the documents.approve extra beyond their matrix rung. */
const APPROVE_EXTRA_KEYS = new Set(["pastor", "ministry_leader"]);

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  let matrixUpdates = 0;
  let extraGrants = 0;
  let settingsRows = 0;

  for (const org of orgs) {
    // 3) DMS settings defaults (upsert by unique orgId)
    const existingSettings = await db.documentSettings.findUnique({ where: { orgId: org.id } });
    if (!existingSettings) {
      await db.documentSettings.create({ data: { orgId: org.id } });
      settingsRows++;
    }

    const roles = await db.role.findMany({
      where: { orgId: org.id },
      include: { permissions: { select: { permission: true } } },
    });

    for (const role of roles) {
      // 1) matrix backfill — only when the key is absent (never overwrite admin edits)
      let matrix: Record<string, number> = {};
      try {
        matrix = role.accessMatrix ? (JSON.parse(role.accessMatrix) as Record<string, number>) : {};
      } catch {
        matrix = {};
      }
      const hasWildcard = role.permissions.some((p) => p.permission === "*");
      if (!hasWildcard && matrix.documents === undefined && PRESET_LEVEL[role.key] !== undefined) {
        matrix.documents = PRESET_LEVEL[role.key];
        await db.role.update({
          where: { id: role.id },
          data: { accessMatrix: JSON.stringify(matrix) },
        });
        matrixUpdates++;
        console.log(`  [${org.name}] role "${role.key}" → documents level ${matrix.documents}`);
      }

      // 2) approve extra (skip when the role already carries it or has "*")
      if (APPROVE_EXTRA_KEYS.has(role.key) && !hasWildcard) {
        const has = role.permissions.some((p) => p.permission === "documents.approve");
        if (!has) {
          await db.rolePermission.create({ data: { roleId: role.id, permission: "documents.approve" } });
          extraGrants++;
          console.log(`  [${org.name}] role "${role.key}" → +documents.approve extra`);
        }
      }
    }
  }

  console.log(
    `backfill-documents: ${orgs.length} org(s) — ${matrixUpdates} matrix updates, ${extraGrants} approve extras, ${settingsRows} settings rows created.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
