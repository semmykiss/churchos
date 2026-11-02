// ─────────────────────────────────────────────────────────────────────────────
// scripts/nigerianize-demo-people.ts — apply the Nigerian demo identity to the
// LIVE tenant (Redeem Baptist Church) WITHOUT re-seeding.
//
// What it does (UPDATE-only, idempotent):
//   1. Writes a JSON snapshot backup → db/backup-people-phase1-<ts>.json
//      (person id/name/phone + household id/name — the restore point that
//      makes this operation reversible alongside the .down.sql).
//   2. Renames demo people to Nigerian names per the seed.ts mapping
//      (people already renamed by set-demo-tenant — Emmanuel Adeyemi, Rita
//      Peters, Femi Fagbemi, Vera Victor — keep their names, get +234 phones).
//   3. Replaces every +1555 US demo number with its +234 counterpart and
//      sets state/lga (Lagos-centric, 36-state spread).
//   4. Renames households (Bennett→Bello…) + Lagos street addresses.
//   5. Replaces old display-name strings (chat, stage history, care, audit…).
//   6. Aligns organization.timezone → Africa/Lagos.
//   7. Backfills phoneE164 + lastAttendedAt (same rules as the backfill script).
//
// Run:  bun scripts/nigerianize-demo-people.ts
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { db } from "../src/server/db";
import { normalizeToE164 } from "../src/lib/phone";

const LAGOS = "Lagos";

/** old live name → new identity (+234 phone, state, lga). Names kept where already Nigerian.
 *  The four staff rows linked to the documented demo logins take the login identity
 *  (name + tenant email) so person records match pastor@redeembaptist.ng etc. */
