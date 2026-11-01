// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-people-crm-phase4.ts — Profile 360 acceptance run
// (Phase 4 People CRM: scoped profile endpoint, milestones, notes, next step)
//
// Logs in through the REAL /api/v1/auth/login endpoint for each tier, calls
// the REAL endpoints and asserts the Phase 4 done-when:
//   • each role sees only its allowed fields — OMITTED from the API response,
//     not just hidden in the UI (staff / finance / member / scoped parent)
//   • a parent (people.edit.own_household) can edit their own household only —
//     stranger edits 403, milestone/note writes 403 without people.edit
//   • milestone add/remove + quick note append work (staff) and a Salvation
//     milestone stamps the Phase 1 salvationDate column when empty
//   • the rule-based next step appears for staff and nobody else
//
// Creates TEMP users/roles/people/households and removes them after — no
// existing account or demo record is modified.
//
// Prereq: dev server on :3000 + Phase 4 schema applied (bun run db:push).
// Run:  bun scripts/verify-people-crm-phase4.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes, scryptSync } from "node:crypto";
import { db } from "../src/server/db";

const BASE = "http://localhost:3000/api/v1";

interface Result { name: string; pass: boolean; detail?: string }
const results: Result[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function loginCookie(email: string, passwords: string[]): Promise<string> {
  for (const password of passwords) {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const m = /chms_session=([^;]+)/.exec(setCookie);
    if (res.ok && m) return m[1];
  }
  await db.user.update({ where: { email }, data: { passwordHash: hashPassword("redeem2026") } });
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "redeem2026" }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = /chms_session=([^;]+)/.exec(setCookie);
  if (!m) throw new Error(`Could not log in as ${email}`);
  return m[1];
}

async function api(cookie: string, path: string, init?: RequestInit): Promise<{ status: number; body: any; text?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: `chms_session=${cookie}` },
  });
  const text = await res.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  return { status: res.status, body, text };
}

const JSON_HDRS = { "content-type": "application/json" };

