/**
 * One-time idempotent migration: per-module granular access matrix.
 *
 * Restructures access control so EVERY module (Shepherd AI included) has an
 * explicit access level per role: OFF(0) / READ(1) / EDIT(2) / CREATE(3) / DELETE(4).
 *
 * For every organization it:
 *   1. creates any missing preset roles (pastor, head_usher, minister, …)
 *   2. renames presets to the new naming (Campus Admin → Church Admin,
 *      Finance → Church Accountant, Ministry Leader → HOD / Ministry Leader)
 *   3. stores Role.accessMatrix from the preset definitions and re-aligns the
 *      preset's flat permission rows to (matrix-derived ∪ preset extras)
 *   4. backfills a derived matrix onto custom roles that predate the matrix
 *      (their flat permission rows are kept untouched)
 *
 * SAFE to run repeatedly — skips work already done. NEVER wipes data.
 *
 * Run: bun scripts/migrate-access-matrix.ts
 */
import { db } from "../src/server/db";
import {
  MODULE_KEYS, SYSTEM_ROLES, ROLE_TEMPLATES, permissionsForMatrix,
  deriveMatrixFromPermissions, serializeAccessMatrix, type AccessMatrix,
} from "../src/server/permissions";

function parseMatrix(raw: string | null | undefined): AccessMatrix | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  if (!orgs.length) {
    console.log("No organizations found — nothing to migrate.");
    return;
  }

  for (const org of orgs) {
    console.log(`\n━━ ${org.name} (${org.id})`);
    const roles = await db.role.findMany({
      where: { orgId: org.id },
      include: { permissions: true },
    });
    const byKey = new Map(roles.map((r) => [r.key, r]));

    // 1-3) presets: create missing, rename, store matrix, re-align flat rows
    for (const preset of Object.values(SYSTEM_ROLES)) {
      const existing = byKey.get(preset.key);
      if (!existing) {
        const created = await db.role.create({
          data: {
            orgId: org.id,
            key: preset.key,
            name: preset.name,
            description: preset.description,
            isSystem: true,
            accessMatrix: serializeAccessMatrix(preset.matrix),
            permissions: { create: (ROLE_TEMPLATES[preset.key] ?? []).map((p) => ({ permission: p })) },
          },
        });
        console.log(`  + created preset role "${preset.name}" (${created.id})`);
        byKey.set(preset.key, { ...created, permissions: [] } as typeof existing);
        continue;
      }

      const needsMeta = existing.name !== preset.name || existing.description !== preset.description;
      const needsMatrix = parseMatrix(existing.accessMatrix) === null
        || JSON.stringify(parseMatrix(existing.accessMatrix)) !== JSON.stringify(preset.matrix);
      const targetRows = preset.key === "owner"
        ? ["*"]
        : [...new Set([...permissionsForMatrix(preset.matrix), ...preset.extras])].sort();
      const currentRows = existing.permissions.map((p) => p.permission).sort();
      const needsRows =
        preset.key !== "owner" && JSON.stringify(currentRows) !== JSON.stringify(targetRows);

      if (!needsMeta && !needsMatrix && !needsRows) {
        console.log(`  = ${preset.key}: up to date`);
        continue;
      }
      await db.role.update({
        where: { id: existing.id },
        data: {
          ...(needsMeta ? { name: preset.name, description: preset.description } : {}),
          ...(needsMatrix ? { accessMatrix: serializeAccessMatrix(preset.matrix) } : {}),
        },
      });
      if (needsRows) {
        await db.$transaction([
          db.rolePermission.deleteMany({ where: { roleId: existing.id } }),
          ...targetRows.map((p) => db.rolePermission.create({ data: { roleId: existing.id, permission: p } })),
        ]);
      }
      console.log(
        `  ↻ ${preset.key}: ${[needsMeta && "renamed", needsMatrix && "matrix set", needsRows && "rows re-aligned"].filter(Boolean).join(", ")}`
      );
    }

    // 4) custom roles predating the matrix → derive one from their flat rows
    for (const role of roles.filter((r) => !r.isSystem)) {
      if (parseMatrix(role.accessMatrix) !== null) {
        console.log(`  = custom "${role.name}": matrix already present`);
        continue;
      }
      const derived = deriveMatrixFromPermissions(role.permissions.map((p) => p.permission));
      const grants = Object.values(derived).filter((v) => v > 0).length;
      await db.role.update({ where: { id: role.id }, data: { accessMatrix: serializeAccessMatrix(derived) } });
      console.log(`  ↻ custom "${role.name}": derived matrix (${grants}/${MODULE_KEYS.length} modules on)`);
    }

    await db.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "system",
        actorLabel: "access-matrix migration",
        action: "access.matrix_migration",
        entityType: "role",
        entityId: org.id,
        after: JSON.stringify({ presets: Object.keys(SYSTEM_ROLES) }),
      },
    });
  }

  console.log("\n✅ Access-matrix migration complete.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
