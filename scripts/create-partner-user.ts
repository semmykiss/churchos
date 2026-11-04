/**
 * create-partner-user.ts — restores / provisions Partner Console logins
 * (separate SaaS-vendor principal — PartnerUser table) without re-running the
 * destructive seed. Idempotent upsert; touches no other table.
 *
 *   bun scripts/create-partner-user.ts                          # default demo account
 *   bun scripts/create-partner-user.ts <email> <password> [name]
 *
 * Default credentials match the login-screen demo hint:
 *   partner@gracechms.demo / partner2026
 * Church portal users (david/tom/grace/marcus) are NOT managed here.
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function main() {
  const email = (process.argv[2] ?? "partner@gracechms.demo").trim().toLowerCase();
  const password = process.argv[3] ?? "partner2026";
  const name = process.argv[4] ?? "Grace ChMS Partner";
  if (!email.includes("@")) throw new Error(`Refusing to create partner account: invalid email "${email}"`);
  if (password.length < 8) throw new Error("Refusing to create partner account: password must be at least 8 characters.");
  const data = {
    name,
    passwordHash: hashPassword(password),
    status: "active",
  };
  const created = (await db.partnerUser.findUnique({ where: { email }, select: { id: true } })) === null;
  await db.partnerUser.upsert({ where: { email }, create: { email, ...data }, update: data });
  console.log(`Partner console account ${created ? "created" : "updated"}: ${email}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