const NAME_MAP: Record<string, { first: string; last: string; phone?: string; state?: string; lga?: string; email?: string }> = {
  "Emmanuel Adeyemi": { first: "Emmanuel", last: "Adeyemi", phone: "+2348031234501", state: LAGOS, lga: "Ikeja" },
  "David Whitfield": { first: "Emmanuel", last: "Adeyemi", phone: "+2348031234501", state: LAGOS, lga: "Ikeja", email: "pastor@redeembaptist.ng" },
  "Renee Alvarez": { first: "Renee", last: "Adeleke", phone: "+2348061234502", state: LAGOS, lga: "Yaba" },
  "Tom Bergstrom": { first: "Femi", last: "Fashola", phone: "+2348111234503", state: LAGOS, lga: "Ikeja", email: "femi.f@redeembaptist.ng" },
  "Femi Fagbemi": { first: "Femi", last: "Fashola", phone: "+2348111234503", state: LAGOS, lga: "Ikeja" },
  "Grace Hollan": { first: "Rita", last: "Peters", phone: "+2348161234504", state: LAGOS, lga: "Lekki", email: "rita.p@redeembaptist.ng" },
  "Rita Peters": { first: "Rita", last: "Peters", phone: "+2348161234504", state: LAGOS, lga: "Lekki" },
  "Marcus Reed": { first: "Vera", last: "Johnson", phone: "+2349021234505", state: LAGOS, lga: "Surulere", email: "vera.v@redeembaptist.ng" },
  "Vera Victor": { first: "Vera", last: "Johnson", phone: "+2349021234505", state: LAGOS, lga: "Surulere" },
  "Sarah Okoye": { first: "Sarah", last: "Okoye", phone: "+2349091234506", state: LAGOS, lga: "Ikeja" },
  "Aisha Bennett": { first: "Aisha", last: "Bello", phone: "+2348021234510", state: LAGOS, lga: "Ikeja" },
  "Daniel Bennett": { first: "Daniel", last: "Bello", phone: "+2348081234511", state: LAGOS, lga: "Ikeja" },
  "Zoe Bennett": { first: "Zoe", last: "Bello", state: LAGOS, lga: "Ikeja" },
  "Eli Bennett": { first: "Eli", last: "Bello", state: LAGOS, lga: "Ikeja" },
  "Miguel Castillo": { first: "Michael", last: "Chukwu", phone: "+2348051234520", state: LAGOS, lga: "Surulere" },
  "Lucia Castillo": { first: "Lucia", last: "Chukwu", phone: "+2348071234521", state: LAGOS, lga: "Surulere" },
  "Mateo Castillo": { first: "Mateo", last: "Chukwu", state: LAGOS, lga: "Surulere" },
  "Sofia Castillo": { first: "Sofia", last: "Chukwu", state: LAGOS, lga: "Surulere" },
  "Kenji Nakamura": { first: "Kelechi", last: "Nwachukwu", phone: "+2348091234530", state: LAGOS, lga: "Alimosho" },
  "Hana Nakamura": { first: "Halima", last: "Nwachukwu", phone: "+2348101234531", state: LAGOS, lga: "Alimosho" },
  "Rin Nakamura": { first: "Ruth", last: "Nwachukwu", state: LAGOS, lga: "Alimosho" },
  "Chidi Okafor": { first: "Chidi", last: "Okafor", phone: "+2348131234540", state: LAGOS, lga: "Kosofe" },
  "Amara Okafor": { first: "Amara", last: "Okafor", phone: "+2348141234541", state: LAGOS, lga: "Kosofe" },
  "Nnamdi Okafor": { first: "Nnamdi", last: "Okafor", state: LAGOS, lga: "Kosofe" },
  "Eric Peterson": { first: "Eric", last: "Oladipo", phone: "+2348151234550", state: LAGOS, lga: "Oshodi-Isolo" },
  "Julie Peterson": { first: "Julie", last: "Oladipo", phone: "+2348171234551", state: LAGOS, lga: "Oshodi-Isolo" },
  "Owen Peterson": { first: "Owen", last: "Oladipo", state: LAGOS, lga: "Oshodi-Isolo" },
  "Ella Peterson": { first: "Ella", last: "Oladipo", state: LAGOS, lga: "Oshodi-Isolo" },
  "Tasha Williams": { first: "Tega", last: "Williams", phone: "+2348181234560", state: LAGOS, lga: "Agege" },
  "Jordan Williams": { first: "Jordan", last: "Williams", state: LAGOS, lga: "Agege" },
  "Frank Delgado": { first: "Frank", last: "Danjuma", phone: "+2349011234601", state: LAGOS, lga: "Mushin" },
  "Miriam Holt": { first: "Miriam", last: "Adeoye", phone: "+2349031234602", state: LAGOS, lga: "Yaba" },
  "Andre Kimani": { first: "Andre", last: "Kalu", phone: "+2349051234603", state: LAGOS, lga: "Ikeja" },
  "Bethany Moore": { first: "Bethany", last: "Mbah", phone: "+2349061234604", state: LAGOS, lga: "Shomolu" },
  "Calvin Ross": { first: "Calvin", last: "Osaze", phone: "+2349081234605", state: "Ogun", lga: "Abeokuta South" },
  "Danielle Foster": { first: "Danielle", last: "Fakoya", phone: "+2349091234606", state: LAGOS, lga: "Kosofe" },
  "Evan Park": { first: "Evan", last: "Bakpo", phone: "+2347031234607", state: LAGOS, lga: "Lekki" },
  "Fiona Adeyemi": { first: "Fiona", last: "Adeyemi", phone: "+2347051234608", state: LAGOS, lga: "Ibeju-Lekki" },
  "George Sandoval": { first: "George", last: "Sanni", phone: "+2347061234609", state: LAGOS, lga: "Lagos Island" },
  "Helena Vargas": { first: "Helena", last: "Ovie", phone: "+2349131234610", state: LAGOS, lga: "Amuwo-Odofin" },
  "Ivan Chen": { first: "Ivan", last: "Chibueze", phone: "+2349151234611", state: LAGOS, lga: "Ifako-Ijaiye" },
  "Joyce Mensah": { first: "Joyce", last: "Mensah", phone: "+2349161234612", state: LAGOS, lga: "Ojo" },
  "Kurt Bauer": { first: "Kunle", last: "Bakare", phone: "+2348021234613", state: "Ogun", lga: "Sagamu" },
  "Lena Whitfield": { first: "Lena", last: "Ogundipe", phone: "+2348031234614", state: "Oyo", lga: "Ibadan North" },
  "Miles Osei": { first: "Miles", last: "Osei", phone: "+2348061234615", state: LAGOS, lga: "Badagry" },
  "Nadia Rahman": { first: "Nadia", last: "Bala", phone: "+2348111234616", state: "FCT", lga: "Municipal Area Council" },
  "Oscar Lindqvist": { first: "Oscar", last: "Nnaji", phone: "+2348161234617", state: LAGOS, lga: "Apapa" },
  "Priya Nair": { first: "Priya", last: "Eneh", phone: "+2349021234618", state: LAGOS, lga: "Epe" },
  "Quentin Barnes": { first: "Quentin", last: "Barnabas", phone: "+2349091234619", state: LAGOS, lga: "Ikorodu" },
  "Rosa Marin": { first: "Rosa", last: "Madaki", phone: "+2347031234620", state: LAGOS, lga: "Ajeromi-Ifelodun" },
  "Steve Doyle": { first: "Steve", last: "Dauda", phone: "+2347051234621", state: LAGOS, lga: "Oshodi-Isolo" },
  "Tanya Ivanova": { first: "Tanya", last: "Ibrahim", phone: "+2347061234622", state: LAGOS, lga: "Lekki" },
  "Walter Grimes": { first: "Walter", last: "Gbadebo", phone: "+2348131234630", state: LAGOS, lga: "Lagos Mainland" },
};

