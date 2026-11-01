// ─────────────────────────────────────────────────────────────────────────────
// scripts/seed-people-volume.ts — ADDITIVE demo-data volume for the People CRM.
//
// Adds ~5,200 realistic Nigerian people (families, households, guardian links,
// groups, tags, birthdays, attendance recency) to the EXISTING organization so
// the CRM v2 virtualized table can be tested at scale.
//
// SAFETY: never deletes or updates existing rows. Every created person is
// stamped with importBatchId = BATCH, so re-runs are skipped (idempotent) and
// a rollback is a single DELETE on that marker.
//
// Run:  bun scripts/seed-people-volume.ts               (skips when already seeded)
//       bun scripts/seed-people-volume.ts --more        (adds another batch)
//       bun scripts/seed-people-volume.ts --clean       (rollback the batch)
//       bun scripts/seed-people-volume.ts --clean --reseed  (rollback + reseed)
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";
import { STATE_LGAS } from "../src/lib/nigeria";

const db = new PrismaClient();
const BATCH = "crm-vol-1";
const TARGET_FAMILIES = 1500;

// deterministic PRNG so re-runs produce the same shapes
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260206);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;

const FIRST_M = ["Chinedu", "Emeka", "Kelechi", "Obinna", "Ifeanyi", "Nnamdi", "Tunde", "Femi", "Ade", "Bola", "Kunle", "Segun", "Wale", "Oluwaseun", "Babatunde", "Akin", "Gbenro", "Damilola", "Sule", "Ibrahim", "Musa", "Abubakar", "Yusuf", "Emmanuel", "Samuel", "David", "Daniel", "Gabriel", "Michael", "Joseph", "Peter", "Paul", "John", "James", "Victor", "Vincent", "Augustine", "Desmond", "Festus", "Gideon", "Habila", "Ismail", "Jonah", "Kabiru", "Lawal", "Murtala", "Nasir", "Oche", "Philip", "Raphael", "Sylvester", "Terhemba", "Uche", "Yakubu", "Zephaniah", "Blessing", "Sunday", "Elijah", "Caleb", "Reuben"];
const FIRST_F = ["Aisha", "Amaka", "Blessing", "Chiamaka", "Chidinma", "Ebere", "Faith", "Funmilayo", "Grace", "Halima", "Ifeoma", "Joy", "Kemi", "Latifat", "Maryam", "Ngozi", "Nneka", "Oluchi", "Omolara", "Patience", "Ruth", "Sarah", "Tolulope", "Uzoamaka", "Wosilat", "Yemisi", "Zainab", "Adaeze", "Bukola", "Chinyere", "Deborah", "Esther", "Folasade", "Gloria", "Hauwa", "Iyabo", "Jumoke", "Khadijat", "Lilian", "Mercy", "Nkiru", "Oluwakemi", "Precious", "Rebecca", "Simisola", "Taiwo", "Uduak", "Veronica", "Yetunde", "Zuriel", "Abigail", "Cynthia", "Damilola", "Henrietta", "Janet", "Martina", "Omolola", "Victoria"];
const LAST = ["Adeyemi", "Okafor", "Balogun", "Nwachukwu", "Oyelaran", "Adebayo", "Eze", "Bello", "Ogunleye", "Chukwu", "Afolabi", "Lawal", "Obi", "Ibrahim", "Oladipo", "Adeyinka", "Musa", "Oyewole", "Danjuma", "Abiodun", "Nwosu", "Olatunji", "Adebisi", "Yakubu", "Igwe", "Salami", "Oyediran", "Mohammed", "Akinwale", "Nnamani", "Fashola", "Ogunbiyi", "Umeh", "Sanni", "Ojo", "Owolabi", "Peters", "Okonkwo", "Adeleke", "Bakare", "Uzoma", "Tijani", "Onyeka", "Arowolo", "Ekwueme", "Osuji", "Kalu", "Ogundipe", "Aliyu", "Ige", "Adesina", "Nnaji", "Oladiran", "Amadi", "Oduya", "Bassey", "Etim", "Hassan", "Okoro", "Fagbemi", "Adejobi", "Madaki", "Njoku", "Osinachi", "Talabi", "Ude", "Wahab", "Yekini", "Zibima", "Emefiele", "Daramola"];
const TITLES_M = ["Mr", "Mr", "Mr", "Dr", "Pastor", "Rev", "Chief"];
const TITLES_F = ["Mrs", "Mrs", "Mrs", "Miss", "Dr", "Pastor", "Chief", "Alhaja"];
const OCCUPATIONS = ["Teacher", "Trader", "Nurse", "Civil servant", "Banker", "Engineer", "Tailor", "Artisan", "Driver", "Pharmacist", "Accountant", "Software developer", "Shop owner", "Farmer", "Medical doctor", "Lawyer", "Caterer", "Student", "Retired", "Electrician", "Plumber", "Event planner", "Photographer", "Logistics"];
const EMPLOYERS = ["GTBank", "MTN Nigeria", "Airtel", "Dangote Group", "Lagos State Government", "First Bank", "UNILAG", "LASUTH", "Shoprite", "Jumia", "Flutterwave", "Paystack", "Self-employed", "Faith Springs Academy", "Redeem Baptist Schools"];
const STREETS = ["Herbert Macaulay Way", "Awolowo Road", "Adeola Odeku Street", "Allen Avenue", "Obafemi Awolowo Way", "Ahmadu Bello Way", "Ring Road", "Church Street", "Saka Tinubu Street", "Adeniyi Jones Avenue", "Bode Thomas Street", "Ikorodu Road"];
const PREFIXES = ["803", "806", "810", "813", "814", "816", "903", "906", "703", "706", "817", "818", "909", "902", "802", "808", "809", "811", "815", "705"];
const STATE_WEIGHTS: [string, number][] = [
  ["Lagos", 55], ["Ogun", 10], ["Oyo", 7], ["Federal Capital Territory", 6],
  ["Rivers", 4], ["Edo", 3], ["Enugu", 3], ["Kaduna", 3], ["Anambra", 3],
  ["Delta", 2], ["Ondo", 2], ["Osun", 2],
];
const STAGES: [string, number][] = [
  ["member", 30], ["attender", 25], ["guest", 12], ["returning_guest", 8],
  ["leader", 5], ["inactive", 18], ["member", 2],
];
const SOURCES = ["guest_card", "referral", "outreach", "whatsapp", "online", "other"];
const TAG_COLORS = ["amber", "teal", "violet", "rose", "cyan"];

