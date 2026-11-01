/**
 * One-shot restore: rename the seeded demo org to the tenant the user has been
 * using (Redeem Baptist Church) and re-point the four familiar logins onto the
 * matching seeded role accounts — so existing bookmarks/credentials keep
 * working after the access-matrix rebuild.
 *
 *   pastor@redeembaptist.ng  → owner            (Emmanuel Adeyemi)
 *   rita.p@redeembaptist.ng  → ministry_leader  (HOD / Ministry Leader)
 *   femi.f@redeembaptist.ng  → finance          (Church Accountant)
 *   vera.v@redeembaptist.ng  → volunteer
 *   (all four: password "redeem2026")
 *
 * Idempotent. Run: bun scripts/restore-redeem-tenant.ts
 */
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/auth";

const PWD = hashPassword("redeem2026");

const MAPPING: { from: string; to: string; name: string }[] = [
  { from: "david@gracechapel.demo", to: "pastor@redeembaptist.ng", name: "Emmanuel Adeyemi" }, // owner
  { from: "grace@gracechapel.demo", to: "rita.p@redeembaptist.ng", name: "Rita Peters" }, // ministry_leader (HOD)
  { from: "tom@gracechapel.demo", to: "femi.f@redeembaptist.ng", name: "Femi Fashola" }, // finance
  { from: "marcus@gracechapel.demo", to: "vera.v@redeembaptist.ng", name: "Vera Johnson" }, // volunteer
];

async function main() {
  const org = await db.organization.findFirst({ where: { slug: "grace-chapel" } });
  if (!org) throw new Error("Seeded org not found — run `bun prisma/seed.ts` first.");
  if (org.name !== "Redeem Baptist Church") {
    await db.organization.update({
      where: { id: org.id },
      data: { name: "Redeem Baptist Church" },
    });
    console.log("✓ org renamed → Redeem Baptist Church");
  } else {
    console.log("= org already renamed");
  }

  for (const m of MAPPING) {
    const user = await db.user.findUnique({ where: { email: m.from } });
    if (!user) {
      console.log(`! seed user ${m.from} not found — skipped`);
      continue;
    }
    await db.user.update({
      where: { id: user.id },
      data: { email: m.to, name: m.name, passwordHash: PWD, mustChangePassword: false },
    });
    console.log(`✓ ${m.from} → ${m.to} (${m.name})`);
  }

  console.log("\nLogins (password redeem2026):");
  console.log("  pastor@redeembaptist.ng  — Owner / Super Admin");
  console.log("  rita.p@redeembaptist.ng  — HOD / Ministry Leader");
  console.log("  femi.f@redeembaptist.ng  — Church Accountant");
  console.log("  vera.v@redeembaptist.ng  — Volunteer");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
