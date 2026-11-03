/**
 * Additive, idempotent backfill — "Head Usher" collections workflow:
 *  1. Every org gets any MISSING system role rows from SYSTEM_ROLES presets
 *     (matrix + expanded permission rows). Existing roles are never touched.
 *     → puts "Head Usher" (and any other later presets) into Administration.
 *  2. Every org with NO tithe-type fund gets the standard system fund
 *     "Tithes & Offerings" (code 110) so usher collection sheets have the
 *     right categories (matches provisionDefaults).
 *  3. Demo only: aisha@gracechapel.demo (a Member) gains the head_usher role
 *     additively — the exact "member + added Head Usher role" usage.
 * Run: bun run scripts/backfill-head-usher.ts
 */
import { db } from "../src/server/db";
import { SYSTEM_ROLES, permissionsForMatrix } from "../src/server/permissions";

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true, subdomain: true } });
  let rolesCreated = 0;
  let fundsCreated = 0;
  let assignments = 0;

  for (const org of orgs) {
    const existing = await db.role.findMany({ where: { orgId: org.id }, select: { key: true } });
    const have = new Set(existing.map((r) => r.key));

    for (const preset of Object.values(SYSTEM_ROLES)) {
      if (have.has(preset.key)) continue;
      const perms = preset.key === "owner" ? ["*"] : [...new Set([...permissionsForMatrix(preset.matrix), ...preset.extras])].sort();
      const role = await db.role.create({
        data: {
          orgId: org.id,
          key: preset.key,
          name: preset.name,
          description: preset.description,
          isSystem: true,
          accessMatrix: JSON.stringify(preset.matrix),
          permissions: { create: perms.map((permission) => ({ permission })) },
        },
      });
      rolesCreated++;
      console.log(`  [role] +${preset.key} (${role.id}) @ ${org.name}`);

      // Demo: give the demo member aisha the Head Usher role (member + added role)
      if (preset.key === "head_usher" && /grace chapel\b/i.test(org.name) && !org.name.includes("Testing")) {
        const membership = await db.membership.findFirst({
          where: { orgId: org.id, user: { email: "aisha@gracechapel.demo" } },
          select: { id: true },
        });
        const already = membership
          ? await db.roleAssignment.findFirst({ where: { membershipId: membership.id, roleId: role.id } })
          : null;
        if (membership && !already) {
          await db.roleAssignment.create({
            data: { orgId: org.id, membershipId: membership.id, roleId: role.id, scopeType: "all" },
          });
          assignments++;
          console.log(`  [assign] head_usher -> aisha@gracechapel.demo @ ${org.name}`);
        }
      }
    }

    // Standard tithe fund when the org has none (additive; unique [orgId, code] safe)
    const titheFund = await db.fund.findFirst({ where: { orgId: org.id, type: "tithe" }, select: { id: true } });
    if (!titheFund) {
      const codeClash = await db.fund.findFirst({ where: { orgId: org.id, code: "110" }, select: { id: true } });
      if (!codeClash) {
        await db.fund.create({
          data: { orgId: org.id, name: "Tithes & Offerings", code: "110", type: "tithe", isSystemFund: true, isTaxDeductible: true },
        });
        fundsCreated++;
        console.log(`  [fund] +Tithes & Offerings (110) @ ${org.name}`);
      }
    }
  }
  console.log(`DONE orgs=${orgs.length} rolesCreated=${rolesCreated} fundsCreated=${fundsCreated} assignments=${assignments}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
