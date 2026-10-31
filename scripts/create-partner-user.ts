/**
 * create-partner-user.ts — restores the Partner Console login without
 * re-running the destructive seed. Idempotent: upserts the single SaaS-vendor
 * account the partner login screen advertises; touches no other table.
 *
 *   bun scripts/create-partner-user.ts
 *
 * Credentials match the prefill in src/components/partner/partner-login.tsx:
 *   partner@gracechms.demo / partner2026
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function main() {
  const email = "partner@gracechms.demo";
  const data = {
    name: "Grace ChMS Partner",
    passwordHash: hashPassword("partner2026"),
    status: "active",
  };
  await db.partnerUser.upsert({ where: { email }, create: { email, ...data }, update: data });
  console.log(`Partner console account ready: ${email} (password: partner2026)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
