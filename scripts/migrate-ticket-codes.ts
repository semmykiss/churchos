// ─────────────────────────────────────────────────────────────────────────────
// migrate-ticket-codes.ts — convert legacy `evt_<hex>` ticket tokens to the
// new 6-digit door codes. Idempotent: rows already matching ^\d{6}$ are kept.
// Safe to re-run after database wipes/reseeds.
//
// Run:  bun scripts/migrate-ticket-codes.ts
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../src/server/db";

function newCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function main() {
  const rows = await db.eventRegistration.findMany({
    select: { id: true, qrToken: true },
  });
  const stale = rows.filter((r) => !/^\d{6}$/.test(r.qrToken));
  console.log(`registrations total: ${rows.length}, legacy tokens: ${stale.length}`);
  if (!stale.length) {
    console.log("Nothing to migrate.");
    return;
  }

  const used = new Set(
    (await db.eventRegistration.findMany({ select: { qrToken: true } })).map((r) => r.qrToken)
  );

  let migrated = 0;
  for (const row of stale) {
    let code = newCode();
    for (let i = 0; i < 50 && used.has(code); i++) code = newCode();
    if (used.has(code)) {
      console.error(`Could not draw a unique code for ${row.id} — skipping.`);
      continue;
    }
    used.add(code);
    await db.eventRegistration.update({ where: { id: row.id }, data: { qrToken: code } });
    migrated++;
  }
  console.log(`Migrated ${migrated} ticket(s) to 6-digit codes.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