/** household renames + Lagos street addresses (keyed by old household name). */
const HOUSEHOLD_MAP: Record<string, { name: string }> = {
  "The Bennett Family": { name: "The Bello Family" },
  "The Castillo Family": { name: "The Chukwu Family" },
  "The Nakamura Family": { name: "The Nwachukwu Family" },
  "The Okafor Family": { name: "The Okafor Family" },
  "The Peterson Family": { name: "The Oladipo Family" },
  "The Williams Family": { name: "The Williams Family" },
};
const STREETS = ["Allen Avenue", "Awolowo Road", "Herbert Macaulay Way", "Ikorodu Road", "Adeniran Ogunsanya Street", "Isaac John Street", "Toyin Street", "Bode Thomas Street", "Akin Adesola Street", "Kudirat Abiola Way"];

/** old full name → new full name, only where CHANGED (for display-string sweeps). */
const DISPLAY_NAME_SWEEPS: [string, string][] = Object.entries(NAME_MAP)
  .map(([oldName, v]) => [oldName, `${v.first} ${v.last}`] as [string, string])
  .filter(([o, n]) => o !== n);

async function main() {
  const org = await db.organization.findFirst();
  if (!org) throw new Error("No organization found.");
  console.log(`Tenant: ${org.name} (${org.id})`);

  // ── 1. backup snapshot (restore point) ─────────────────────────────────────
  const [people, households] = await Promise.all([
    db.person.findMany({ select: { id: true, firstName: true, lastName: true, phone: true, phoneE164: true } }),
    db.household.findMany({ where: { orgId: org.id }, select: { id: true, name: true, addressLine1: true, city: true, region: true } }),
  ]);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = `db/backup-people-phase1-${ts}.json`;
  writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), orgId: org.id, people, households }, null, 2));
  console.log(`Backup written: ${backupPath} (${people.length} people, ${households.length} households)`);

  // ── 2+3. people renames + Nigerian phones + state/lga ─────────────────────
  let renamed = 0, phones = 0, skipped = 0;
  for (const p of people) {
    const key = `${p.firstName} ${p.lastName}`;
    const target = NAME_MAP[key];
    if (!target) { skipped++; continue; }
    const data: any = {};
    if (p.firstName !== target.first) data.firstName = target.first;
    if (p.lastName !== target.last) data.lastName = target.last;
    if (target.phone && p.phone !== target.phone) { data.phone = target.phone; data.phoneE164 = normalizeToE164(target.phone); }
    if (target.state) { data.state = target.state; data.lga = target.lga; }
    if (target.email) data.email = target.email;
    if (Object.keys(data).length === 0) { skipped++; continue; }
    await db.person.update({ where: { id: p.id }, data });
    renamed++;
    if (data.phone) phones++;
  }
  console.log(`People updated: ${renamed} (phones: ${phones}, already-Nigerian/untouched: ${skipped})`);

  // ── 4. households ──────────────────────────────────────────────────────────
  let hhUpdated = 0;
  for (const hh of households) {
    const target = HOUSEHOLD_MAP[hh.name];
    if (!target) continue;
    const data: any = {};
    if (hh.name !== target.name) data.name = target.name;
    if (!hh.addressLine1 || !hh.addressLine1.includes(", Lagos")) {
      data.addressLine1 = `${1 + Math.floor(Math.random() * 120)} ${STREETS[Math.floor(Math.random() * STREETS.length)]}`;
      data.city = "Lagos"; data.region = "Lagos";
    }
    if (Object.keys(data).length) {
      await db.household.update({ where: { id: hh.id }, data });
      hhUpdated++;
    }
  }
  console.log(`Households updated: ${hhUpdated}`);

  // ── 5. display-name sweeps (only for names that actually changed) ─────────
  for (const [from, to] of DISPLAY_NAME_SWEEPS) {
    await db.chatMessage.updateMany({ where: { senderName: from }, data: { senderName: to } });
    await db.chatParticipant.updateMany({ where: { label: from }, data: { label: to } });
    await db.stageHistory.updateMany({ where: { changedByName: from }, data: { changedByName: to } });
    await db.careCase.updateMany({ where: { ownerName: from }, data: { ownerName: to } });
    await db.careNote.updateMany({ where: { authorName: from }, data: { authorName: to } });
    await db.prayerRequest.updateMany({ where: { approvedByName: from }, data: { approvedByName: to } });
    await db.workflow.updateMany({ where: { createdByName: from }, data: { createdByName: to } });
    await db.workflowRun.updateMany({ where: { subjectName: from }, data: { subjectName: to } });
    await db.auditLog.updateMany({ where: { actorLabel: from }, data: { actorLabel: to } });
    await db.attendanceRecord.updateMany({ where: { checkedInByName: from }, data: { checkedInByName: to } });
    await db.checkinSession.updateMany({ where: { createdByName: from }, data: { createdByName: to } });
  }
  console.log(`Display-name sweeps applied for ${DISPLAY_NAME_SWEEPS.length} renamed people.`);

  // ── 6. organization timezone ───────────────────────────────────────────────
  if (org.timezone !== "Africa/Lagos") {
    await db.organization.update({ where: { id: org.id }, data: { timezone: "Africa/Lagos" } });
    console.log(`Organization timezone: ${org.timezone} → Africa/Lagos`);
  }

  // ── 7. phoneE164 + lastAttendedAt backfill (same rules as backfill script) ─
  for (const p of await db.person.findMany({ select: { id: true, phone: true, phoneE164: true } })) {
    const norm = normalizeToE164(p.phone);
    if ((p.phoneE164 ?? null) !== (norm ?? null)) {
      await db.person.update({ where: { id: p.id }, data: { phoneE164: norm } });
    }
  }
  const latest = await db.attendanceRecord.groupBy({ by: ["personId"], _max: { checkedInAt: true } });
  for (const l of latest) {
    if (l._max.checkedInAt) {
      await db.person.updateMany({ where: { id: l.personId, lastAttendedAt: null }, data: { lastAttendedAt: l._max.checkedInAt } });
    }
  }
  console.log("phoneE164 + lastAttendedAt backfilled.");

  const remaining1555 = await db.person.count({ where: { phone: { contains: "+1555" } } });
  console.log(remaining1555 === 0 ? "✓ No +1555 numbers remain." : `✗ ${remaining1555} +1555 numbers still present!`);
  if (!existsSync(backupPath)) throw new Error("Backup missing — abort.");

  // ── 8. Phase 1 relationship demo (only fills NULLs — idempotent) ──────────
  const byName = async (name: string) => {
    const [first, ...rest] = name.split(" ");
    return db.person.findFirst({ where: { orgId: org.id, firstName: first, lastName: rest.join(" "), deletedAt: null, mergedIntoId: null }, select: { id: true } });
  };
  const shepherd = await byName("Renee Adeleke");
  if (shepherd) {
    let shepherded = 0;
    for (const name of ["Fiona Adeyemi", "Miles Osei", "Nadia Bala", "Evan Bakpo", "Joyce Mensah"]) {
      const t = await byName(name);
      if (t) {
        const r = await db.person.updateMany({ where: { id: t.id, assignedShepherdId: null }, data: { assignedShepherdId: shepherd.id } });
        shepherded += r.count;
      }
    }
    const altShepherd = await byName("Rita Peters");
    const nn = await byName("Nnamdi Okafor");
    if (altShepherd && nn) {
      shepherded += (await db.person.updateMany({ where: { id: nn.id, assignedShepherdId: null }, data: { assignedShepherdId: altShepherd.id } })).count;
    }
    console.log(`Shepherd assignments added: ${shepherded}`);
  }
  let invited = 0;
  const pairs: [string, string][] = [
    ["Miles Osei", "Andre Kalu"],
    ["Fiona Adeyemi", "Amara Okafor"],
  ];
  for (const [guest, inviter] of pairs) {
    const g = await byName(guest);
    const i = await byName(inviter);
    if (g && i) invited += (await db.person.updateMany({ where: { id: g.id, invitedByPersonId: null }, data: { invitedByPersonId: i.id } })).count;
  }
  console.log(`Invited-by links added: ${invited}`);
}

main()
  .then(async () => { await db.$disconnect(); process.exit(0); })
  .catch(async (err) => {
    console.error("FAILED:", err);
    await db.$disconnect();
    process.exit(1);
  });