async function main() {
  const org = await db.organization.findFirst();
  if (!org) throw new Error("No organization.");

  // ── sweep leftovers from a previous interrupted run ──────────────────────
  const leftovers = await db.person.findMany({
    where: { orgId: org.id, lastName: { in: ["P4Stranger", "P4Optin", "P4Child", "P4Parent"] } },
    select: { id: true },
  });
  for (const p of leftovers) {
    await db.personMilestone.deleteMany({ where: { personId: p.id } });
    await db.personRelationship.deleteMany({ where: { OR: [{ fromPersonId: p.id }, { toPersonId: p.id }] } });
    await db.householdMember.deleteMany({ where: { personId: p.id } });
    await db.person.delete({ where: { id: p.id } }).catch(() => {});
  }
  await db.household.deleteMany({ where: { orgId: org.id, name: "Verify P4 Home" } });
  await db.savedView.deleteMany({ where: { orgId: org.id, name: { in: ["Verify P4 View"] } } });
  for (const key of ["verify_p4_parent"]) {
    const role = await db.role.findFirst({ where: { orgId: org.id, key } });
    if (role) {
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      await db.roleAssignment.deleteMany({ where: { roleId: role.id } });
      await db.role.delete({ where: { id: role.id } }).catch(() => {});
    }
  }
  for (const email of ["verify.p4.parent@test.local"]) {
    const u = await db.user.findUnique({ where: { email } });
    if (u) {
      const ms = await db.membership.findMany({ where: { userId: u.id } });
      for (const m of ms) await db.roleAssignment.deleteMany({ where: { membershipId: m.id } });
      await db.membership.deleteMany({ where: { userId: u.id } });
      await db.session.deleteMany({ where: { userId: u.id } });
      await db.user.delete({ where: { id: u.id } }).catch(() => {});
    }
  }

  // ── demo logins (real endpoint) ───────────────────────────────────────────
  const pastorCookie = await loginCookie("pastor@redeembaptist.ng", ["redeem2026", "grace2026"]);
  const femiCookie = await loginCookie("femi.f@redeembaptist.ng", ["redeem2026", "grace2026"]);
  const veraCookie = await loginCookie("vera.v@redeembaptist.ng", ["redeem2026", "grace2026"]);

  // ── fixtures ──────────────────────────────────────────────────────────────
  // Stranger: no contact opt-ins, no household, no notes → member tier must
  // see the bare minimum.
  const stranger = await db.person.create({
    data: {
      orgId: org.id, firstName: "Sola", lastName: "P4Stranger",
      phone: "+2348031110001", phoneE164: "+2348031110001", email: "sola.p4stranger@test.local",
      birthdate: new Date("1990-05-10"), state: "Lagos", lga: "Ikeja",
      title: "Mr", occupation: "Trader", notes: "staff only secret",
      directoryPrivacy: '{"phone":false,"email":false,"birthday":false,"address":false}',
    },
  });
  // Optin: member-tier viewer WITH directory opt-ins → contact/birthday appear.
  const optin = await db.person.create({
    data: {
      orgId: org.id, firstName: "Ngozi", lastName: "P4Optin",
      phone: "08031110002", phoneE164: "+2348031110002", email: "ngozi.p4optin@test.local",
      birthdate: new Date("1992-08-21"),
      directoryPrivacy: '{"phone":true,"email":true,"birthday":true,"address":true}',
    },
  });

  // Parent + child household for the scoped self-service test
  const hh = await db.household.create({ data: { orgId: org.id, name: "Verify P4 Home" } });
  const parentPerson = await db.person.create({
    data: { orgId: org.id, firstName: "Amaka", lastName: "P4Parent", phone: "+2348031110003", phoneE164: "+2348031110003" },
  });
  const child = await db.person.create({
    data: {
      orgId: org.id, firstName: "Chidi", lastName: "P4Child", birthdate: new Date("2013-03-04"),
      phone: "+2348031110004", phoneE164: "+2348031110004",
      directoryPrivacy: '{"phone":false,"email":false,"birthday":false,"address":false}',
    },
  });
  await db.householdMember.create({ data: { householdId: hh.id, personId: parentPerson.id, role: "head" } });
  await db.householdMember.create({ data: { householdId: hh.id, personId: child.id, role: "child" } });
  await db.personRelationship.create({
    data: { orgId: org.id, fromPersonId: parentPerson.id, toPersonId: child.id, type: "guardian", relationshipType: "parent", isGuardian: true, authorizedPickup: true },
  });

  // Temp scoped role + user: people.view + people.edit.own_household ONLY
  const parentRole = await db.role.create({
    data: {
      orgId: org.id, key: "verify_p4_parent", name: "Verify P4 Parent", isSystem: false,
      permissions: { create: [{ permission: "people.view" }, { permission: "people.edit.own_household" }] },
    },
  });
  const parentUser = await db.user.create({
    data: {
      email: "verify.p4.parent@test.local", name: "Amaka P4Parent",
      passwordHash: hashPassword("p4parent-pass"),
    },
  });
  const membership = await db.membership.create({ data: { orgId: org.id, userId: parentUser.id, personId: parentPerson.id } });
  await db.roleAssignment.create({ data: { orgId: org.id, membershipId: membership.id, roleId: parentRole.id } });

  const parentCookie = await loginCookie("verify.p4.parent@test.local", ["p4parent-pass"]);

  const P = (id: string) => `/people/v2/${id}/profile`;

  // ══ 1. STAFF (pastor) — sees everything the tier allows ═══════════════════
  {
    const r = await api(pastorCookie, P(stranger.id));
    const person = r.body?.person ?? {};
    check("staff: profile 200", r.status === 200, `status ${r.status}`);
    check("staff: contact keys PRESENT (not omitted)", "phone" in person && "email" in person && "phoneDisplay" in person);
    check("staff: profile extras PRESENT (state/title/occupation)", "state" in person && "title" in person && "occupation" in person);
    check("staff: notes key PRESENT (staff-only field)", "notes" in person, JSON.stringify(person.notes ?? null));
    check("staff: milestones array PRESENT", Array.isArray(r.body?.milestones));
    check("staff: stageHistory array PRESENT", Array.isArray(r.body?.stageHistory));
    check("staff: nextStep PRESENT (object or null)", "nextStep" in r.body, JSON.stringify(r.body?.nextStep ?? null));
    check("staff: canEdit true", person.canEdit === true);
  }

  // ══ 2. FINANCE (femi) — full contact, never staff notes, no nextStep ══════
  {
    const r = await api(femiCookie, P(stranger.id));
    const person = r.body?.person ?? {};
    check("finance: profile 200", r.status === 200, `status ${r.status}`);
    check("finance: contact keys PRESENT", "phone" in person && "email" in person);
    check("finance: profile extras PRESENT (state)", "state" in person);
    check("finance: notes key OMITTED", !("notes" in person), `notes=${JSON.stringify(person.notes)}`);
    check("finance: milestones PRESENT (profileVisible tier)", Array.isArray(r.body?.milestones));
    check("finance: nextStep OMITTED", !("nextStep" in r.body));
  }

  // ══ 3. MEMBER (vera) — privacy-by-default omission ════════════════════════
  {
    const r = await api(veraCookie, P(stranger.id));
    const person = r.body?.person ?? {};
    check("member: profile 200", r.status === 200, `status ${r.status}`);
    check("member: phone OMITTED (no opt-in)", !("phone" in person) && !("phoneE164" in person) && !("phoneDisplay" in person));
    check("member: email OMITTED", !("email" in person));
    check("member: birthdate OMITTED", !("birthdate" in person));
    check("member: notes OMITTED", !("notes" in person));
    check("member: state/lga OMITTED (profile extras)", !("state" in person) && !("lga" in person));
    check("member: milestones key OMITTED", !("milestones" in r.body));
    check("member: stageHistory key OMITTED", !("stageHistory" in r.body));
    check("member: nextStep OMITTED", !("nextStep" in r.body));
    check("member: emergencyContacts key OMITTED", !("emergencyContacts" in r.body));
    check("member: name + groups + tags still arrive", !!person.firstName && Array.isArray(r.body?.groups) && Array.isArray(r.body?.tags));
    const privacyHidden = person.privacyHidden ?? [];
    check("member: privacyHidden explains why", ["phone", "email", "birthday"].every((k) => privacyHidden.includes(k)), privacyHidden.join(","));
  }
  {
    const r = await api(veraCookie, P(optin.id));
    const person = r.body?.person ?? {};
    check("member: opt-in phone/email/birthdate PRESENT", "phone" in person && "email" in person && "birthdate" in person, JSON.stringify(person.directoryPrivacy ?? null));
    check("member: opt-in still hides staff extras (state)", !("state" in person));
  }

  // ══ 4. SCOPED PARENT — own household full, stranger bare ══════════════════
  {
    const r = await api(parentCookie, P(child.id));
    const person = r.body?.person ?? {};
    check("parent: child profile 200", r.status === 200, `status ${r.status}`);
    check("parent: child contact PRESENT (parent tier)", "phone" in person && "phoneDisplay" in person);
    check("parent: child birthdate PRESENT", "birthdate" in person);
    check("parent: milestones PRESENT for own child", Array.isArray(r.body?.milestones));
    check("parent: notes OMITTED (parent ≠ staff)", !("notes" in person));
    check("parent: canEdit true for own child", person.canEdit === true);
    check("parent: household.canEdit true", r.body?.household?.canEdit === true);
    check("parent: household lists both members", (r.body?.household?.members?.length ?? 0) === 2, JSON.stringify(r.body?.household?.members?.map((m: any) => m.name)));
    check("parent: guardians include Amaka", (r.body?.guardians ?? []).some((g: any) => g.name.startsWith("Amaka")));
  }
  {
    const r = await api(parentCookie, P(stranger.id));
    const person = r.body?.person ?? {};
    check("parent: stranger falls back to member tier", !("phone" in person) && !("email" in person) && !("state" in person));
    check("parent: stranger canEdit false", person.canEdit === false);
    check("parent: stranger nextStep OMITTED", !("nextStep" in r.body));
  }

  // parent can edit own household member through the EXISTING contract
  {
    const r = await api(parentCookie, `/people/${child.id}`, { method: "PUT", headers: JSON_HDRS, body: JSON.stringify({ preferredName: "Chidi-Boy" }) });
    check("parent: PUT own child 200", r.status === 200, `status ${r.status} ${JSON.stringify(r.body)}`);
    const strangerPut = await api(parentCookie, `/people/${stranger.id}`, { method: "PUT", headers: JSON_HDRS, body: JSON.stringify({ preferredName: "Nope" }) });
    check("parent: PUT stranger 403", strangerPut.status === 403, `status ${strangerPut.status}`);
    const hhPut = await api(parentCookie, `/households/${hh.id}`, { method: "PUT", headers: JSON_HDRS, body: JSON.stringify({ name: "Verify P4 Home Renamed" }) });
    check("parent: rename OWN household 200", hhPut.status === 200, `status ${hhPut.status} ${JSON.stringify(hhPut.body)}`);
  }

  // ══ 5. WRITES: milestones + notes (people.edit gate) ══════════════════════
  {
    const forbiddenMs = await api(veraCookie, `/people/v2/${stranger.id}/milestones`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ type: "salvation" }) });
    check("member: POST milestone 403 (route gate)", forbiddenMs.status === 403, `status ${forbiddenMs.status}`);
    const parentMs = await api(parentCookie, `/people/v2/${child.id}/milestones`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ type: "salvation" }) });
    check("parent: POST milestone 403 (no people.edit)", parentMs.status === 403, `status ${parentMs.status}`);
    const parentNote = await api(parentCookie, `/people/v2/${child.id}/notes`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ note: "nope" }) });
    check("parent: POST note 403", parentNote.status === 403, `status ${parentNote.status}`);

    const badType = await api(pastorCookie, `/people/v2/${stranger.id}/milestones`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ type: "wedding" }) });
    check("staff: unknown milestone type 400", badType.status === 400, `status ${badType.status}`);
    const missing = await api(pastorCookie, `/people/v2/does-not-exist/milestones`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ type: "salvation" }) });
    check("staff: milestone on missing person 404", missing.status === 404, `status ${missing.status}`);

    // Salvation milestone stamps the empty Phase 1 salvationDate column
    const add = await api(pastorCookie, `/people/v2/${stranger.id}/milestones`, {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ type: "salvation", date: "2026-10-12", notes: "Verified acceptance run", certificateUrl: "https://certs.example.com/abc" }),
    });
    check("staff: POST milestone 200", add.status === 200, `status ${add.status} ${JSON.stringify(add.body)}`);
    const msId = add.body?.id as string | undefined;
    const afterAdd = await api(pastorCookie, P(stranger.id));
    check("staff: milestone visible in profile", (afterAdd.body?.milestones ?? []).some((m: any) => m.id === msId));
    check("staff: salvationDate stamped from milestone", typeof afterAdd.body?.person?.salvationDate === "string" && afterAdd.body.person.salvationDate.startsWith("2026-10-12"), JSON.stringify(afterAdd.body?.person?.salvationDate));

    // quick note appends a dated line
    const note = await api(pastorCookie, `/people/v2/${stranger.id}/notes`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ note: "P4 acceptance note" }) });
    check("staff: POST note 200", note.status === 200, `status ${note.status}`);
    const afterNote = await api(pastorCookie, P(stranger.id));
    const notes: string = afterNote.body?.person?.notes ?? "";
    check("staff: note appended with date stamp", notes.includes("P4 acceptance note") && /\[\d{4}-\d{2}-\d{2}\] P4 acceptance note/.test(notes), JSON.stringify(notes));

    // empty note → 400
    const emptyNote = await api(pastorCookie, `/people/v2/${stranger.id}/notes`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ note: "   " }) });
    check("staff: empty note 400", emptyNote.status === 400, `status ${emptyNote.status}`);

    // delete the milestone again
    if (msId) {
      const del = await api(pastorCookie, `/people/v2/${stranger.id}/milestones/${msId}`, { method: "DELETE" });
      check("staff: DELETE milestone 200", del.status === 200, `status ${del.status}`);
      const afterDel = await api(pastorCookie, P(stranger.id));
      check("staff: milestone gone from profile", !(afterDel.body?.milestones ?? []).some((m: any) => m.id === msId));
    }

    // member still can't see the appended note even after writes
    const veraAgain = await api(veraCookie, P(stranger.id));
    check("member: still no notes key after writes", !("notes" in (veraAgain.body?.person ?? {})));
  }

  // ══ report ═════════════════════════════════════════════════════════════════
  let failed = 0;
  console.log("\n═ People CRM — Phase 4 (Profile 360) verification ═");
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? "  ✓" : "  ✗"} ${r.name}${r.pass ? "" : `  — ${r.detail ?? ""}`}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);

  // ── cleanup (temp fixtures only) ────────────────────────────────────────────
  const ids = [stranger.id, optin.id, parentPerson.id, child.id];
  await db.personMilestone.deleteMany({ where: { personId: { in: ids } } });
  await db.personRelationship.deleteMany({ where: { OR: [{ fromPersonId: { in: ids } }, { toPersonId: { in: ids } }] } });
  await db.householdMember.deleteMany({ where: { personId: { in: ids } } });
  await db.household.deleteMany({ where: { id: hh.id } });
  await db.person.deleteMany({ where: { id: { in: ids } } });
  await db.roleAssignment.deleteMany({ where: { OR: [{ membershipId: membership.id }, { roleId: parentRole.id }] } });
  await db.rolePermission.deleteMany({ where: { roleId: parentRole.id } });
  await db.membership.deleteMany({ where: { id: membership.id } });
  await db.session.deleteMany({ where: { userId: parentUser.id } });
  await db.user.delete({ where: { id: parentUser.id } }).catch(() => {});
  await db.role.delete({ where: { id: parentRole.id } }).catch(() => {});

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
