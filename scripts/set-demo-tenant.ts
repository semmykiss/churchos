// ─────────────────────────────────────────────────────────────────────────────
// scripts/set-demo-tenant.ts — rebrand the seeded demo org to the documented
// "Redeem Baptist Church" tenant + the four documented logins.
//
// Idempotent: safe to run repeatedly after `bun run db:seed`.
//   • Renames org/campus to Redeem Baptist (Lagos) — currency already NGN.
//   • Renames the four demo users to the documented emails + names and resets
//     every password to `redeem2026`.
//   • Removes the extra seeded users (campus admins + parent demo) — their
//     person rows stay as regular directory people.
//   • Leaves roles/permissions, donations, events, care, accounting intact.
//
// Run:  bun scripts/set-demo-tenant.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes, scryptSync } from "node:crypto";
import { db } from "../src/server/db";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

const USER_MAP: Array<{ from: string; to: string; first: string; last: string }> = [
  { from: "david@gracechapel.demo", to: "pastor@redeembaptist.ng", first: "Emmanuel", last: "Adeyemi" },
  { from: "grace@gracechapel.demo", to: "rita.p@redeembaptist.ng", first: "Rita", last: "Peters" },
  { from: "tom@gracechapel.demo", to: "femi.f@redeembaptist.ng", first: "Femi", last: "Fagbemi" },
  { from: "marcus@gracechapel.demo", to: "vera.v@redeembaptist.ng", first: "Vera", last: "Victor" },
];
const REMOVE_USERS = ["renee@gracechapel.demo", "sarah@gracechapel.demo", "aisha@gracechapel.demo"];
const PASSWORD = "redeem2026";

async function main() {
  const org = await db.organization.findFirst();
  if (!org) throw new Error("No organization found — run `bun run db:seed` first.");

  // ── org + campus rebrand ──────────────────────────────────────────────────
  await db.organization.update({
    where: { id: org.id },
    data: {
      name: "Redeem Baptist Church",
      slug: "redeembaptist",
      timezone: "Africa/Lagos",
      currency: "NGN",
    },
  });
  const campus = await db.campus.findFirst({ where: { orgId: org.id } });
  if (campus) {
    await db.campus.update({
      where: { id: campus.id },
      data: {
        name: "Redeem Baptist Church — Main",
        code: "MAIN",
        address: "12 Redemption Way",
        city: "Lagos",
        region: "Lagos",
        postal: "101233",
        phone: "+2348020001234",
      },
    });
  }

  // ── demo users ────────────────────────────────────────────────────────────
  const pwd = hashPassword(PASSWORD);
  for (const u of USER_MAP) {
    const user = await db.user.findUnique({ where: { email: u.from } });
    if (!user) {
      // already migrated on a previous run — just ensure the password matches
      await db.user.updateMany({ where: { email: u.to }, data: { passwordHash: pwd } });
      continue;
    }
    await db.user.update({
      where: { id: user.id },
      data: { email: u.to, name: `${u.first} ${u.last}`, passwordHash: pwd },
    });
    await db.person.updateMany({
      where: { orgId: org.id, email: u.from },
      data: { email: u.to, firstName: u.first, lastName: u.last },
    });
  }

  // ── drop the extra seeded logins (keep their person rows as directory ppl) ─
  for (const email of REMOVE_USERS) {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) continue;
    const memberships = await db.membership.findMany({ where: { userId: user.id }, select: { id: true } });
    for (const m of memberships) {
      await db.roleAssignment.deleteMany({ where: { membershipId: m.id } });
      await db.auditLog.deleteMany({ where: { actorMembershipId: m.id } });
    }
    await db.notification.deleteMany({ where: { userId: user.id } });
    await db.aiConversation.deleteMany({ where: { userId: user.id } });
    await db.authToken.deleteMany({ where: { userId: user.id } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.membership.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }

  const users = await db.user.findMany({ select: { email: true, name: true } });
  console.log("Demo tenant ready:", org.name);
  for (const u of users) console.log(`  ${u.email} — ${u.name} / ${PASSWORD}`);
}

main()
  .then(async () => { await db.$disconnect(); process.exit(0); })
  .catch(async (err) => {
    console.error("FAILED:", err);
    await db.$disconnect();
    process.exit(1);
  });
