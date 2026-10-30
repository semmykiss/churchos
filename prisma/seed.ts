/**
 * Seed — Grace Chapel demo tenant.
 * Deterministic (seeded PRNG) so dashboards always show believable data.
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const db = new PrismaClient();

// ── deterministic PRNG ───────────────────────────────────────────────────────
let s = 0x9e3779b9;
function rnd() {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// ── date helpers (local wall-time naive; campus tz America/Chicago) ─────────
const D = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(Date.UTC(y, m, d, hh, mm));
function addDays(dt: Date, n: number) { const x = new Date(dt); x.setUTCDate(x.getUTCDate() + n); return x; }
function addMonths(dt: Date, n: number) { const x = new Date(dt); x.setUTCMonth(x.getUTCMonth() + n); return x; }
function sundayBefore(dt: Date): Date { const x = new Date(dt); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); return x; }
const fmtDate = (dt: Date) => dt.toISOString().slice(0, 10);
function age(bd: Date, at = new Date()) {
  let a = at.getUTCFullYear() - bd.getUTCFullYear();
  const m = at.getUTCMonth() - bd.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < bd.getUTCDate())) a--;
  return a;
}
function ageGroup(bd: Date | null, at = new Date()): string {
  if (!bd) return "adults";
  const a = age(bd, at);
  if (a < 2) return "nursery";
  if (a < 6) return "preschool";
  if (a < 12) return "kids";
  if (a < 18) return "students";
  return "adults";
}

// ── demo people ──────────────────────────────────────────────────────────────
type SeedPerson = {
  first: string; last: string; email?: string; phone?: string; bd?: string;
  gender?: "m" | "f"; stage: string; member?: string; allergies?: string;
  firstVisit?: string; joined?: string; role?: "head" | "spouse" | "adult" | "child";
};

const STAFF: SeedPerson[] = [
  { first: "David", last: "Whitfield", email: "david@gracechapel.demo", phone: "+15550100001", bd: "1973-04-12", gender: "m", stage: "leader", member: "member" },
  { first: "Renee", last: "Alvarez", email: "renee@gracechapel.demo", phone: "+15550100002", bd: "1987-09-03", gender: "f", stage: "leader", member: "member" },
  { first: "Tom", last: "Bergstrom", email: "tom@gracechapel.demo", phone: "+15550100003", bd: "1964-01-28", gender: "m", stage: "leader", member: "member" },
  { first: "Grace", last: "Hollan", email: "grace@gracechapel.demo", phone: "+15550100004", bd: "1991-06-19", gender: "f", stage: "leader", member: "member" },
  { first: "Marcus", last: "Reed", email: "marcus@gracechapel.demo", phone: "+15550100005", bd: "1980-11-08", gender: "m", stage: "leader", member: "member" },
  { first: "Sarah", last: "Okoye", email: "sarah@gracechapel.demo", phone: "+15550100006", bd: "1984-02-22", gender: "f", stage: "leader", member: "member" },
];

const FAMILIES: { name: string; head: SeedPerson; members: SeedPerson[] }[] = [
  {
    name: "The Bennett Family", head: { first: "Aisha", last: "Bennett", email: "aisha@gracechapel.demo", phone: "+15550100010", bd: "1989-07-30", gender: "f", stage: "member", member: "member", role: "head" },
    members: [
      { first: "Daniel", last: "Bennett", email: "daniel.bennett@demo.mail", phone: "+15550100011", bd: "1986-10-14", gender: "m", stage: "member", member: "member", role: "spouse" },
      { first: "Zoe", last: "Bennett", bd: "2021-03-05", gender: "f", stage: "attender", allergies: "Peanut allergy (EpiPen in nursery cabinet)", role: "child" },
      { first: "Eli", last: "Bennett", bd: "2017-08-19", gender: "m", stage: "attender", role: "child" },
    ],
  },
  {
    name: "The Castillo Family", head: { first: "Miguel", last: "Castillo", email: "miguel.c@demo.mail", phone: "+15550100020", bd: "1978-05-02", gender: "m", stage: "member", member: "member", role: "head" },
    members: [
      { first: "Lucia", last: "Castillo", email: "lucia.c@demo.mail", phone: "+15550100021", bd: "1981-12-11", gender: "f", stage: "member", member: "member", role: "spouse" },
      { first: "Mateo", last: "Castillo", bd: "2015-06-27", gender: "m", stage: "attender", role: "child" },
      { first: "Sofia", last: "Castillo", bd: "2019-01-16", gender: "f", stage: "attender", allergies: "Penicillin", role: "child" },
    ],
  },
  {
    name: "The Nakamura Family", head: { first: "Kenji", last: "Nakamura", email: "kenji.n@demo.mail", phone: "+15550100030", bd: "1975-08-21", gender: "m", stage: "member", member: "member", role: "head" },
    members: [
      { first: "Hana", last: "Nakamura", email: "hana.n@demo.mail", phone: "+15550100031", bd: "1977-03-09", gender: "f", stage: "member", member: "member", role: "spouse" },
      { first: "Rin", last: "Nakamura", bd: "2013-11-30", gender: "f", stage: "attender", role: "child" },
    ],
  },
  {
    name: "The Okafor Family", head: { first: "Chidi", last: "Okafor", email: "chidi.o@demo.mail", phone: "+15550100040", bd: "1982-02-17", gender: "m", stage: "attender", member: "regular", role: "head" },
    members: [
      { first: "Amara", last: "Okafor", email: "amara.o@demo.mail", phone: "+15550100041", bd: "1985-09-25", gender: "f", stage: "attender", member: "regular", role: "spouse" },
      { first: "Nnamdi", last: "Okafor", bd: "2020-04-08", gender: "m", stage: "guest", role: "child" },
    ],
  },
  {
    name: "The Peterson Family", head: { first: "Eric", last: "Peterson", email: "eric.p@demo.mail", phone: "+15550100050", bd: "1970-10-06", gender: "m", stage: "member", member: "member", role: "head" },
    members: [
      { first: "Julie", last: "Peterson", email: "julie.p@demo.mail", phone: "+15550100051", bd: "1972-04-29", gender: "f", stage: "member", member: "member", role: "spouse" },
      { first: "Owen", last: "Peterson", bd: "2009-12-01", gender: "m", stage: "attender", role: "child" },
      { first: "Ella", last: "Peterson", bd: "2012-07-23", gender: "f", stage: "attender", allergies: "Lactose intolerant", role: "child" },
    ],
  },
  {
    name: "The Williams Family", head: { first: "Tasha", last: "Williams", email: "tasha.w@demo.mail", phone: "+15550100060", bd: "1993-01-15", gender: "f", stage: "member", member: "member", role: "head" },
    members: [
      { first: "Jordan", last: "Williams", bd: "2022-09-12", gender: "m", stage: "attender", role: "child" },
    ],
  },
];

const SINGLE_ADULTS: SeedPerson[] = [
  { first: "Frank", last: "Delgado", email: "frank.d@demo.mail", phone: "+15550100101", bd: "1961-03-18", gender: "m", stage: "member", member: "member", joined: "2016-05-01" },
  { first: "Miriam", last: "Holt", email: "miriam.h@demo.mail", phone: "+15550100102", bd: "1955-11-27", gender: "f", stage: "member", member: "member", joined: "2012-09-16" },
  { first: "Andre", last: "Kimani", email: "andre.k@demo.mail", phone: "+15550100103", bd: "1994-08-04", gender: "m", stage: "attender", member: "regular", firstVisit: "2025-09-14" },
  { first: "Bethany", last: "Moore", email: "bethany.m@demo.mail", phone: "+15550100104", bd: "1996-02-11", gender: "f", stage: "attender", member: "regular", firstVisit: "2025-10-05" },
  { first: "Calvin", last: "Ross", email: "calvin.r@demo.mail", phone: "+15550100105", bd: "1988-06-30", gender: "m", stage: "attender", member: "regular", firstVisit: "2025-08-24" },
  { first: "Danielle", last: "Foster", email: "danielle.f@demo.mail", phone: "+15550100106", bd: "1990-12-19", gender: "f", stage: "attender", member: "regular", firstVisit: "2025-06-08" },
  { first: "Evan", last: "Park", email: "evan.p@demo.mail", phone: "+15550100107", bd: "1998-05-22", gender: "m", stage: "returning_guest", firstVisit: "2025-10-12" },
  { first: "Fiona", last: "Adeyemi", email: "fiona.a@demo.mail", phone: "+15550100108", bd: "1992-09-08", gender: "f", stage: "guest", firstVisit: "2026-10-19" },
  { first: "George", last: "Sandoval", email: "george.s@demo.mail", phone: "+15550100109", bd: "1958-07-14", gender: "m", stage: "member", member: "member", joined: "2009-02-01" },
  { first: "Helena", last: "Vargas", email: "helena.v@demo.mail", phone: "+15550100110", bd: "1979-01-26", gender: "f", stage: "member", member: "member", joined: "2015-11-08" },
  { first: "Ivan", last: "Chen", email: "ivan.c@demo.mail", phone: "+15550100111", bd: "1985-10-03", gender: "m", stage: "attender", member: "regular", firstVisit: "2025-04-13" },
  { first: "Joyce", last: "Mensah", email: "joyce.m@demo.mail", phone: "+15550100112", bd: "1997-04-17", gender: "f", stage: "attender", member: "regular", firstVisit: "2025-11-02" },
  { first: "Kurt", last: "Bauer", email: "kurt.b@demo.mail", phone: "+15550100113", bd: "1967-08-09", gender: "m", stage: "inactive", member: "regular", firstVisit: "2024-01-07" },
  { first: "Lena", last: "Whitfield", email: "lena.w@demo.mail", phone: "+15550100114", bd: "1975-06-11", gender: "f", stage: "member", member: "member", joined: "2014-03-09" },
  { first: "Miles", last: "Osei", email: "miles.o@demo.mail", phone: "+15550100115", bd: "1999-03-24", gender: "m", stage: "guest", firstVisit: "2026-10-19" },
  { first: "Nadia", last: "Rahman", email: "nadia.r@demo.mail", phone: "+15550100116", bd: "1991-11-13", gender: "f", stage: "guest", firstVisit: "2026-10-26" },
  { first: "Oscar", last: "Lindqvist", email: "oscar.l@demo.mail", phone: "+15550100117", bd: "1983-05-06", gender: "m", stage: "attender", member: "regular", firstVisit: "2025-09-28" },
  { first: "Priya", last: "Nair", email: "priya.n@demo.mail", phone: "+15550100118", bd: "1986-02-28", gender: "f", stage: "member", member: "member", joined: "2018-10-14" },
  { first: "Quentin", last: "Barnes", email: "quentin.b@demo.mail", phone: "+15550100119", bd: "1974-12-05", gender: "m", stage: "attender", member: "regular", firstVisit: "2025-05-18" },
  { first: "Rosa", last: "Marin", email: "rosa.m@demo.mail", phone: "+15550100120", bd: "1953-09-30", gender: "f", stage: "member", member: "member", joined: "2008-06-01" },
  { first: "Steve", last: "Doyle", email: "steve.d@demo.mail", phone: "+15550100121", bd: "1962-04-22", gender: "m", stage: "member", member: "member", joined: "2010-01-17" },
  { first: "Tanya", last: "Ivanova", email: "tanya.i@demo.mail", phone: "+15550100122", bd: "1989-08-16", gender: "f", stage: "attender", member: "regular", firstVisit: "2025-10-19" },
];

async function main() {
  console.log("Seeding Grace Chapel…");
  await db.auditLog.deleteMany();
  // wipe (order matters for FKs)
  const tables = [
    "workflowRun", "workflow", "prayerRequest", "careNote", "careCase", "assignment", "blockoutDate",
    "volunteerRole", "messageRecipient", "message", "communicationPreference", "givingStatement",
    "chatMessage", "chatParticipant", "chatConversation",
    "recurringGift", "paymentMethod", "pledge", "donationSplit", "donation", "batch", "fund",
    "attendanceRecord", "checkinSession", "event", "service", "joinRequest", "groupMember", "group",
    "personTag", "tag", "stageHistory", "customFieldDefinition", "personRelationship", "householdMember",
    "household", "person", "roleAssignment", "rolePermission", "role", "session", "membership", "user",
    "campus", "importJob", "fileRecord", "license", "partnerSession", "partnerUser", "organization",
  ] as const;
  for (const t of tables) await (db as any)[t].deleteMany({});

  const org = await db.organization.create({
    data: {
      name: "Grace Chapel", slug: "grace-chapel", timezone: "America/Chicago", currency: "USD",
      plan: "growth", fiscalYearStartMonth: 1, taxYearStartMonth: 1,
      settings: JSON.stringify({ monthlyBudgetCents: 2000000, quietHours: { start: "21:00", end: "08:00" }, smsRegion: "US" }),
    },
  });
  const campus = await db.campus.create({
    data: {
      orgId: org.id, name: "Grace Chapel — Main Street", code: "MAIN", isPrimary: true,
      address: "1200 Main Street", city: "Springfield", region: "MO", postal: "65804",
      phone: "+15550100000", serviceTimes: JSON.stringify(["09:00", "11:00"]),
    },
  });

  // ── roles + permissions ────────────────────────────────────────────────────
  const roleDefs: Record<string, string[]> = {
    owner: ["*"],
    campus_admin: [
      "people.view", "people.create", "people.edit", "people.archive", "people.merge",
      "groups.view", "groups.manage", "groups.attendance", "checkin.view", "checkin.manage", "checkin.kiosk",
      "events.view", "events.manage", "comms.view", "comms.send", "comms.sms.send", "comms.email.send",
      "comms.chat.use", "comms.chat.churchwide", "consent.view",
      "schedule.view", "schedule.assign", "care.view", "care.create", "care.manage",
      "workflows.view", "reports.view", "admin.view", "portal.use",
    ],
    finance: [
      "people.view", "giving.view", "giving.manage", "batches.manage", "statements.manage",
      "reports.view", "audit.view", "portal.use",
    ],
    ministry_leader: [
      "people.view", "groups.view", "groups.attendance", "schedule.view", "schedule.respond",
      "care.view", "care.create", "comms.view", "comms.send", "comms.chat.use", "comms.chat.churchwide",
      "reports.view", "portal.use",
    ],
    volunteer: ["schedule.view", "schedule.respond", "checkin.view", "checkin.kiosk", "comms.chat.use", "portal.use"],
    member: ["portal.use", "comms.chat.use"],
  };
  const roles: Record<string, string> = {};
  const roleNames: Record<string, string> = {
    owner: "Owner", campus_admin: "Campus Admin", finance: "Finance",
    ministry_leader: "Ministry Leader", volunteer: "Volunteer", member: "Member",
  };
  for (const [key, perms] of Object.entries(roleDefs)) {
    const r = await db.role.create({
      data: { orgId: org.id, key, name: roleNames[key], isSystem: true, permissions: { create: perms.map((p) => ({ permission: p })) } },
    });
    roles[key] = r.id;
  }
  // a custom (non-system) role to demo the enterprise role editor
  const worshipRole = await db.role.create({
    data: {
      orgId: org.id, key: "worship_team", name: "Worship Team",
      description: "Custom role — scheduling, check-in and comms visibility for worship team members.",
      isSystem: false,
      permissions: { create: ["schedule.view", "schedule.respond", "checkin.view", "comms.view", "portal.use"].map((p) => ({ permission: p })) },
    },
  });
  roles["worship_team"] = worshipRole.id;

  // ── people ─────────────────────────────────────────────────────────────────
  const P: Record<string, { id: string; name: string; first: string; last: string; email?: string; phone?: string; bd?: string }> = {};
  async function mkPerson(sp: SeedPerson, householdId?: string, role?: string): Promise<string> {
    const person = await db.person.create({
      data: {
        orgId: org.id,
        firstName: sp.first, lastName: sp.last,
        preferredName: rnd() < 0.12 ? sp.first[0] + "-" + sp.first : undefined,
        email: sp.email, phone: sp.phone,
        birthdate: sp.bd ? new Date(sp.bd + "T00:00:00Z") : undefined,
        gender: sp.gender,
        lifecycleStage: sp.stage,
        membershipStatus: sp.member ?? "none",
        homeCampusId: campus.id,
        firstVisitAt: sp.firstVisit ? new Date(sp.firstVisit + "T00:00:00Z") : (sp.joined ? new Date("2010-01-01T00:00:00Z") : undefined),
        allergies: sp.allergies,
        custom: JSON.stringify({ baptism: rnd() < 0.5 ? "baptized" : "not_baptized", small_group_member: sp.stage !== "guest" }),
      },
    });
    P[sp.first + " " + sp.last] = { id: person.id, name: `${sp.first} ${sp.last}`, first: sp.first, last: sp.last, email: sp.email, phone: sp.phone, bd: sp.bd };
    if (sp.joined) {
      await db.stageHistory.create({ data: { orgId: org.id, personId: person.id, stage: "member", changedAt: new Date(sp.joined + "T00:00:00Z"), changedByName: "Renee Alvarez", note: "Completed New Members Class" } });
    }
    if (sp.firstVisit) {
      await db.stageHistory.create({ data: { orgId: org.id, personId: person.id, stage: "guest", previousStage: null, changedAt: new Date(sp.firstVisit + "T00:00:00Z"), changedByName: "System", note: "First visit recorded" } });
    }
    if (householdId) {
      await db.householdMember.create({
        data: { householdId, personId: person.id, role: role ?? "adult", isPrimaryContact: role === "head" },
      });
    }
    return person.id;
  }

  // staff household-less
  for (const sp of STAFF) await mkPerson(sp);
  const staffIds = Object.fromEntries(STAFF.map((x) => [x.first, P[`${x.first} ${x.last}`].id]));

  // families with guardians
  for (const fam of FAMILIES) {
    const h = await db.household.create({
      data: {
        orgId: org.id, name: fam.name, campusId: campus.id,
        addressLine1: `${int(100, 9800)} ${pick(["Oak", "Maple", "Cedar", "Walnut", "Chestnut"])} ${pick(["St", "Ave", "Ln", "Dr"])}`,
        city: "Springfield", region: "MO", postalCode: `658${int(1, 9)}${int(1, 9)}`, phone: fam.head.phone,
      },
    });
    const headId = await mkPerson(fam.head, h.id, "head");
    await db.household.update({ where: { id: h.id }, data: { headPersonId: headId } });
    for (const m of fam.members) await mkPerson(m, h.id, m.role);
    // guardian links
    for (const m of fam.members) {
      if (m.role === "child") {
        await db.personRelationship.create({ data: { orgId: org.id, fromPersonId: headId, toPersonId: P[`${m.first} ${m.last}`].id, type: "guardian", isGuardian: true, authorizedPickup: true, custodyRestricted: false } });
        const spouse = fam.members.find((x) => x.role === "spouse");
        if (spouse) await db.personRelationship.create({ data: { orgId: org.id, fromPersonId: P[`${spouse.first} ${spouse.last}`].id, toPersonId: P[`${m.first} ${m.last}`].id, type: "guardian", isGuardian: true, authorizedPickup: !m.allergies, custodyRestricted: false } });
        // one custody-restricted example: Eric Peterson's kids — grandmother can pick up
        if (fam.name === "The Peterson Family") {
          await db.personRelationship.create({ data: { orgId: org.id, fromPersonId: staffIds["Renee"], toPersonId: P[`${m.first} ${m.last}`].id, type: "emergency", isGuardian: false, authorizedPickup: true, notes: "Emergency contact — grandmother next door" } });
        }
      }
    }
  }

  // singles
  for (const sp of SINGLE_ADULTS) await mkPerson(sp);

  // a deceased person (automation must stop) + a do-not-contact
  const deceased = await mkPerson({ first: "Walter", last: "Grimes", phone: "+15550100130", bd: "1944-02-02", gender: "m", stage: "archived" });
  await db.person.update({ where: { id: deceased }, data: { status: "deceased", custom: JSON.stringify({ do_not_contact: true }) } });
  const dnc = P["Kurt Bauer"];
  await db.person.update({ where: { id: dnc.id }, data: { custom: JSON.stringify({ do_not_contact: true }) } });

  const allPeople = await db.person.findMany({ where: { orgId: org.id, status: { not: "deceased" } } });
  const adults = allPeople.filter((p) => !p.birthdate || age(p.birthdate) >= 18);
  const kids = allPeople.filter((p) => p.birthdate && age(p.birthdate) < 18);

  // ── users & memberships & role assignments ─────────────────────────────────
  const pwd = hashPassword("grace2026");
  async function mkUser(email: string, personName: string, roleKey: string) {
    const person = P[personName];
    const u = await db.user.create({ data: { email, name: personName, passwordHash: pwd } });
    const m = await db.membership.create({ data: { orgId: org.id, userId: u.id, personId: person.id, defaultCampusId: campus.id } });
    await db.roleAssignment.create({ data: { orgId: org.id, membershipId: m.id, roleId: roles[roleKey], scopeType: roleKey === "ministry_leader" ? "group" : "campus", scopeId: roleKey === "ministry_leader" ? "young-families" : campus.id } });
    return { userId: u.id, membershipId: m.id };
  }
  await mkUser("david@gracechapel.demo", "David Whitfield", "owner");
  const reneeM = await mkUser("renee@gracechapel.demo", "Renee Alvarez", "campus_admin");
  const tomM = await mkUser("tom@gracechapel.demo", "Tom Bergstrom", "finance");
  const graceM = await mkUser("grace@gracechapel.demo", "Grace Hollan", "ministry_leader");
  const marcusM = await mkUser("marcus@gracechapel.demo", "Marcus Reed", "volunteer");
  // multi-role user demo: Marcus is a Volunteer AND on the custom Worship Team role
  await db.roleAssignment.create({ data: { orgId: org.id, membershipId: marcusM.membershipId, roleId: roles["worship_team"], scopeType: "campus", scopeId: campus.id } });
  await mkUser("sarah@gracechapel.demo", "Sarah Okoye", "campus_admin");
  await mkUser("aisha@gracechapel.demo", "Aisha Bennett", "member");

  // ── tags & custom fields ───────────────────────────────────────────────────
  const tagDefs = [
    { name: "Worship Team", color: "amber" }, { name: "Welcomes", color: "teal" },
    { name: "Prayer Shield", color: "violet" }, { name: "2026 Easter Guest", color: "orange" },
    { name: "Board Member", color: "stone" },
  ];
  const tags: Record<string, string> = {};
  for (const t of tagDefs) { const r = await db.tag.create({ data: { orgId: org.id, ...t } }); tags[t.name] = r.id; }
  for (const p of allPeople.slice(0, 14)) await db.personTag.create({ data: { personId: p.id, tagId: pick(Object.values(tags)) } }).catch(() => {});

  await db.customFieldDefinition.createMany({
    data: [
      { orgId: org.id, entity: "person", key: "baptism", label: "Baptism status", dataType: "select", options: JSON.stringify(["not_baptized", "baptized", "want_info"]), showInList: false },
      { orgId: org.id, entity: "person", key: "small_group_member", label: "In a small group?", dataType: "boolean", showInList: true },
      { orgId: org.id, entity: "person", key: "tshirt_size", label: "T-shirt size", dataType: "select", options: JSON.stringify(["S", "M", "L", "XL", "2XL"]), visibility: "leaders" },
      { orgId: org.id, entity: "person", key: "emergency_phone", label: "Emergency phone", dataType: "text", pii: true },
      { orgId: org.id, entity: "group", key: "study_guide", label: "Study guide", dataType: "text" },
    ],
  });

  // ── groups ─────────────────────────────────────────────────────────────────
  const groupDefs = [
    { key: "young-families", name: "Young Families", type: "small_group", leader: "Grace Hollan", day: "wednesday", time: "18:30", where: "Hollan home — 44 Birch Ln", capacity: 14 },
    { key: "students", name: "Students (6th–12th)", type: "class", leader: "Marcus Reed", day: "sunday", time: "16:00", where: "Room 4", capacity: 30 },
    { key: "wednesday-bible", name: "Wednesday Bible Study", type: "small_group", leader: "Frank Delgado", day: "wednesday", time: "19:00", where: "Fellowship Hall", capacity: 40 },
    { key: "choir", name: "Sanctuary Choir", type: "ministry", leader: "Priya Nair", day: "thursday", time: "19:00", where: "Sanctuary", capacity: 35 },
    { key: "hospitality", name: "Hospitality Team", type: "serve_team", leader: "Helena Vargas", day: "sunday", time: "08:15", where: "Lobby", capacity: 12 },
    { key: "mens-breakfast", name: "Men's Breakfast", type: "small_group", leader: "George Sandoval", day: "saturday", time: "07:30", where: "Fellowship Hall", capacity: 25 },
    { key: "moms-tots", name: "Moms & Tots", type: "small_group", leader: "Tasha Williams", day: "tuesday", time: "10:00", where: "Room 2", capacity: 15 },
    { key: "prayer-team", name: "Prayer Team", type: "ministry", leader: "Rosa Marin", day: "sunday", time: "08:00", where: "Prayer Room", capacity: 10 },
  ];
  const G: Record<string, { id: string; leaderPersonId: string | null }> = {};
  for (const g of groupDefs) {
    const gr = await db.group.create({
      data: {
        orgId: org.id, campusId: campus.id, name: g.name, type: g.type,
        leaderPersonId: P[g.leader]?.id, meetingDay: g.day, meetingTime: g.time,
        locationText: g.where, capacity: g.capacity,
        description: `${g.name} — meets ${g.day}s at ${g.time}.`,
        custom: JSON.stringify({ study_guide: "Current series guide" }),
      },
    });
    G[g.key] = { id: gr.id, leaderPersonId: P[g.leader]?.id ?? null };
    // members: leader + a slice of adults + some kids for students
    const chosen = new Set<string>([P[g.leader]?.id]);
    const pool = g.key === "students" ? kids : adults;
    const n = Math.min(int(7, 11), pool.length);
    while (chosen.size < n + 1) chosen.add(pick(pool).id);
    let i = 0;
    for (const pid of chosen) {
      await db.groupMember.create({
        data: {
          orgId: org.id, groupId: gr.id, personId: pid,
          role: i === 0 ? "leader" : i === 1 && rnd() < 0.5 ? "co_leader" : "member",
          joinedAt: addDays(new Date(), -int(30, 700)),
        },
      });
      i++;
    }
    if (g.key === "young-families") {
      // grace leads her own group; ensure her membership record
      await db.groupMember.create({ data: { orgId: org.id, groupId: gr.id, personId: staffIds["Grace"], role: "leader", joinedAt: new Date("2023-09-01T00:00:00Z") } }).catch(() => {});
      // pending join requests
      await db.joinRequest.create({ data: { orgId: org.id, groupId: gr.id, personId: P["Nadia Rahman"].id, message: "Visited two Sundays — would love to join!", status: "pending" } });
      await db.joinRequest.create({ data: { orgId: org.id, groupId: gr.id, personId: P["Miles Osei"].id, message: "Heard about it from Andre.", status: "pending" } });
    }
  }
  // group attendance history for last 6 group meetings (for absentee detection)
  for (const g of Object.values(G)) {
    const members = await db.groupMember.findMany({ where: { groupId: g.id, status: "active" } });
    for (let w = 1; w <= 6; w++) {
      const meetDate = addDays(new Date(), -(w * 7 + 2));
      const ev = await db.event.create({
        data: {
          orgId: org.id, campusId: campus.id, groupId: g.id, name: "Group meeting", kind: "group_meeting",
          startsAt: meetDate, endsAt: new Date(meetDate.getTime() + 90 * 60000), status: "completed",
        },
      });
      for (const gm of members) {
        if (rnd() < 0.78) {
          await db.attendanceRecord.create({
            data: { orgId: org.id, personId: gm.personId, eventId: ev.id, status: "present", method: "roster", checkedInAt: ev.startsAt },
          }).catch(() => {});
        }
      }
    }
  }

  // ── services & Sunday events (9 past + today + 4 future) ────────────────────
  const svc9 = await db.service.create({ data: { orgId: org.id, campusId: campus.id, name: "Sunday Gathering — 9:00", byDay: "SU", timeOfDay: "09:00", durationMinutes: 75, checkinEnabled: true, locationText: "Sanctuary" } });
  const svc11 = await db.service.create({ data: { orgId: org.id, campusId: campus.id, name: "Sunday Gathering — 11:00", byDay: "SU", timeOfDay: "11:00", durationMinutes: 75, checkinEnabled: true, locationText: "Sanctuary" } });
  const svcWed = await db.service.create({ data: { orgId: org.id, campusId: campus.id, name: "Midweek Prayer", byDay: "WE", timeOfDay: "18:30", durationMinutes: 60, checkinEnabled: false } });

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const lastSunday = sundayBefore(today); // current week's Sunday (may be today)
  type EvRow = { id: string; startsAt: Date; svc: string; name: string; kids: boolean };
  const sundayEvents: EvRow[] = [];
  for (let w = -9; w <= 4; w++) {
    const d = addDays(lastSunday, w * 7);
    for (const svc of [svc9, svc11]) {
      const hh = svc.timeOfDay === "09:00" ? 9 : 11;
      const startsAt = D(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, 0);
      const isPast = startsAt.getTime() < Date.now();
      const ev = await db.event.create({
        data: {
          orgId: org.id, campusId: campus.id, serviceId: svc.id, name: svc.name, kind: "service",
          startsAt, endsAt: new Date(startsAt.getTime() + svc.durationMinutes * 60000),
          checkinEnabled: true, roomText: "Sanctuary", status: isPast ? "completed" : "scheduled",
        },
      });
      sundayEvents.push({ id: ev.id, startsAt, svc: svc.name, name: svc.name, kids: true });
    }
  }
  const wedEvents: EvRow[] = [];
  for (let w = -4; w <= 2; w++) {
    const d = addDays(today, w * 7 + (3 - today.getUTCDay()));
    const startsAt = D(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 18, 30);
    if (d.getUTCDay() !== 3) continue;
    const isPast = startsAt.getTime() < Date.now();
    const ev = await db.event.create({
      data: {
        orgId: org.id, campusId: campus.id, serviceId: svcWed.id, name: svcWed.name, kind: "service",
        startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60000), status: isPast ? "completed" : "scheduled",
      },
    });
    wedEvents.push({ id: ev.id, startsAt, svc: "Midweek", name: svcWed.name, kids: false });
  }
  const nmClass = await db.event.create({
    data: {
      orgId: org.id, campusId: campus.id, name: "New Members Class", kind: "class",
      startsAt: addDays(today, 14), endsAt: addDays(today, 15), roomText: "Room 3", capacity: 25, status: "scheduled",
    },
  });
  await db.event.create({ data: { orgId: org.id, campusId: campus.id, name: "Volunteer Appreciation Dinner", kind: "one_off", startsAt: D(today.getUTCFullYear(), today.getUTCMonth(), Math.max(1, today.getUTCDate() - 20), 18, 0), endsAt: D(today.getUTCFullYear(), today.getUTCMonth(), Math.max(1, today.getUTCDate() - 20), 20, 0), status: "completed", roomText: "Fellowship Hall" } });

  // ── attendance history on Sunday events ────────────────────────────────────
  const pastSundays = sundayEvents.filter((e) => e.startsAt.getTime() < Date.now());
  const attendanceRows: any[] = [];
  const givingSundays: { ev: EvRow; count: number }[] = [];
  for (const [i, ev] of pastSundays.entries()) {
    let headcount = 0;
    for (const p of allPeople) {
      const isChild = p.birthdate && age(p.birthdate) < 18;
      let pShow = isChild ? 0.62 : p.lifecycleStage === "member" ? 0.72 : p.lifecycleStage === "attender" ? 0.6 : p.lifecycleStage === "inactive" ? 0.08 : p.lifecycleStage === "guest" ? (new Date(ev.startsAt).getTime() >= new Date(p.firstVisitAt ?? ev.startsAt).getTime() ? 0.5 : 0) : 0.5;
      if (i % 2 === 1) pShow *= 0.85; // 11am lighter
      if (rnd() < pShow) {
        const firstTime = !!p.firstVisitAt && Math.abs(new Date(ev.startsAt).getTime() - new Date(p.firstVisitAt).getTime()) < 36 * 3600 * 1000;
        attendanceRows.push({
          orgId: org.id, personId: p.id, eventId: ev.id,
          status: isChild ? "checked_out" : "present",
          method: isChild ? "kiosk" : "roster",
          checkedInAt: new Date(ev.startsAt.getTime() - int(2, 14) * 60000),
          checkedOutAt: isChild ? new Date(ev.startsAt.getTime() + 78 * 60000) : null,
          firstTime, isVolunteer: rnd() < 0.16,
          roomText: isChild ? pick(["Nursery", "Preschool", "K–5th", "Students"]) : undefined,
        });
        headcount++;
      }
    }
    // a few absents recorded for the roster method events
    givingSundays.push({ ev, count: headcount });
  }
  for (let i = 0; i < attendanceRows.length; i += 400) {
    await db.attendanceRecord.createMany({ data: attendanceRows.slice(i, i + 400) });
  }

  // check-in records for kids on the most recent Sunday 9am (with security codes)
  const lastSun9 = pastSundays[pastSundays.length - 2] ?? pastSundays[pastSundays.length - 1];
  const cs = await db.checkinSession.create({
    data: {
      orgId: org.id, eventId: lastSun9.id, name: "Kids check-in", mode: "kiosk", requirePickupCode: true,
      opensAt: new Date(lastSun9.startsAt.getTime() - 45 * 60000),
      closesAt: new Date(lastSun9.startsAt.getTime() + 100 * 60000),
      kioskToken: "kiosk-" + randomBytes(12).toString("hex"), createdByName: "Renee Alvarez",
    },
  });
  for (const k of kids) {
    const code = String(int(1000, 9999));
    await db.attendanceRecord.upsert({
      where: { personId_eventId: { personId: k.id, eventId: lastSun9.id } },
      create: {
        orgId: org.id, personId: k.id, eventId: lastSun9.id, checkinSessionId: cs.id,
        status: "checked_out", method: "kiosk", pickupCode: code,
        checkedInAt: new Date(lastSun9.startsAt.getTime() - int(4, 20) * 60000),
        checkedOutAt: new Date(lastSun9.startsAt.getTime() + 80 * 60000),
        checkedInByName: "Kiosk", roomText: pick(["Nursery", "Preschool", "K–5th"]),
      },
      update: { pickupCode: code, checkinSessionId: cs.id },
    });
  }

  // ── funds, batches, donations, splits, pledges, recurring ──────────────────
  const fundDefs = [
    { name: "General Fund", code: "100", type: "general", goalCents: 320000000 },
    { name: "Building Fund", code: "200", type: "building", goalCents: 150000000 },
    { name: "Missions", code: "300", type: "missions", goalCents: 60000000 },
    { name: "Food Pantry", code: "310", type: "designated", goalCents: 20000000 },
    { name: "Youth Ministry", code: "320", type: "designated", goalCents: 15000000 },
  ];
  const F: Record<string, string> = {};
  for (const [i, f] of fundDefs.entries()) {
    const r = await db.fund.create({ data: { orgId: org.id, ...f, sortOrder: i } });
    F[f.name] = r.id;
  }

  const givers = adults.filter((p) => p.lifecycleStage === "member" || p.lifecycleStage === "attender" || p.lifecycleStage === "leader");
  const donationRows: any[] = [];
  const splitRows: any[] = [];
  // 12 months of weekly giving
  for (let w = 52; w >= 0; w--) {
    const sunday = addDays(sundayBefore(today), -w * 7);
    const nGivers = int(22, 34);
    const chosenGivers = new Set<string>();
    while (chosenGivers.size < nGivers) chosenGivers.add(pick(givers).id);
    for (const pid of chosenGivers) {
      const method = pick(["card", "card", "ach", "check", "cash"]);
      const base = int(25, 320);
      const amount = (method === "cash" || method === "check" ? Math.round(base / 10) * 10 : base) * 100; // dollars → cents
      const fee = method === "card" ? Math.round(amount * 0.029) + 30 : method === "ach" ? Math.round(amount * 0.008) + 25 : 0;
      const receivedOn = D(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate(), int(9, 12), int(0, 59));
      const fund = rnd() < 0.68 ? F["General Fund"] : pick([F["Building Fund"], F["Missions"], F["Food Pantry"], F["Youth Ministry"]]);
      const d = {
        orgId: org.id, personId: pid, amountCents: amount, currency: "USD", method,
        status: w === 0 ? "pending" : "posted",
        receivedOn,
        source: method === "card" || method === "ach" ? pick(["hosted_page", "recurring"]) : "admin",
        feeCents: fee, netCents: amount - fee,
        checkNumber: method === "check" ? String(int(2100, 2999)) : null,
        createdByName: method === "cash" || method === "check" ? "Tom Bergstrom" : "System",
      };
      donationRows.push({ d, fund });
    }
  }
  // insert donations in chunks, collect ids for splits
  const createdDonations: { id: string; fund: string }[] = [];
  for (let i = 0; i < donationRows.length; i += 200) {
    const chunk = donationRows.slice(i, i + 200);
    const res = await db.donation.createMany({ data: chunk.map((x) => x.d) });
    // fetch back ids for this chunk (receivedOn+person composite is not unique — fetch last N)
    const recent = await db.donation.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "desc" }, take: res.count, select: { id: true } });
    chunk.forEach((x, j) => createdDonations.push({ id: recent[recent.length - 1 - j]?.id ?? recent[0].id, fund: x.fund }));
  }
  // assign donations to batches: cash/check gifts from recent Sundays → 2 batches
  const recentSundayCash = createdDonations.filter((_, i) => ["cash", "check"].includes(donationRows[i]?.d.method)).slice(-18);
  const batchOpen = await db.batch.create({
    data: {
      orgId: org.id, campusId: campus.id, name: `Offering — ${fmtDate(lastSunday)}`, kind: "offering",
      serviceDate: lastSunday, status: "open", countedByOne: "Tom Bergstrom",
      depositAccount: "Operating — First Community Bank ••4021",
    },
  });
  const prevSunday = addDays(lastSunday, -7);
  const batchPosted = await db.batch.create({
    data: {
      orgId: org.id, campusId: campus.id, name: `Offering — ${fmtDate(prevSunday)}`, kind: "offering",
      serviceDate: prevSunday, status: "posted", countedByOne: "Tom Bergstrom", countedByTwo: "Miriam Holt",
      postedByName: "Tom Bergstrom", postedAt: addDays(prevSunday, 1), depositAccount: "Operating — First Community Bank ••4021",
      totalCents: 0,
    },
  });
  let openTotal = 0, postedTotal = 0;
  for (const [i, cd] of createdDonations.entries()) {
    const method = donationRows[i]?.d.method;
    const isCashish = method === "cash" || method === "check";
    const receivedOn = donationRows[i]?.d.receivedOn as Date;
    let batchId: string | null = null;
    if (isCashish && receivedOn.getTime() >= prevSunday.getTime() - 36e5 * 12) {
      batchId = receivedOn.getTime() >= lastSunday.getTime() - 36e5 * 12 ? batchOpen.id : batchPosted.id;
    }
    if (batchId) {
      await db.donation.update({ where: { id: cd.id }, data: { batchId } });
      if (batchId === batchOpen.id) openTotal += donationRows[i].d.amountCents; else postedTotal += donationRows[i].d.amountCents;
    }
    splitRows.push({ orgId: org.id, donationId: cd.id, fundId: cd.fund, amountCents: donationRows[i].d.amountCents });
  }
  for (let i = 0; i < splitRows.length; i += 400) await db.donationSplit.createMany({ data: splitRows.slice(i, i + 400) });
  await db.batch.update({ where: { id: batchOpen.id }, data: { totalCents: openTotal } });
  await db.batch.update({ where: { id: batchPosted.id }, data: { totalCents: postedTotal } });

  // recurring gifts
  const recurringPeople = pickN(givers, 8);
  for (const p of recurringPeople) {
    const pm = await db.paymentMethod.create({
      data: {
        orgId: org.id, personId: p.id, provider: "demo", providerMethodId: "pm_" + randomBytes(8).toString("hex"),
        type: pick(["card", "ach"]), brand: pick(["visa", "mastercard"]), last4: String(int(1000, 9999)),
        expMonth: int(1, 12), expYear: 2027 + int(0, 2), isDefault: true,
      },
    });
    await db.recurringGift.create({
      data: {
        orgId: org.id, personId: p.id, paymentMethodId: pm.id, fundId: rnd() < 0.8 ? F["General Fund"] : F["Building Fund"],
        amountCents: pick([5000, 10000, 15000, 25000, 50000]), frequency: "monthly", anchorDay: pick([1, 5, 10, 15, 20]),
        nextRunAt: addDays(new Date(), int(2, 28)), status: "active", startedOn: addMonths(new Date(), -int(3, 24)),
      },
    });
  }
  // pledges to Building campaign
  const pledgers = pickN(givers, 10);
  for (const p of pledgers) {
    await db.pledge.create({
      data: {
        orgId: org.id, personId: p.id, fundId: F["Building Fund"], campaign: "Crossing 2026",
        amountCents: pick([100000, 250000, 500000, 1200000, 2500000]), frequency: pick(["monthly", "one_time"]),
        startsOn: new Date("2026-01-01T00:00:00Z"), endsOn: new Date("2026-12-31T00:00:00Z"),
      },
    });
  }

  // ── communications ─────────────────────────────────────────────────────────
  for (const p of adults) {
    for (const channel of ["email", "sms"]) {
      if (!p.email && channel === "email") continue;
      if (!p.phone && channel === "sms") continue;
      const optedIn = p.custom?.includes("do_not_contact") ? false : rnd() < 0.86;
      await db.communicationPreference.create({
        data: {
          orgId: org.id, personId: p.id, channel,
          category: channel === "email" ? "operational" : "operational", optedIn,
          source: pick(["connection_card", "portal", "import", "verbal"]), wordingVersion: "2026-01 wording v2",
        },
      }).catch(() => {});
    }
  }
  const msgDefs = [
    {
      channel: "email", subject: "This Sunday at Grace: Advent begins 🕯️", status: "sent",
      from: "Grace Chapel <hello@gracechapel.demo>",
      body: "<p>Family, Advent begins this Sunday. Two gatherings at 9:00 and 11:00. Kids check-in opens 30 minutes early.</p><p>— Pastor David</p>",
      daysAgo: 4, templateKey: "weekly_preview",
    },
    {
      channel: "email", subject: "Food Pantry Drive — drop-off this weekend", status: "scheduled",
      from: "Grace Chapel <hello@gracechapel.demo>",
      body: "<p>Bring canned goods to the lobby. The Pantry team collects after both services.</p>",
      daysAgo: -3, templateKey: "announcement",
    },
    {
      channel: "sms", subject: null, status: "sent",
      from: "Grace Chapel",
      body: "Grace Chapel: Ice on the roads — Midweek Prayer moves online tonight 6:30pm. Link in email.",
      daysAgo: 9, templateKey: "alert",
    },
  ];
  const audience = { segment: { lifecycleStage: ["member", "attender", "leader"], consentCategory: "operational" } };
  for (const m of msgDefs) {
    const msg = await db.message.create({
      data: {
        orgId: org.id, channel: m.channel, subject: m.subject, bodyHtml: m.channel === "email" ? m.body : null,
        bodyText: m.body, fromName: m.channel === "email" ? "Grace Chapel" : null,
        fromAddress: m.channel === "email" ? "hello@gracechapel.demo" : "+15550100000",
        status: m.status, audience: JSON.stringify(audience), templateKey: m.templateKey,
        scheduledAt: m.status === "scheduled" ? addDays(new Date(), -m.daysAgo) : null,
        sentAt: m.status === "sent" ? addDays(new Date(), -m.daysAgo) : null,
        createdByName: "Renee Alvarez",
      },
    });
    // recipients: consenting people with that channel
    const prefs = await db.communicationPreference.findMany({ where: { orgId: org.id, channel: m.channel, category: "operational", optedIn: true } });
    const recips = prefs.slice(0, m.channel === "email" ? 38 : 22);
    for (const [i, pr] of recips.entries()) {
      const person = allPeople.find((p) => p.id === pr.personId);
      if (!person) continue;
      const address = m.channel === "email" ? person.email! : person.phone!;
      const st = rnd() < 0.94 ? (rnd() < 0.8 ? "delivered" : "sent") : pick(["bounced", "failed"]);
      await db.messageRecipient.create({
        data: {
          orgId: org.id, messageId: msg.id, personId: person.id, address,
          status: st, sentAt: m.status === "sent" ? addDays(new Date(), -m.daysAgo) : null,
          deliveredAt: st === "delivered" ? addDays(new Date(), -m.daysAgo) : null,
          errorCode: st === "bounced" ? "551: mailbox unavailable" : st === "failed" ? "timeout" : null,
          costCents: m.channel === "sms" ? 1 : 0,
        },
      });
    }
  }

  // ── volunteer scheduling ───────────────────────────────────────────────────
  const vroleDefs = [
    { name: "Greeter", team: "First Impressions", bg: false, minAge: 16 },
    { name: "Usher", team: "First Impressions", bg: false, minAge: 16 },
    { name: "Kids Teacher", team: "Grace Kids", bg: true, minAge: 18, clearance: "safeguarding" },
    { name: "Kids Helper", team: "Grace Kids", bg: true, minAge: 14, clearance: "safeguarding" },
    { name: "Coffee Host", team: "Hospitality", bg: false, minAge: 14 },
    { name: "Production", team: "Production", bg: false, minAge: 16 },
    { name: "Safety Team", team: "Safety", bg: true, minAge: 21, clearance: "safeguarding" },
  ];
  const VR: Record<string, string> = {};
  for (const v of vroleDefs) {
    const r = await db.volunteerRole.create({
      data: { orgId: org.id, campusId: campus.id, name: v.name, team: v.team, requiresBackgroundCheck: v.bg, minAge: v.minAge, clearanceRequired: (v as any).clearance ?? null, description: `${v.name} — ${v.team}` },
    });
    VR[v.name] = r.id;
  }
  const volunteers = pickN(adults.filter((p) => p.lifecycleStage !== "inactive"), 24);
  const nextSundays = sundayEvents.filter((e) => e.startsAt.getTime() >= Date.now()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const slotPlan: Record<string, number[]> = { "Greeter": [3, 3, 3, 3], "Usher": [2, 2, 2, 2], "Kids Teacher": [2, 2, 2, 2], "Kids Helper": [2, 2, 2, 2], "Coffee Host": [2, 2, 2, 2], "Production": [1, 1, 1, 1] };
  for (const [roleName, counts] of Object.entries(slotPlan)) {
    for (const [wi, count] of counts.entries()) {
      const ev = nextSundays[wi];
      if (!ev) continue;
      for (let k = 0; k < count; k++) {
        const person = pick(volunteers);
        const st = wi === 0 ? pick(["accepted", "accepted", "confirmed", "asked"]) : wi === 1 ? pick(["accepted", "asked", "accepted"]) : pick(["accepted", "asked"]);
        await db.assignment.create({
          data: {
            orgId: org.id, volunteerRoleId: VR[roleName], personId: person.id, eventId: ev.id,
            startsAt: ev.startsAt, status: st,
            responseToken: "tok_" + randomBytes(10).toString("hex"),
            respondedAt: st !== "asked" ? addDays(new Date(), -int(1, 9)) : null,
            respondedVia: st !== "asked" ? pick(["sms_link", "portal"]) : null,
            callTime: roleName === "Production" ? "07:30" : roleName.startsWith("Kids") ? "08:30" : "08:40",
          },
        }).catch(() => {});
      }
    }
  }
  // past assignments incl. no-shows
  const pastEvs = pastSundays.slice(-6);
  for (const [wi, ev] of pastEvs.entries()) {
    for (const roleName of ["Greeter", "Kids Teacher", "Coffee Host"]) {
      const person = pick(volunteers);
      const st = wi === pastEvs.length - 2 ? "no_show" : "served";
      await db.assignment.create({
        data: {
          orgId: org.id, volunteerRoleId: VR[roleName], personId: person.id, eventId: ev.id,
          startsAt: ev.startsAt, status: st, responseToken: "tok_" + randomBytes(10).toString("hex"),
          respondedAt: ev.startsAt, respondedVia: "sms_link",
        },
      }).catch(() => {});
    }
  }
  // blockouts
  await db.blockoutDate.create({ data: { orgId: org.id, personId: volunteers[0].id, startsOn: addDays(today, 7), endsOn: addDays(today, 14), reason: "Family trip" } });
  await db.blockoutDate.create({ data: { orgId: org.id, personId: volunteers[3].id, startsOn: addDays(today, 1), endsOn: addDays(today, 2), reason: "Work travel" } });

  // ── pastoral care ──────────────────────────────────────────────────────────
  const careDefs = [
    { person: "Miriam Holt", type: "hospital", stage: "in_progress", tier: "pastors", urgency: "high", owner: "David Whitfield", summary: "Recovering from hip surgery at Mercy General, room 412. Visited Tuesday.", dueDays: 2 },
    { person: "George Sandoval", type: "bereavement", stage: "in_progress", tier: "case_team", urgency: "normal", owner: "Sarah Okoye", summary: "Lost his brother in October. Meal train running through the month.", dueDays: 10 },
    { person: "Evan Park", type: "new_believer", stage: "new", tier: "staff", urgency: "normal", owner: "Grace Hollan", summary: "Gave his life to the Lord at the Nov 2 gathering. Wants to be baptized.", dueDays: 5 },
    { person: "Nadia Rahman", type: "follow_up", stage: "waiting", tier: "staff", urgency: "low", owner: "Renee Alvarez", summary: "Second-visit follow-up — interested in Young Families group.", dueDays: 4 },
    { person: "Rosa Marin", type: "safeguarding", stage: "in_progress", tier: "pastors", urgency: "urgent", owner: "David Whitfield", summary: "Mandatory-reporting situation — filed report with county services. Do not delete case.", dueDays: 1, safeguarding: true },
    { person: "Kurt Bauer", type: "food_assistance", stage: "closed", tier: "staff", urgency: "normal", owner: "Renee Alvarez", summary: "Pantry box delivered weekly for 6 weeks; self-sufficient again.", dueDays: null, closed: true },
  ];
  for (const c of careDefs) {
    const person = P[c.person];
    const cc = await db.careCase.create({
      data: {
        orgId: org.id, personId: person.id, type: c.type, stage: c.stage,
        ownerName: c.owner, ownerMembershipId: c.owner === "David Whitfield" ? reneeM.membershipId : null,
        urgency: c.urgency, dueDate: c.dueDays ? addDays(today, c.dueDays) : null,
        confidentialityTier: c.tier, status: c.closed ? "closed" : "open",
        closeReason: c.closed ? "Resolved — no longer needed" : null,
        summary: c.summary, openedAt: addDays(today, -int(6, 40)),
        isSafeguarding: !!c.safeguarding,
      },
    });
    await db.careNote.create({
      data: {
        orgId: org.id, careCaseId: cc.id, authorName: c.owner, kind: "note",
        body: "Initial intake conversation complete. Family is aware and supported.",
        visibility: c.tier === "pastors" ? "pastors" : c.tier === "case_team" ? "case_team" : "staff",
        occurredAt: addDays(today, -int(2, 8)),
      },
    });
    if (c.type === "hospital") {
      await db.careNote.create({
        data: { orgId: org.id, careCaseId: cc.id, authorName: "David Whitfield", kind: "visit", body: "Visited at Mercy General. She is in good spirits; prayer at bedside.", visibility: "pastors", occurredAt: addDays(today, -3) },
      });
    }
  }
  await db.prayerRequest.createMany({
    data: [
      { orgId: org.id, personId: P["Miriam Holt"].id, body: "Pray for a smooth recovery from surgery and no setbacks at physio.", audience: "church", status: "approved", expiresAt: addDays(today, 30), approvedByName: "David Whitfield" },
      { orgId: org.id, personId: P["George Sandoval"].id, body: "Pray for our family as we grieve my brother.", audience: "staff", status: "shared", expiresAt: addDays(today, 25) },
      { orgId: org.id, personId: P["Evan Park"].id, body: "Personal — please keep between staff and me.", audience: "private", status: "pending", expiresAt: addDays(today, 30) },
    ],
  });

  // ── workflows (5 templates) ────────────────────────────────────────────────
  const wfDefs = [
    {
      name: "First visit follow-up", triggerType: "first_visit", active: true,
      steps: [{ type: "task", title: "Call the guest", dueDays: 1, owner: "Renee Alvarez" }, { type: "email", subject: "We're glad you were here", body: "Thanks for visiting Grace Chapel! Pastor David would love to say hi.", delayDays: 0 }, { type: "notify", membership: "campus_admin" }],
    },
    {
      name: "Second visit nudge", triggerType: "second_visit", active: true,
      steps: [{ type: "email", subject: "Finding your place", body: "Small groups are the fastest way to feel at home. Want a suggestion?", delayDays: 1 }, { type: "task", title: "Suggest a group", dueDays: 2, owner: "Grace Hollan" }],
    },
    {
      name: "New member welcome", triggerType: "new_member", active: true,
      steps: [{ type: "tag", tag: "Member 2026" }, { type: "email", subject: "Welcome to the family", body: "Here's everything you need in your first 30 days.", delayDays: 0 }],
    },
    {
      name: "Birthday greeting", triggerType: "birthday", active: true,
      steps: [{ type: "email", subject: "Happy birthday!", body: "The Grace Chapel family celebrates you today.", delayDays: 0 }],
    },
    {
      name: "Three-week absence check", triggerType: "three_week_absence", active: true,
      steps: [{ type: "task", title: "Reach out — 3 weeks absent", dueDays: 1, owner: "Sarah Okoye" }, { type: "notify", membership: "ministry_leader" }],
    },
  ];
  const WF: Record<string, string> = {};
  for (const w of wfDefs) {
    const r = await db.workflow.create({
      data: { orgId: org.id, name: w.name, triggerType: w.triggerType, isActive: w.active, steps: JSON.stringify(w.steps), triggerConfig: JSON.stringify({ delayDays: 0 }), createdByName: "Renee Alvarez" },
    });
    WF[w.triggerType] = r.id;
  }
  // runs: recent guests
  const recentGuests = [P["Fiona Adeyemi"], P["Miles Osei"], P["Nadia Rahman"], P["Evan Park"]];
  for (const [i, g] of recentGuests.entries()) {
    await db.workflowRun.create({
      data: {
        orgId: org.id, workflowId: WF["first_visit"], subjectId: g.id, subjectName: g.name,
        status: "completed", firedReason: "fired:first_visit",
        startedAt: addDays(today, -int(3, 12)), finishedAt: addDays(today, -int(1, 3)),
        idempotencyKey: `first_visit:${g.id}:run${i}`,
      },
    });
  }
  await db.workflowRun.create({
    data: {
      orgId: org.id, workflowId: WF["birthday"], subjectId: P["Joyce Mensah"].id, subjectName: "Joyce Mensah",
      status: "suppressed", firedReason: "suppressed:do_not_contact", detail: "Person has do_not_contact flag",
      startedAt: addDays(today, -2), finishedAt: addDays(today, -2), idempotencyKey: `birthday:${P["Joyce Mensah"].id}:x`,
    },
  });
  await db.workflowRun.create({
    data: {
      orgId: org.id, workflowId: WF["first_visit"], subjectId: deceased, subjectName: "Walter Grimes",
      status: "suppressed", firedReason: "suppressed:deceased", detail: "Automation stopped — deceased flag",
      startedAt: addDays(today, -5), finishedAt: addDays(today, -5), idempotencyKey: `first_visit:${deceased}:x`,
    },
  });

  // ── audit log seed ─────────────────────────────────────────────────────────
  const auditRows = [
    { action: "person.create", entityType: "person", label: "Renee Alvarez", entityName: "Nadia Rahman" },
    { action: "person.stage_change", entityType: "person", label: "Renee Alvarez", entityName: "Evan Park" },
    { action: "batch.post", entityType: "batch", label: "Tom Bergstrom", entityName: `Offering — ${fmtDate(prevSunday)}` },
    { action: "gift.create", entityType: "donation", label: "Tom Bergstrom", entityName: "Cash batch entry" },
    { action: "care.case.open", entityType: "care_case", label: "David Whitfield", entityName: "Miriam Holt" },
    { action: "care.note.read", entityType: "care_note", label: "Sarah Okoye", entityName: "Bereavement case" },
    { action: "role.assign", entityType: "role_assignment", label: "David Whitfield", entityName: "Grace Hollan → Ministry Leader" },
    { action: "message.send", entityType: "message", label: "Renee Alvarez", entityName: "This Sunday at Grace: Advent begins" },
    { action: "export.people", entityType: "people", label: "Renee Alvarez", entityName: "CSV export, 64 rows" },
    { action: "settings.update", entityType: "organization", label: "David Whitfield", entityName: "Monthly budget set" },
  ];
  for (const [i, a] of auditRows.entries()) {
    await db.auditLog.create({
      data: {
        orgId: org.id, actorType: "user", actorLabel: a.label, action: a.action,
        entityType: a.entityType, entityId: campus.id, after: JSON.stringify({ name: a.entityName }),
        ip: "192.168.1." + int(2, 250), userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        createdAt: addDays(new Date(), -i - 1),
      },
    });
  }
  await db.auditLog.create({ data: { orgId: org.id, actorType: "system", actorLabel: "Scheduler", action: "workflow.run", entityType: "workflow_run", entityId: campus.id, after: JSON.stringify({ fired: 4, suppressed: 2 }), createdAt: addDays(new Date(), -1) } });

  // an import job example (staged, with errors report)
  await db.importJob.create({
    data: {
      orgId: org.id, kind: "people", source: "csv", fileName: "connection-cards-oct.csv",
      rawContent: "first_name,last_name,email,phone\nNadia,Rahman,nadia.r@demo.mail,+15550100116\nMiles,Osei,miles.o@demo.mail,+15550100115\nBad,Row,broken,\n",
      mapping: JSON.stringify({ first_name: "firstName", last_name: "lastName", email: "email", phone: "phone" }),
      status: "committed", importBatchId: "imp-oct-01",
      stats: JSON.stringify({ rows: 3, created: 2, duplicates: 0, errors: [{ row: 3, reason: "email or phone required" }] }),
      createdByName: "Renee Alvarez", committedAt: addDays(today, -6),
    },
  });

  // ── chat (real-time messaging demo) ────────────────────────────────────────
  {
    const t0 = Date.now();
    const mins = (n: number) => new Date(t0 - n * 60000);
    const mkMsg = (conversationId: string, senderPersonId: string, senderName: string, body: string, at: Date) =>
      db.chatMessage.create({
        data: { orgId: org.id, conversationId, senderPersonId, senderName, body, kind: "text", createdAt: at },
      });
    const addPart = (conversationId: string, nm: string, lastReadMinsAgo = 9999) =>
      db.chatParticipant.create({
        data: { orgId: org.id, conversationId, personId: P[nm].id, label: nm, lastReadAt: mins(lastReadMinsAgo) },
      });

    // church-wide room (access-based: owner / campus admins / ministry leaders)
    const cw = await db.chatConversation.create({
      data: { orgId: org.id, type: "churchwide", title: `${org.name} — Church-wide`, createdAt: mins(600), updatedAt: mins(18) },
    });
    for (const nm of ["David Whitfield", "Renee Alvarez", "Grace Hollan", "Sarah Okoye"]) {
      await addPart(cw.id, nm, nm === "David Whitfield" ? 10 : 30);
    }
    await mkMsg(cw.id, P["Renee Alvarez"].id, "Renee Alvarez", "Good morning church! This Sunday we continue the Crossing series — services at 9:00 & 11:00.", mins(180));
    await mkMsg(cw.id, P["Grace Hollan"].id, "Grace Hollan", "Young Families potluck after second service — bring a dish if you can!", mins(140));
    await mkMsg(cw.id, P["David Whitfield"].id, "David Whitfield", "Amen! Parking team, please arrive 30 minutes early — we expect a full house.", mins(18));

    // a group chat bound to a real group (Young Families)
    const yf = await db.chatConversation.create({
      data: { orgId: org.id, type: "group", groupId: G["young-families"].id, title: "Young Families", createdAt: mins(500), updatedAt: mins(26) },
    });
    const yfMembers = await db.groupMember.findMany({
      where: { groupId: G["young-families"].id, status: "active" },
      include: { person: { select: { firstName: true, lastName: true } } },
    });
    for (const m of yfMembers) {
      await db.chatParticipant.create({
        data: {
          orgId: org.id, conversationId: yf.id, personId: m.personId,
          label: `${m.person.firstName} ${m.person.lastName}`.trim(),
          lastReadAt: mins(m.person.firstName === "Grace" ? 5 : 60),
        },
      });
    }
    await mkMsg(yf.id, P["Grace Hollan"].id, "Grace Hollan", "Reminder: we're at the Hollan home Wednesday 6:30 — chapter 4 this week!", mins(95));
    await mkMsg(yf.id, P["Aisha Bennett"].id, "Aisha Bennett", "We'll be there! Can I bring dessert?", mins(60));
    await mkMsg(yf.id, P["Grace Hollan"].id, "Grace Hollan", "Perfect — see you both Wednesday 🙌", mins(26));

    // direct chats
    const d1 = await db.chatConversation.create({
      data: {
        orgId: org.id, type: "direct",
        directKey: `direct:${[P["David Whitfield"].id, P["Aisha Bennett"].id].sort().join(":")}`,
        createdAt: mins(300), updatedAt: mins(42),
      },
    });
    await addPart(d1.id, "David Whitfield", 42);
    await addPart(d1.id, "Aisha Bennett", 42);
    await mkMsg(d1.id, P["Aisha Bennett"].id, "Aisha Bennett", "Pastor David, is the nursery schedule out for next month yet?", mins(55));
    await mkMsg(d1.id, P["David Whitfield"].id, "David Whitfield", "Almost — Renee is finalizing it today. I'll send it over tonight.", mins(42));

    const d2 = await db.chatConversation.create({
      data: {
        orgId: org.id, type: "direct",
        directKey: `direct:${[P["David Whitfield"].id, P["Renee Alvarez"].id].sort().join(":")}`,
        createdAt: mins(400), updatedAt: mins(9),
      },
    });
    await addPart(d2.id, "David Whitfield", 9);
    await addPart(d2.id, "Renee Alvarez", 120);
    await mkMsg(d2.id, P["Renee Alvarez"].id, "Renee Alvarez", "48 people checked in last Sunday — best number this quarter!", mins(30));
    await mkMsg(d2.id, P["David Whitfield"].id, "David Whitfield", "That's fantastic. Let's celebrate with the volunteers on Sunday.", mins(9));
  }

  // ── partner console (SaaS vendor layer) ────────────────────────────────────
  const partner = await db.partnerUser.create({
    data: {
      email: "partner@gracechms.demo",
      name: "Grace ChMS Partner",
      passwordHash: hashPassword("partner2026"),
    },
  });
  await db.license.create({
    data: {
      orgId: org.id,
      key: "GCHMS-DEMO-2026-GRAC",
      plan: "growth",
      seats: 250,
      status: "active",
      issuedAt: addDays(new Date(), -60),
      expiresAt: addDays(new Date(), 120),
      notes: "Founding church — founding-partner annual license",
    },
  });

  console.log("Seed complete.");
  console.log(`  org=${org.name} campus=${campus.name}`);
  console.log(`  people=${await db.person.count()} households=${await db.household.count()} groups=${await db.group.count()}`);
  console.log(`  events=${await db.event.count()} attendance=${await db.attendanceRecord.count()}`);
  console.log(`  donations=${await db.donation.count()} batches=2 careCases=${await db.careCase.count()}`);
  console.log("  login: david@gracechapel.demo / grace2026 (owner), renee@ (admin), tom@ (finance), grace@ (leader), marcus@ (volunteer), aisha@ (member)");
  console.log(`  partner console: ${partner.email} / partner2026`);

  function pickN<T,>(arr: T[], n: number): T[] {
    const copy = [...arr]; const out: T[] = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
    return out;
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
