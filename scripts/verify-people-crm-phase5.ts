// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-people-crm-phase5.ts — Phase 5 acceptance run
// (Attendance · Giving · Notes & Care · Communication · Activity tabs)
//
// Logs in through the REAL /api/v1/auth/login endpoint per role tier, calls
// the REAL endpoints and asserts the Phase 5 done-when:
//   • a MEMBER sees only Overview/Family/Journey on others — attendance,
//     giving, notes, comms flags false and those endpoints 403 — but on
//     their OWN profile attendance + own giving (giving.view.own) appear
//   • a LEADER (group leader without people.edit) sees no engagement tabs
//     on the people they lead
//   • a PASTOR with pastorCanViewIndividualGiving OFF: no giving tab, gifts
//     absent from the activity feed and GET /donations?personId= never
//     returns the target's gifts — flipping the setting ON reveals exactly
//     the giving tab and nothing else
//   • FINANCE sees giving but NOT attendance/notes/comms
//   • CONFIDENTIAL notes are OMITTED from every response for viewers without
//     people.notes.confidential (list + activity + author-or-admin writes)
//   • notes CRUD author-or-admin rules; legacy { note } contract intact
//   • attendance buckets/streak computed server-side; per-source activity
//     permission filter; no new events table involved
//
// Creates TEMP users/roles/people/group/events/notes and removes them after —
// no existing account or demo record is modified (the org giving setting is
// flipped and RESTORED).
//
// Prereq: dev server on :3000 + Phase 5 schema applied (bun run db:push).
// Run:  bun scripts/verify-people-crm-phase5.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes, scryptSync } from "node:crypto";
import { db } from "../src/server/db";
import { ROLE_TEMPLATES } from "../src/server/permissions";

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

async function loginCookie(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = /chms_session=([^;]+)/.exec(setCookie);
  if (!res.ok || !m) throw new Error(`Could not log in as ${email} (${res.status})`);
  return m[1];
}

async function api(cookie: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: `chms_session=${cookie}` },
  });
  const text = await res.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  return { status: res.status, body };
}

const JSON_HDRS = { "content-type": "application/json" };

// ── fixture bookkeeping (for the sweep) ─────────────────────────────────────
const RUN = randomBytes(3).toString("hex"); // unique per run → unique event names
const sweep = {
  roleIds: [] as string[],
  userIds: [] as string[],
  personIds: [] as string[],
  householdIds: [] as string[],
  groupIds: [] as string[],
  eventIds: [] as string[],
  noteIds: [] as string[],
  donationIds: [] as string[],
  messageIds: [] as string[],
  waContactIds: [] as string[],
  waMessageIds: [] as string[],
};

