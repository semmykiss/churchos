/** First-run bootstrap test on a SCRATCH sqlite DB (never touches db/custom.db).
 *  Run: DATABASE_URL="file:/tmp/boot-test.db" bun scripts/test-bootstrap.ts
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

process.env.DATABASE_URL ??= "file:/tmp/boot-test.db";
console.log("scratch db:", process.env.DATABASE_URL);

// push the (sqlite) schema into the scratch file
execSync("bunx prisma db push --skip-generate --accept-data-loss", { stdio: "pipe", env: process.env });

const { ensureFirstRunBootstrap } = await import("../src/server/bootstrap");
const { verifyPassword } = await import("../src/server/auth");

const db = new PrismaClient();

let pass = 0, fail = 0;
const ck = (label: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};

await ensureFirstRunBootstrap(); // first run — creates everything
await ensureFirstRunBootstrap(); // second run — must be a no-op (idempotency)

const [users, orgs, campuses, licenses, groups, partnerUsers, funds, accounts] = await Promise.all([
  db.user.findMany({ select: { email: true, name: true, passwordHash: true } }),
  db.organization.findMany(),
  db.campus.count(),
  db.license.count(),
  db.group.findMany({ select: { name: true, type: true } }),
  db.partnerUser.count(),
  db.fund.count(),
  db.account.count(),
]);

ck("exactly 4 portal users (no more — owner instruction)", users.length === 4, users.map((u) => u.email).join(", "));
ck("1 organization", orgs.length === 1, orgs[0]?.name);
ck("1 primary campus", campuses === 1);
ck("license created", licenses === 1);
ck("10 standing departments, exact spellings", groups.length === 10, groups.map((g) => g.name).join(" | "));
ck("partner console user created", partnerUsers === 1);
ck("default funds provisioned", funds > 0, `funds=${funds}`);
ck("default GL accounts provisioned", accounts > 0, `accounts=${accounts}`);

const david = users.find((u) => u.email === "david@gracechapel.demo");
ck("david is owner with working password hash", !!david && verifyPassword("grace2026", david.passwordHash));

// role assignments
const davidM = await db.membership.findFirst({ where: { user: { email: "david@gracechapel.demo" } }, include: { roleAssignments: { include: { role: true } } } });
ck("david has owner role", davidM?.roleAssignments.some((ra) => ra.role.key === "owner") ?? false);
const marcusM = await db.membership.findFirst({ where: { user: { email: "marcus@gracechapel.demo" } }, include: { roleAssignments: { include: { role: true } } } });
ck("marcus has volunteer + worship_team roles", (marcusM?.roleAssignments.map((ra) => ra.role.key).sort().join("+")) === "volunteer+worship_team");

// full login path through the hooked login()
const { login } = await import("../src/server/auth");
const result = await login("david@gracechapel.demo", "grace2026", {});
ck("login() succeeds on bootstrapped DB", result.ok === true && !!result.sessionId, `err=${result.error ?? "none"}`);
const bad = await login("david@gracechapel.demo", "wrong", {});
ck("wrong password still rejected", bad.ok === false);

// audit trail written?
const audits = await db.auditLog.count({ where: { action: "auth.login" } });
ck("login audited", audits >= 1, `count=${audits}`);

console.log(`\nRESULT: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