function weighted(pairs: [string, number][]): string {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[0][0];
}

function birthdayFor(ageYears: number): Date {
  const today = new Date();
  const d = new Date(
    Date.UTC(today.getUTCFullYear() - ageYears, int(0, 11), int(1, 28))
  );
  return d;
}

function birthdayWithin(ageYears: number, days: number): Date {
  // keep the person's age; only move month/day into the next `days` window
  const today = new Date();
  const t = new Date(today.getTime() + days * 86_400_000);
  let year = today.getUTCFullYear() - ageYears;
  let d = new Date(Date.UTC(year, t.getUTCMonth(), t.getUTCDate()));
  if (d.getTime() > today.getTime()) {
    year -= 1;
    d = new Date(Date.UTC(year, t.getUTCMonth(), t.getUTCDate()));
  }
  return d;
}

function phone(): { raw: string; e164: string } | null {
  if (!chance(0.85)) return null;
  const nsn = pick(PREFIXES) + String(int(1000000, 9999999));
  return { raw: `0${nsn}`, e164: `+234${nsn}` };
}

function lastAttendedFor(stage: string): Date | null {
  const r = rand();
  if (stage === "guest" || stage === "returning_guest") {
    return r < 0.8 ? new Date(Date.now() - int(1, 60) * 86_400_000) : null;
  }
  if (stage === "inactive") return r < 0.5 ? new Date(Date.now() - int(120, 700) * 86_400_000) : null;
  if (r < 0.62) return new Date(Date.now() - int(0, 29) * 86_400_000);
  if (r < 0.78) return new Date(Date.now() - int(30, 90) * 86_400_000);
  if (r < 0.9) return new Date(Date.now() - int(91, 365) * 86_400_000);
  if (r < 0.95) return new Date(Date.now() - int(366, 900) * 86_400_000);
  return null;
}

interface FamilyDraft {
  headEmail: string;
  memberKeys: { key: string; role: string }[];
  guardianGap: boolean;
}