async function main() {
  const org = await db.organization.findFirst();
  if (!org) throw new Error("No organization.");

  const settingKey = "pastorCanViewIndividualGiving";
  const originalSettings = org.settings ?? "{}";
  const readSetting = (): boolean => {
    try { return (JSON.parse(originalSettings) as any)?.[settingKey] === true; } catch { return false; }
  };
  const writeSetting = async (on: boolean) => {
    const parsed = JSON.parse(originalSettings) as Record<string, unknown>;
    parsed[settingKey] = on;
    await db.organization.update({ where: { id: org.id }, data: { settings: JSON.stringify(parsed) } });
  };

  // ── sweep leftovers from a previous interrupted run ──────────────────────
  for (const key of ["verify_p5_member", "verify_p5_leader", "verify_p5_pastor", "verify_p5_minister"]) {
    const role = await db.role.findFirst({ where: { orgId: org.id, key } });
    if (role) {
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      await db.roleAssignment.deleteMany({ where: { roleId: role.id } });
      await db.role.delete({ where: { id: role.id } }).catch(() => {});
    }
  }
  for (const email of [
    "verify.p5.member@test.local", "verify.p5.leader@test.local",
    "verify.p5.pastor@test.local", "verify.p5.minister@test.local",
  ]) {
    const u = await db.user.findUnique({ where: { email } });
    if (u) {
      const ms = await db.membership.findMany({ where: { userId: u.id } });
      for (const m of ms) await db.roleAssignment.deleteMany({ where: { membershipId: m.id } });
      await db.membership.deleteMany({ where: { userId: u.id } });
      await db.session.deleteMany({ where: { userId: u.id } });
      await db.user.delete({ where: { id: u.id } }).catch(() => {});
    }
  }
  for (const last of ["P5Target", "P5Stranger", "P5Member", "P5Leader"]) {
    const ppl = await db.person.findMany({ where: { orgId: org.id, lastName: last }, select: { id: true } });
    for (const p of ppl) {
      await db.personNote.deleteMany({ where: { personId: p.id } });
      await db.personMilestone.deleteMany({ where: { personId: p.id } });
      await db.stageHistory.deleteMany({ where: { personId: p.id } });
      await db.attendanceRecord.deleteMany({ where: { personId: p.id } });
      await db.donation.deleteMany({ where: { personId: p.id, memo: "P5 verify" } });
      await db.groupMember.deleteMany({ where: { personId: p.id } });
      await db.personRelationship.deleteMany({ where: { OR: [{ fromPersonId: p.id }, { toPersonId: p.id }] } });
      await db.householdMember.deleteMany({ where: { personId: p.id } });
      await db.person.delete({ where: { id: p.id } }).catch(() => {});
    }
  }
  await db.group.deleteMany({ where: { orgId: org.id, name: "P5 Verify Group" } });
  // leftover events from any earlier interrupted run (attendance rows first)
  await db.attendanceRecord.deleteMany({
    where: { orgId: org.id, event: { name: { startsWith: "P5 Verify Service" } } },
  });
  await db.event.deleteMany({ where: { orgId: org.id, name: { startsWith: "P5 Verify Service" } } });
  const oldWa = await db.whatsAppContact.findMany({ where: { orgId: org.id, phoneNumber: "+2348031150001" } });
  for (const c of oldWa) {
    await db.whatsAppMessage.deleteMany({ where: { contactId: c.id } });
    await db.whatsAppContact.delete({ where: { id: c.id } }).catch(() => {});
  }
  await db.messageRecipient.deleteMany({
    where: { orgId: org.id, message: { subject: "P5 verify broadcast" } },
  });
  await db.message.deleteMany({ where: { orgId: org.id, subject: "P5 verify broadcast" } });
  await writeSetting(readSetting()); // no-op; keeps originalSettings authoritative
  if (readSetting()) {
    // restore if a previous run crashed with the setting ON
    const parsed = JSON.parse(originalSettings) as Record<string, unknown>;
    delete parsed[settingKey];
    await db.organization.update({ where: { id: org.id }, data: { settings: JSON.stringify(parsed) } });
  }

  // ── fixtures ──────────────────────────────────────────────────────────────
  const campus = await db.campus.findFirst({ where: { orgId: org.id } });

  const target = await db.person.create({
    data: {
      orgId: org.id, firstName: "Chinelo", lastName: "P5Target",
      phone: "+2348031150001", phoneE164: "+2348031150001", email: "chinelo.p5target@test.local",
      birthdate: new Date("1994-04-14"),
      directoryPrivacy: '{"phone":true,"email":true,"birthday":true,"address":true}',
    },
  });
  const stranger = await db.person.create({
    data: {
      orgId: org.id, firstName: "Obi", lastName: "P5Stranger",
      phone: "+2348031150002", phoneE164: "+2348031150002",
      directoryPrivacy: '{"phone":false,"email":false,"birthday":false,"address":false}',
    },
  });
  const memberPerson = await db.person.create({
    data: {
      orgId: org.id, firstName: "Nkechi", lastName: "P5Member",
      phone: "+2348031150003", phoneE164: "+2348031150003",
      directoryPrivacy: '{"phone":true,"email":true,"birthday":true,"address":true}',
    },
  });
  const leaderPerson = await db.person.create({
    data: {
      orgId: org.id, firstName: "Emeka", lastName: "P5Leader",
      phone: "+2348031150004", phoneE164: "+2348031150004",
      directoryPrivacy: '{"phone":true,"email":true,"birthday":true,"address":true}',
    },
  });
  sweep.personIds.push(target.id, stranger.id, memberPerson.id, leaderPerson.id);

  // group led by the temp leader, containing the target
  const group = await db.group.create({
    data: { orgId: org.id, campusId: campus?.id ?? null, name: "P5 Verify Group", type: "small_group", leaderPersonId: leaderPerson.id },
  });
  sweep.groupIds.push(group.id);
  await db.groupMember.create({ data: { orgId: org.id, groupId: group.id, personId: target.id, role: "member", status: "active", joinedAt: new Date() } });
  await db.groupMember.create({ data: { orgId: org.id, groupId: group.id, personId: leaderPerson.id, role: "leader", status: "active", joinedAt: new Date() } });

  // attendance: 2 this month, 1 last month, 1 three months ago (streak = 2),
  // plus one absent row that must never count
  const now = new Date();
  const monthStart = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 7, 9, 0));
  const attendanceSpecs: Array<{ offset: number; status: string }> = [
    { offset: 0, status: "present" }, { offset: 0, status: "late" },
    { offset: 1, status: "present" }, { offset: 3, status: "present" },
    { offset: 0, status: "absent" },
  ];
  let idx = 0;
  for (const spec of attendanceSpecs) {
    const startsAt = monthStart(spec.offset);
    startsAt.setUTCMinutes(10 * idx++);
    const ev = await db.event.create({
      data: { orgId: org.id, campusId: campus?.id ?? "", name: `P5 Verify Service ${RUN} ${startsAt.toISOString().slice(0, 10)}`, kind: "service", startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) },
    });
    sweep.eventIds.push(ev.id);
    await db.attendanceRecord.create({
      data: { orgId: org.id, personId: target.id, eventId: ev.id, status: spec.status, method: "roster", checkedInAt: spec.status === "absent" ? null : new Date(startsAt.getTime() + 600_000) },
    });
  }

  // stage history + milestone for the activity feed
  await db.stageHistory.create({
    data: { orgId: org.id, personId: target.id, stage: "member", previousStage: "attender", changedAt: new Date(Date.now() - 5 * 86_400_000), changedByName: "P5 Verify" },
  });
  await db.personMilestone.create({
    data: { orgId: org.id, personId: target.id, type: "water_baptism", date: new Date(Date.now() - 40 * 86_400_000), recordedBy: "p5-verify" },
  });

  // a posted donation for the target (giving tab / leak checks)
  const donation = await db.donation.create({
    data: { orgId: org.id, personId: target.id, amountCents: 500_000, currency: "NGN", method: "cash", status: "posted", receivedOn: new Date(), memo: "P5 verify" },
  });
  sweep.donationIds.push(donation.id);

  // comms history for the target: one SMS broadcast + a WhatsApp thread
  const message = await db.message.create({
    data: { orgId: org.id, channel: "sms", subject: "P5 verify broadcast", status: "sent", sentAt: new Date(), fromName: "P5 Verify", audience: "{}" },
  });
  sweep.messageIds.push(message.id);
  await db.messageRecipient.create({
    data: { orgId: org.id, messageId: message.id, personId: target.id, address: "+2348031150001", status: "delivered", sentAt: new Date() },
  });
  const waContact = await db.whatsAppContact.create({
    data: { orgId: org.id, personId: target.id, phoneNumber: "+2348031150001", displayName: "Chinelo P5Target", optedIn: true },
  });
  sweep.waContactIds.push(waContact.id);
  const waMsg = await db.whatsAppMessage.create({
    data: { orgId: org.id, contactId: waContact.id, direction: "outbound", messageType: "text", content: "P5 verify WhatsApp hello", status: "delivered" },
  });
  sweep.waMessageIds.push(waMsg.id);

  // ── temp roles + users (real ROLE_TEMPLATES for pastor/minister) ─────────
  async function makeRole(key: string, name: string, permissions: string[]): Promise<string> {
    const role = await db.role.create({
      data: { orgId: org.id, key, name, isSystem: false, permissions: { create: permissions.map((p) => ({ permission: p })) } },
    });
    sweep.roleIds.push(role.id);
    return role.id;
  }
  async function makeUser(email: string, name: string, password: string, personId: string, roleId: string): Promise<string> {
    const user = await db.user.create({ data: { email, name, passwordHash: hashPassword(password) } });
    sweep.userIds.push(user.id);
    const membership = await db.membership.create({ data: { orgId: org.id, userId: user.id, personId } });
    await db.roleAssignment.create({ data: { orgId: org.id, membershipId: membership.id, roleId } });
    return user.id;
  }

  const memberRoleId = await makeRole("verify_p5_member", "Verify P5 Member", ["people.view", "giving.view.own"]);
  const leaderRoleId = await makeRole("verify_p5_leader", "Verify P5 Leader", ["people.view"]);
  // ROLE_TEMPLATES mirror the real presets: pastor holds people.notes.confidential
  // + giving.view.pastor (setting-gated); minister holds notes.view/create only.
  const pastorRoleId = await makeRole("verify_p5_pastor", "Verify P5 Pastor", ROLE_TEMPLATES.pastor);
  const ministerRoleId = await makeRole("verify_p5_minister", "Verify P5 Minister", ROLE_TEMPLATES.minister);

  await makeUser("verify.p5.member@test.local", "Nkechi P5Member", "p5member-pass", memberPerson.id, memberRoleId);
  await makeUser("verify.p5.leader@test.local", "Emeka P5Leader", "p5leader-pass", leaderPerson.id, leaderRoleId);
  await makeUser("verify.p5.pastor@test.local", "Pastor P5", "p5pastor-pass", stranger.id, pastorRoleId);
  await makeUser("verify.p5.minister@test.local", "Minister P5", "p5minister-pass", stranger.id, ministerRoleId);

  const memberCookie = await loginCookie("verify.p5.member@test.local", "p5member-pass");
  const leaderCookie = await loginCookie("verify.p5.leader@test.local", "p5leader-pass");
  const pastorCookie = await loginCookie("verify.p5.pastor@test.local", "p5pastor-pass");
  const ministerCookie = await loginCookie("verify.p5.minister@test.local", "p5minister-pass");
  const financeCookie = await loginCookie("femi.f@redeembaptist.ng", "redeem2026");

  const profile = (id: string) => `/people/v2/${id}/profile`;

  // ══ 1. PASTOR (setting OFF by default) — everything EXCEPT giving ═════════
  {
    const r = await api(pastorCookie, profile(target.id));
    const tabs = r.body?.tabs ?? {};
    check("pastor: profile 200", r.status === 200, `status ${r.status}`);
    check("pastor: attendance/notes/comms/activity tabs true",
      tabs.attendance === true && tabs.notes === true && tabs.comms === true && tabs.activity === true,
      JSON.stringify(tabs));
    check("pastor: giving tab FALSE (church setting off)", tabs.giving === false, JSON.stringify(tabs));
    check("pastor: notesConfidential true", tabs.notesConfidential === true);

    const g = await api(pastorCookie, `/donations?personId=${target.id}&pageSize=25`);
    const leaked = (g.body?.items ?? []).some((d: any) => d.person?.id === target.id);
    check("pastor: GET donations does not leak target gifts (own-scope forced)", g.status === 200 && !leaked,
      `status ${g.status} items=${(g.body?.items ?? []).length}`);

    const act = await api(pastorCookie, `/people/v2/${target.id}/activity`);
    const types = (act.body?.events ?? []).map((e: any) => e.type);
    check("pastor: activity has stage/milestone/attendance/note-capable feed", act.status === 200 && types.includes("stage") && types.includes("milestone"), types.join(","));
    check("pastor: activity has NO gift events (setting off)", !types.includes("gift"), types.join(","));

    const att = await api(pastorCookie, `/people/v2/${target.id}/attendance`);
    check("pastor: attendance 200 with streak 2, total 4 (absent never counts)",
      att.status === 200 && att.body?.streak === 2 && att.body?.total12m === 4,
      `status ${att.status} streak=${att.body?.streak} total=${att.body?.total12m}`);
    check("pastor: recent attendance excludes absent row", (att.body?.recent ?? []).every((x: any) => x.status !== "absent"));

    const msg = await api(pastorCookie, `/people/v2/${target.id}/messages`);
    check("pastor: messages 200 with the seeded SMS + WhatsApp thread",
      msg.status === 200 && (msg.body?.emailSms ?? []).length === 1 && (msg.body?.whatsapp?.items ?? []).length === 1,
      `status ${msg.status} sms=${(msg.body?.emailSms ?? []).length} wa=${(msg.body?.whatsapp?.items ?? []).length}`);
  }

  // ══ 2. Notes CRUD + CONFIDENTIAL ommission ════════════════════════════════
  let confidentialId = "";
  let ministerNoteId = "";
  {
    const c = await api(pastorCookie, `/people/v2/${target.id}/notes`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ type: "Counseling", body: "Confidential pastoral counseling note", confidentialityTier: "confidential" }) });
    check("pastor: confidential note created", c.status === 200 && c.body?.confidentialityTier === "confidential", `status ${c.status}`);
    confidentialId = c.body?.id ?? "";

    const legacy = await api(pastorCookie, `/people/v2/${target.id}/notes`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ note: "Legacy quick note still works" }) });
    check("pastor: legacy { note } contract creates a General note", legacy.status === 200 && legacy.body?.type === "General", `status ${legacy.status} type=${legacy.body?.type}`);

    const m = await api(ministerCookie, `/people/v2/${target.id}/notes`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ type: "Visit", body: "Home visit — family doing well" }) });
    check("minister: standard note created", m.status === 200 && m.body?.type === "Visit", `status ${m.status}`);
    ministerNoteId = m.body?.id ?? "";

    const mc = await api(ministerCookie, `/people/v2/${target.id}/notes`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ type: "General", body: "try confidential", confidentialityTier: "confidential" }) });
    check("minister: confidential create 403", mc.status === 403, `status ${mc.status}`);

    const list = await api(ministerCookie, `/people/v2/${target.id}/notes`);
    const ids = (list.body?.notes ?? []).map((n: any) => n.id);
    check("minister: notes list 200 WITHOUT the confidential row (omitted server-side)",
      list.status === 200 && !ids.includes(confidentialId) && ids.includes(ministerNoteId),
      `ids=${ids.length}`);

    const act = await api(ministerCookie, `/people/v2/${target.id}/activity`);
    const confInFeed = (act.body?.events ?? []).some((e: any) => e.type === "note" && e.confidential === true);
    check("minister: activity feed has no confidential note event", act.status === 200 && !confInFeed);

    const editOthers = await api(ministerCookie, `/people/v2/${target.id}/notes/${ministerNoteId}`, { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ body: "hijack attempt" }) });
    check("minister: PATCH own note 200", editOthers.status === 200, `status ${editOthers.status}`);

    const del = await api(ministerCookie, `/people/v2/${target.id}/notes/${ministerNoteId}`, { method: "DELETE" });
    check("minister: DELETE own note 200", del.status === 200, `status ${del.status}`);

    const patchPastors = await api(ministerCookie, `/people/v2/${target.id}/notes/${legacy.body?.id}`, { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ body: "not mine" }) });
    check("minister: PATCH pastor's note 403 (author-or-admin)", patchPastors.status === 403, `status ${patchPastors.status}`);

    const memberNotes = await api(memberCookie, `/people/v2/${target.id}/notes`);
    check("member: notes endpoint 403", memberNotes.status === 403, `status ${memberNotes.status}`);

    const patchByMember = await api(memberCookie, `/people/v2/${target.id}/notes/${confidentialId}`, { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ body: "nope" }) });
    check("member: PATCH note 403", patchByMember.status === 403, `status ${patchByMember.status}`);
  }

  // ══ 3. Flip the church setting ON → exactly the giving tab appears ════════
  {
    await writeSetting(true);
    const r = await api(pastorCookie, profile(target.id));
    check("pastor: giving tab TRUE with setting on", r.body?.tabs?.giving === true, JSON.stringify(r.body?.tabs));

    const g = await api(pastorCookie, `/donations?personId=${target.id}&pageSize=25`);
    const hasGift = (g.body?.items ?? []).some((d: any) => d.person?.id === target.id && d.amountCents === 500_000);
    check("pastor: GET donations now returns the target's gift", g.status === 200 && hasGift, `status ${g.status}`);

    const act = await api(pastorCookie, `/people/v2/${target.id}/activity`);
    check("pastor: activity now includes the gift event",
      (act.body?.events ?? []).some((e: any) => e.type === "gift" && e.amountCents === 500_000));
    await writeSetting(false);
  }

  // ══ 4. FINANCE — giving yes; attendance/notes/comms NO ═══════════════════
  {
    const r = await api(financeCookie, profile(target.id));
    const tabs = r.body?.tabs ?? {};
    check("finance: giving tab TRUE", tabs.giving === true, JSON.stringify(tabs));
    check("finance: attendance/notes/comms tabs FALSE",
      tabs.attendance === false && tabs.notes === false && tabs.comms === false, JSON.stringify(tabs));
    check("finance: notesConfidential false", tabs.notesConfidential === false);

    const att = await api(financeCookie, `/people/v2/${target.id}/attendance`);
    check("finance: attendance endpoint 403", att.status === 403, `status ${att.status}`);
    const notes = await api(financeCookie, `/people/v2/${target.id}/notes`);
    check("finance: notes endpoint 403", notes.status === 403, `status ${notes.status}`);
    const msgs = await api(financeCookie, `/people/v2/${target.id}/messages`);
    check("finance: messages endpoint 403", msgs.status === 403, `status ${msgs.status}`);

    const g = await api(financeCookie, `/donations?personId=${target.id}&pageSize=25`);
    check("finance: GET donations returns the target's gift", g.status === 200 && (g.body?.items ?? []).some((d: any) => d.person?.id === target.id));
  }

  // ══ 5. MEMBER — nothing on strangers; own attendance + own giving ════════
  {
    const r = await api(memberCookie, profile(target.id));
    const tabs = r.body?.tabs ?? {};
    check("member: on a stranger all Phase 5 tabs FALSE",
      tabs.attendance === false && tabs.giving === false && tabs.notes === false && tabs.comms === false && tabs.activity === false,
      JSON.stringify(tabs));
    const att = await api(memberCookie, `/people/v2/${target.id}/attendance`);
    check("member: attendance endpoint 403 on others", att.status === 403, `status ${att.status}`);
    const msgs = await api(memberCookie, `/people/v2/${target.id}/messages`);
    check("member: messages endpoint 403 on others", msgs.status === 403, `status ${msgs.status}`);
    const act = await api(memberCookie, `/people/v2/${target.id}/activity`);
    check("member: activity on others is empty", act.status === 200 && (act.body?.events ?? []).length === 0, `events=${(act.body?.events ?? []).length}`);

    const self = await api(memberCookie, profile(memberPerson.id));
    const stabs = self.body?.tabs ?? {};
    check("member: on SELF attendance true, giving true (own), activity true, notes/comms false",
      stabs.attendance === true && stabs.giving === true && stabs.activity === true && stabs.notes === false && stabs.comms === false,
      JSON.stringify(stabs));
    const selfAtt = await api(memberCookie, `/people/v2/${memberPerson.id}/attendance`);
    check("member: own attendance endpoint 200", selfAtt.status === 200, `status ${selfAtt.status}`);
    const selfGift = await api(memberCookie, `/donations?personId=${target.id}&pageSize=25`);
    const leaked = (selfGift.body?.items ?? []).some((d: any) => d.person?.id === target.id);
    check("member: GET donations never leaks others (forced self-scope)", selfGift.status === 200 && !leaked);
  }

  // ══ 6. LEADER — leads a group containing the target, still nothing ═══════
  {
    const r = await api(leaderCookie, profile(target.id));
    const tabs = r.body?.tabs ?? {};
    check("leader: no Phase 5 tabs on their group member",
      tabs.attendance === false && tabs.giving === false && tabs.notes === false && tabs.comms === false && tabs.activity === false,
      JSON.stringify(tabs));
    const att = await api(leaderCookie, `/people/v2/${target.id}/attendance`);
    check("leader: attendance endpoint 403", att.status === 403, `status ${att.status}`);
  }

  // ══ 7. Tenant scoping light-checks ════════════════════════════════════════
  {
    const r = await api(pastorCookie, `/people/v2/does-not-exist/profile`);
    check("bogus person id → 404 (not a leak)", r.status === 404, `status ${r.status}`);
    const n = await api(pastorCookie, `/people/v2/does-not-exist/notes`);
    check("bogus person notes → 404", n.status === 404, `status ${n.status}`);
  }

  // ══ 8. SWEEP ────────────────────────────────────────────────────────────────
  await db.personNote.deleteMany({ where: { personId: { in: sweep.personIds } } });
  await db.personMilestone.deleteMany({ where: { personId: { in: sweep.personIds } } });
  await db.stageHistory.deleteMany({ where: { personId: { in: sweep.personIds } } });
  await db.attendanceRecord.deleteMany({ where: { personId: { in: sweep.personIds } } });
  await db.donation.deleteMany({ where: { id: { in: sweep.donationIds } } });
  await db.groupMember.deleteMany({ where: { groupId: { in: sweep.groupIds } } });
  await db.group.deleteMany({ where: { id: { in: sweep.groupIds } } });
  await db.event.deleteMany({ where: { id: { in: sweep.eventIds } } });
  await db.whatsAppMessage.deleteMany({ where: { id: { in: sweep.waMessageIds } } });
  await db.whatsAppContact.deleteMany({ where: { id: { in: sweep.waContactIds } } });
  await db.messageRecipient.deleteMany({ where: { messageId: { in: sweep.messageIds } } });
  await db.message.deleteMany({ where: { id: { in: sweep.messageIds } } });
  await db.personRelationship.deleteMany({ where: { OR: [{ fromPersonId: { in: sweep.personIds } }, { toPersonId: { in: sweep.personIds } }] } });
  await db.householdMember.deleteMany({ where: { personId: { in: sweep.personIds } } });
  await db.person.deleteMany({ where: { id: { in: sweep.personIds } } });
  await db.rolePermission.deleteMany({ where: { roleId: { in: sweep.roleIds } } });
  await db.roleAssignment.deleteMany({ where: { roleId: { in: sweep.roleIds } } });
  await db.role.deleteMany({ where: { id: { in: sweep.roleIds } } });
  for (const uid of sweep.userIds) {
    await db.roleAssignment.deleteMany({ where: { membership: { userId: uid } } });
    await db.membership.deleteMany({ where: { userId: uid } });
    await db.session.deleteMany({ where: { userId: uid } });
    await db.user.delete({ where: { id: uid } }).catch(() => {});
  }
  // restore the church setting exactly as found
  await db.organization.update({ where: { id: org.id }, data: { settings: originalSettings } });

  // ── report ──────────────────────────────────────────────────────────────────
  console.log("\n══════════ Phase 5 verification ══════════");
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