interface PersonDraft {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  title: string | null;
  gender: "m" | "f";
  birthdate: Date;
  phone: string | null;
  phoneE164: string | null;
  whatsappE164: string | null;
  emailOnFile: string | null;
  maritalStatus: string | null;
  weddingAnniversary: Date | null;
  occupation: string | null;
  employer: string | null;
  state: string;
  lga: string;
  lifecycleStage: string;
  membershipStatus: string;
  status: string;
  membershipDate: Date | null;
  salvationDate: Date | null;
  baptismDate: Date | null;
  source: string;
  directoryPrivacy: string;
  lastAttendedAt: Date | null;
  allergies: string | null;
  homeCampusId: string | null;
  isChild: boolean;
}

async function cleanBatch(orgId: string) {
  // FK-order delete of everything the batch created (volume rows only —
  // existing demo data is never touched).
  const batchIds = (await db.person.findMany({ where: { orgId, importBatchId: BATCH }, select: { id: true } })).map((p) => p.id);
  if (batchIds.length === 0) {
    console.log("Nothing to clean.");
    return;
  }
  const r1 = await db.personRelationship.deleteMany({ where: { orgId, fromPersonId: { in: batchIds } } });
  const r2 = await db.householdMember.deleteMany({ where: { personId: { in: batchIds } } });
  const r3 = await db.household.deleteMany({ where: { orgId, headPersonId: { in: batchIds } } });
  const r4 = await db.groupMember.deleteMany({ where: { orgId, personId: { in: batchIds } } });
  const r5 = await db.personTag.deleteMany({ where: { personId: { in: batchIds } } });
  const r6 = await db.person.deleteMany({ where: { orgId, importBatchId: BATCH } });
  console.log(`Cleaned batch: rel=${r1.count} hhMembers=${r2.count} households=${r3.count} groupMembers=${r4.count} tags=${r5.count} people=${r6.count}`);
}

async function main() {
  const org = await db.organization.findFirst();
  if (!org) throw new Error("No organization found.");

  if (process.argv.includes("--clean")) {
    await cleanBatch(org.id);
    if (!process.argv.includes("--reseed")) return;
  }

  const existing = await db.person.count({ where: { orgId: org.id, importBatchId: BATCH } });
  if (existing > 0 && !process.argv.includes("--more")) {
    console.log(`Volume batch "${BATCH}" already present (${existing} people). Nothing to do. Use --more to add another batch.`);
    return;
  }

  const campuses = await db.campus.findMany({ where: { orgId: org.id }, select: { id: true } });
  const campusIds = campuses.map((c) => c.id);

  let tags = await db.tag.findMany({ where: { orgId: org.id }, select: { id: true } });
  if (tags.length === 0) {
    const created: { id: string }[] = [];
    for (const [name, color] of [["New convert", "teal"], ["Worker", "violet"], ["Choir", "amber"], ["Youth", "cyan"]] as const) {
      created.push(await db.tag.create({ data: { orgId: org.id, name, color } }));
    }
    tags = created;
  }
  const tagIds = tags.map((t) => t.id);

  const groups = await db.group.findMany({
    where: { orgId: org.id, deletedAt: null, status: "active" },
    select: { id: true },
  });

  // ── generate people + families ─────────────────────────────────────────────
  let seq = 10_000 + Math.floor(Math.random() * 1000);
  const nextEmail = (first: string, last: string) =>
    `${first.toLowerCase()}.${last.toLowerCase()}.${seq++}@members.redeem.example`.replace(/[^a-z0-9.@]/g, "");

  const drafts: PersonDraft[] = [];
  const families: FamilyDraft[] = [];

  const makeAdult = (lastName: string, gender: "m" | "f", ageMin: number, ageMax: number, marriedTo?: string): PersonDraft => {
    const first = gender === "m" ? pick(FIRST_M) : pick(FIRST_F);
    const age = int(ageMin, ageMax);
    const p = phone();
    const email = nextEmail(first, lastName);
    const stage = weighted(STAGES);
    const married = marriedTo !== undefined || (age >= 26 && chance(0.62));
    const privacy: Record<string, boolean> = {
      phone: chance(0.2),
      email: chance(0.12),
      birthday: chance(0.08),
      address: false,
    };
    drafts.push({
      key: email,
      email,
      firstName: first,
      lastName,
      preferredName: chance(0.25) ? pick(["Bro", "Sis", "Pastor", "Chief", first.slice(0, 3) + "y", "Deacon", "Deaconess"]) : null,
      title: age >= 25 && chance(0.35) ? (gender === "m" ? pick(TITLES_M) : pick(TITLES_F)) : null,
      gender,
      birthdate: birthdayFor(age),
      phone: p?.raw ?? null,
      phoneE164: p?.e164 ?? null,
      whatsappE164: p && chance(0.75) ? p.e164 : null,
      // always on file: the volume email doubles as the unique insert key so
      // the script can map generated drafts back to DB ids in one query
      emailOnFile: email,
      maritalStatus: married ? "married" : age < 26 ? "single" : chance(0.5) ? "single" : chance(0.5) ? "engaged" : "widowed",
      weddingAnniversary: married && chance(0.7) ? new Date(Date.UTC(int(1995, 2023), int(0, 11), int(1, 28))) : null,
      occupation: chance(0.6) ? pick(OCCUPATIONS) : null,
      employer: chance(0.4) ? pick(EMPLOYERS) : null,
      state: weighted(STATE_WEIGHTS),
      lga: "",
      lifecycleStage: stage,
      membershipStatus: stage === "member" ? "member" : stage === "attender" ? "regular" : "none",
      status: chance(0.985) ? "active" : "archived",
      membershipDate: chance(0.7) ? new Date(Date.now() - int(30, 2900) * 86_400_000) : null,
      salvationDate: chance(0.5) ? new Date(Date.now() - int(200, 6000) * 86_400_000) : null,
      baptismDate: chance(0.4) ? new Date(Date.now() - int(200, 5000) * 86_400_000) : null,
      source: pick(SOURCES),
      directoryPrivacy: JSON.stringify(privacy),
      lastAttendedAt: lastAttendedFor(stage),
      allergies: null,
      homeCampusId: campusIds.length > 0 && chance(0.8) ? pick(campusIds) : null,
      isChild: false,
    });
    return drafts[drafts.length - 1];
  };

  const makeChild = (lastName: string, gender: "m" | "f", age: number): PersonDraft => {
    const first = gender === "m" ? pick(FIRST_M) : pick(FIRST_F);
    const email = nextEmail(first, lastName);
    const stage = chance(0.75) ? "attender" : "member";
    drafts.push({
      key: email,
      email,
      firstName: first,
      lastName,
      preferredName: null,
      title: null,
      gender,
      birthdate: birthdayFor(age),
      phone: null,
      phoneE164: null,
      whatsappE164: null,
      // unique insert key — always stored (see makeAdult note)
      emailOnFile: email,
      maritalStatus: null,
      weddingAnniversary: null,
      occupation: age >= 18 ? pick(OCCUPATIONS) : chance(0.3) ? "Student" : null,
      employer: null,
      state: weighted(STATE_WEIGHTS),
      lga: "",
      lifecycleStage: stage,
      membershipStatus: stage === "member" ? "member" : "regular",
      status: "active",
      membershipDate: chance(0.4) ? new Date(Date.now() - int(30, 1800) * 86_400_000) : null,
      salvationDate: age >= 10 && chance(0.4) ? new Date(Date.now() - int(100, 1200) * 86_400_000) : null,
      baptismDate: age >= 12 && chance(0.35) ? new Date(Date.now() - int(50, 1000) * 86_400_000) : null,
      source: "guest_card",
      directoryPrivacy: JSON.stringify({ phone: false, email: false, birthday: false, address: false }),
      lastAttendedAt: lastAttendedFor(stage),
      allergies: chance(0.07) ? pick(["Penicillin", "Peanuts", "Shellfish", "Cow milk", "Bee sting"]) : null,
      homeCampusId: campusIds.length > 0 && chance(0.5) ? pick(campusIds) : null,
      isChild: age < 18,
    });
    return drafts[drafts.length - 1];
  };

  function ageOf(bd: Date): number {
    const now = new Date();
    let a = now.getUTCFullYear() - bd.getUTCFullYear();
    const m = now.getUTCMonth() - bd.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < bd.getUTCDate())) a--;
    return a;
  }

  for (let f = 0; f < TARGET_FAMILIES; f++) {
    const lastName = pick(LAST);
    const state = weighted(STATE_WEIGHTS);
    const lgas = STATE_LGAS[state] ?? ["Central"];
    const lga = pick([...lgas]);

    const head = makeAdult(lastName, "m", 26, 62);
    head.state = state;
    head.lga = lga;

    const couple = chance(0.72);
    let spouse: PersonDraft | null = null;
    if (couple) {
      spouse = makeAdult(lastName, "f", 24, 60, head.email);
      spouse.state = state;
      spouse.lga = lga;
    }

    const childCount = couple ? int(0, 4) : int(0, 1);
    const children: PersonDraft[] = [];
    for (let c = 0; c < childCount; c++) {
      const child = makeChild(lastName, chance(0.5) ? "m" : "f", int(1, couple ? 21 : 8));
      child.state = state;
      child.lga = lga;
      children.push(child);
    }

    // ~2% of everyone gets a birthday inside the next-7-days window (age kept)
    for (const p of [head, ...(spouse ? [spouse] : []), ...children]) {
      if (chance(0.02)) p.birthdate = birthdayWithin(ageOf(p.birthdate), int(0, 6));
    }

    // ~1.5% of families become deliberate data-health gaps: minors with no
    // guardian linked (the exact case the Data Health tab is meant to surface)
    const guardianGap = chance(0.015);

    families.push({
      headEmail: head.email,
      memberKeys: [
        { key: head.email, role: "head" },
        ...(spouse ? [{ key: spouse.email, role: "spouse" }] : []),
        ...children.map((c) => ({ key: c.email, role: ageOf(c.birthdate) >= 18 ? "adult" : "child" })),
      ],
      guardianGap,
    });
  }

  // single adults without household (~9% of adults live alone → "no household")
  for (let i = 0; i < 260; i++) {
    const p = makeAdult(pick(LAST), chance(0.5) ? "m" : "f", 22, 70);
    if (chance(0.02)) p.birthdate = birthdayWithin(ageOf(p.birthdate), int(0, 6));
  }

  function ageOf(bd: Date): number {
    const now = new Date();
    let a = now.getUTCFullYear() - bd.getUTCFullYear();
    const m = now.getUTCMonth() - bd.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < bd.getUTCDate())) a--;
    return a;
  }

  console.log(`Generated ${drafts.length} people across ${families.length} families + singles.`);

  // ── insert people (chunked createMany) ─────────────────────────────────────
  const CHUNK = 300;
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const slice = drafts.slice(i, i + CHUNK);
    await db.person.createMany({
      data: slice.map((p) => ({
        orgId: org.id,
        importBatchId: BATCH,
        firstName: p.firstName,
        lastName: p.lastName,
        preferredName: p.preferredName,
        email: p.emailOnFile,
        phone: p.phone,
        phoneE164: p.phoneE164,
        whatsappE164: p.whatsappE164,
        birthdate: p.birthdate,
        gender: p.gender,
        title: p.title,
        maritalStatus: p.maritalStatus,
        weddingAnniversary: p.weddingAnniversary,
        occupation: p.occupation,
        employer: p.employer,
        preferredChannel: chance(0.4) ? pick(["sms", "email", "whatsapp", "call", "any"]) : null,
        state: p.state,
        lga: p.lga,
        lifecycleStage: p.lifecycleStage,
        membershipStatus: p.membershipStatus,
        status: p.status,
        membershipDate: p.membershipDate,
        salvationDate: p.salvationDate,
        baptismDate: p.baptismDate,
        source: p.source,
        directoryPrivacy: p.directoryPrivacy,
        lastAttendedAt: p.lastAttendedAt,
        allergies: p.allergies,
        homeCampusId: p.homeCampusId,
      })),
    });
  }

  // map email → id for the rows we just created (email is ALWAYS on file for
  // volume people — it doubles as the unique insert key)
  const created = await db.person.findMany({
    where: { orgId: org.id, importBatchId: BATCH },
    select: { id: true, email: true },
  });
  const keyToId = new Map<string, string>();
  for (const row of created) {
    if (row.email) keyToId.set(row.email, row.id);
  }

  console.log(`Inserted ${created.length} people; resolved ${keyToId.size}/${drafts.length} ids.`);

  // ── households + memberships + guardian links ──────────────────────────────
  const streets = STREETS;
  let hhIndex = 0;
  const hhMembers: { householdId: string; personId: string; role: string; isPrimary: boolean }[] = [];
  const guardianLinks: {
    orgId: string; fromPersonId: string; toPersonId: string;
    type: string; relationshipType: string; isGuardian: boolean; authorizedPickup: boolean;
  }[] = [];

  for (const fam of families) {
    const headId = keyToId.get(fam.headEmail);
    if (!headId) continue;
    const draft = drafts.find((d) => d.key === fam.headEmail)!;
    hhIndex += 1;
    const hh = await db.household.create({
      data: {
        orgId: org.id,
        name: `The ${draft.lastName} Family`,
        addressLine1: chance(0.85) ? `${int(1, 240)} ${pick(streets)}` : null,
        city: draft.lga || null,
        region: draft.state,
        country: "NG",
        headPersonId: headId,
      },
      select: { id: true },
    });
    for (const m of fam.memberKeys) {
      const pid = keyToId.get(m.key);
      if (!pid) continue;
      hhMembers.push({ householdId: hh.id, personId: pid, role: m.role, isPrimary: m.role === "head" });
    }
    // guardian links for minors (unless the family is a deliberate data gap)
    for (const m of fam.memberKeys) {
      const pid = keyToId.get(m.key);
      if (!pid || m.role !== "child") continue;
      if (fam.guardianGap) continue;
      const childDraft = drafts.find((d) => d.key === m.key);
      if (!childDraft || !childDraft.isChild) continue;
      guardianLinks.push({
        orgId: org.id, fromPersonId: headId, toPersonId: pid,
        type: "guardian", relationshipType: "parent", isGuardian: true, authorizedPickup: chance(0.7),
      });
      const spouseKey = fam.memberKeys.find((x) => x.role === "spouse");
      if (spouseKey) {
        const spouseId = keyToId.get(spouseKey.key);
        if (spouseId) {
          guardianLinks.push({
            orgId: org.id, fromPersonId: spouseId, toPersonId: pid,
            type: "guardian", relationshipType: "parent", isGuardian: true, authorizedPickup: chance(0.6),
          });
        }
      }
    }
  }

  for (let i = 0; i < hhMembers.length; i += CHUNK) {
    await db.householdMember.createMany({ data: hhMembers.slice(i, i + CHUNK).map((m) => ({ householdId: m.householdId, personId: m.personId, role: m.role, isPrimaryContact: m.isPrimary })) });
  }
  for (let i = 0; i < guardianLinks.length; i += CHUNK) {
    await db.personRelationship.createMany({ data: guardianLinks.slice(i, i + CHUNK) });
  }
  console.log(`Households: ${hhIndex} · memberships: ${hhMembers.length} · guardian links: ${guardianLinks.length}`);

  // ── group memberships ───────────────────────────────────────────────────────
  if (groups.length > 0) {
    const gms: { orgId: string; groupId: string; personId: string; role: string; status: string }[] = [];
    for (const d of drafts) {
      if (d.isChild) continue;
      const n = chance(0.42) ? (chance(0.25) ? 2 : 1) : 0;
      for (let i = 0; i < n; i++) {
        const pid = keyToId.get(d.key);
        if (!pid) continue;
        gms.push({ orgId: org.id, groupId: pick(groups).id, personId: pid, role: chance(0.03) ? "leader" : "member", status: "active" });
      }
    }
    // dedupe (groupId, personId) — the model has a composite unique
    const seen = new Set<string>();
    const deduped = gms.filter((g) => {
      const k = `${g.groupId}:${g.personId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (let i = 0; i < deduped.length; i += CHUNK) {
      await db.groupMember.createMany({ data: deduped.slice(i, i + CHUNK) });
    }
    console.log(`Group memberships: ${deduped.length}`);
  }

  // ── tags ────────────────────────────────────────────────────────────────────
  const personTags: { personId: string; tagId: string }[] = [];
  for (const d of drafts) {
    if (!chance(0.15)) continue;
    const pid = keyToId.get(d.key);
    if (!pid) continue;
    personTags.push({ personId: pid, tagId: pick(tagIds) });
    if (chance(0.3)) personTags.push({ personId: pid, tagId: pick(tagIds) });
  }
  const ptSeen = new Set<string>();
  const ptDedup = personTags.filter((t) => {
    const k = `${t.personId}:${t.tagId}`;
    if (ptSeen.has(k)) return false;
    ptSeen.add(k);
    return true;
  });
  await db.personTag.createMany({ data: ptDedup });
  console.log(`Tags attached: ${ptDedup.length}`);

  const finalCount = await db.person.count({ where: { orgId: org.id, deletedAt: null, mergedIntoId: null } });
  console.log(`Done. Live people in org now: ${finalCount}`);
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("VOLUME SEED FAILED:", err);
    await db.$disconnect();
    process.exit(1);
  });
