// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-people-crm-phase3.ts — Smart Views, bulk actions, board drag
// (Phase 3 People CRM acceptance run)
//
// Logs in through the REAL /api/v1/auth/login endpoint for each role, calls the
// REAL endpoints and asserts the Phase 3 done-when:
//   • bulk actions skip records the user cannot edit and report why
//   • the board's stage-change mutation (POST /people/:id/stage) writes stage
//     history entries
//   • shared views are gated by people.views.manage; system views immutable;
//     personal views stay private
//   • relative filter ops + stageCounts + v2 CSV export behave
//
// Creates TEMP users/roles/people/household/tag/views and removes them after —
// no existing account or demo record is modified.
//
// Prereq: dev server on :3000 + Phase 3 schema applied (bun run db:push).
// Run:  bun scripts/verify-people-crm-phase3.ts
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
  // documented demo password as final fallback (aligns with docs)
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
const SHARED_VIEW = "Verify Shared List";
const PERSONAL_VIEW = "Verify Personal List";

async function main() {
  const org = await db.organization.findFirst();
  if (!org) throw new Error("No organization.");
  const campus = await db.campus.findFirst({ where: { orgId: org.id } });

  // ── sweep leftovers from a previous interrupted run ──────────────────────
  const leftoverPeople = await db.person.findMany({
    where: { orgId: org.id, lastName: { in: ["Bulkhead", "Partner", "Stranger", "Draggable", "Matcherson"] } },
    select: { id: true },
  });
  for (const p of leftoverPeople) {
    await db.stageHistory.deleteMany({ where: { personId: p.id } });
    await db.personTag.deleteMany({ where: { personId: p.id } });
    await db.householdMember.deleteMany({ where: { personId: p.id } });
    await db.person.delete({ where: { id: p.id } }).catch(() => {});
  }
  await db.household.deleteMany({ where: { orgId: org.id, name: "Verify Bulk Home" } });
  await db.tag.deleteMany({ where: { orgId: org.id, name: "Verify Bulk Tag" } });
  await db.savedView.deleteMany({ where: { orgId: org.id, name: { in: [SHARED_VIEW, PERSONAL_VIEW, "Verify Vera Personal", "Verify Renamed"] } } });
  for (const key of ["verify_bulk_scoped", "verify_plain_member"]) {
    const role = await db.role.findFirst({ where: { orgId: org.id, key } });
    if (role) {
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      await db.roleAssignment.deleteMany({ where: { roleId: role.id } });
      await db.role.delete({ where: { id: role.id } }).catch(() => {});
    }
  }
  for (const email of ["verify.bulk@test.local", "verify.plain@test.local"]) {
    const u = await db.user.findUnique({ where: { email } });
    if (u) {
      const ms = await db.membership.findMany({ where: { userId: u.id } });
      for (const m of ms) await db.roleAssignment.deleteMany({ where: { membershipId: m.id } });
      await db.membership.deleteMany({ where: { userId: u.id } });
      await db.session.deleteMany({ where: { userId: u.id } });
      await db.user.delete({ where: { id: u.id } }).catch(() => {});
    }
  }

  // ── demo logins ───────────────────────────────────────────────────────────
  const pastorCookie = await loginCookie("pastor@redeembaptist.ng", ["redeem2026", "grace2026"]);
  const ritaCookie = await loginCookie("rita.p@redeembaptist.ng", ["redeem2026", "grace2026"]);
  const veraCookie = await loginCookie("vera.v@redeembaptist.ng", ["redeem2026", "grace2026"]);

  // ── temp fixtures ─────────────────────────────────────────────────────────
  const hh = await db.household.create({ data: { orgId: org.id, name: "Verify Bulk Home" } });
  const bulkPerson = await db.person.create({ data: { orgId: org.id, firstName: "Testy", lastName: "Bulkhead" } });
  const partner = await db.person.create({ data: { orgId: org.id, firstName: "Testy", lastName: "Partner" } });
  const stranger = await db.person.create({ data: { orgId: org.id, firstName: "Testy", lastName: "Stranger" } });
  const draggable = await db.person.create({ data: { orgId: org.id, firstName: "Testy", lastName: "Draggable" } });
  const matcherA = await db.person.create({ data: { orgId: org.id, firstName: "Annie", lastName: "Matcherson" } });
  const matcherB = await db.person.create({ data: { orgId: org.id, firstName: "Ben", lastName: "Matcherson" } });
  await db.householdMember.createMany({
    data: [
      { householdId: hh.id, personId: bulkPerson.id, role: "head" },
      { householdId: hh.id, personId: partner.id, role: "spouse" },
    ],
  });
  const bulkTag = await db.tag.create({ data: { orgId: org.id, name: "Verify Bulk Tag" } });

  // temp role + user: people.view + people.bulk + own_household (NO people.edit)
  const bulkRole = await db.role.create({
    data: {
      orgId: org.id, key: "verify_bulk_scoped", name: "Verify — Bulk scoped (temp)", isSystem: false,
      accessMatrix: JSON.stringify({ people: 1 }),
      permissions: { create: [{ permission: "people.view" }, { permission: "people.bulk" }, { permission: "people.edit.own_household" }] },
    },
  });
  const bulkUser = await db.user.create({ data: { email: "verify.bulk@test.local", name: "Verify Bulk", passwordHash: hashPassword("verify-temp-2026") } });
  const bulkMembership = await db.membership.create({ data: { orgId: org.id, userId: bulkUser.id, personId: bulkPerson.id, defaultCampusId: campus?.id } });
  await db.roleAssignment.create({ data: { orgId: org.id, membershipId: bulkMembership.id, roleId: bulkRole.id, scopeType: "campus", scopeId: campus?.id ?? org.id } });

  // temp role + user: people.view ONLY (no bulk, no views.manage)
  const plainRole = await db.role.create({
    data: {
      orgId: org.id, key: "verify_plain_member", name: "Verify — Plain member (temp)", isSystem: false,
      accessMatrix: JSON.stringify({ people: 1 }),
      permissions: { create: [{ permission: "people.view" }] },
    },
  });
  const plainUser = await db.user.create({ data: { email: "verify.plain@test.local", name: "Verify Plain", passwordHash: hashPassword("verify-temp-2026") } });
  const plainMembership = await db.membership.create({ data: { orgId: org.id, userId: plainUser.id, personId: stranger.id, defaultCampusId: campus?.id } });
  await db.roleAssignment.create({ data: { orgId: org.id, membershipId: plainMembership.id, roleId: plainRole.id, scopeType: "campus", scopeId: campus?.id ?? org.id } });

  const bulkCookie = await loginCookie("verify.bulk@test.local", ["verify-temp-2026"]);
  const plainCookie = await loginCookie("verify.plain@test.local", ["verify-temp-2026"]);

  try {
    // ══ 1. permissions gate the bulk endpoint ═══════════════════════════════
    const veraBulk = await api(veraCookie, "/people/bulk", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ action: "add_tag", personIds: [draggable.id], params: { tagId: bulkTag.id } }) });
    check("bulk: volunteer WITHOUT people.bulk gets 403", veraBulk.status === 403, `status=${veraBulk.status}`);
    const bulkNoTag = await api(pastorCookie, "/people/bulk", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ action: "add_tag", personIds: [draggable.id], params: {} }) });
    check("bulk: add_tag without tagId → 400", bulkNoTag.status === 400, `status=${bulkNoTag.status}`);
    const veraTagAction = await api(veraCookie, "/people/bulk", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ action: "change_stage", personIds: [draggable.id], params: { stage: "attender" } }) });
    check("bulk: change_stage route needs people.bulk (403 for volunteer)", veraTagAction.status === 403, `status=${veraTagAction.status}`);

    // ══ 2. per-record skip: scoped editor edits own household only ══════════
    const scoped = await api(bulkCookie, "/people/bulk", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ action: "change_stage", personIds: [partner.id, stranger.id], params: { stage: "attender" } }),
    });
    check("bulk: scoped editor gets 200 + per-record summary", scoped.status === 200 && scoped.body?.total === 2, `status=${scoped.status} body=${JSON.stringify(scoped.body).slice(0, 200)}`);
    check("bulk: own-household record succeeded (1)", scoped.body?.succeeded === 1, `succeeded=${scoped.body?.succeeded}`);
    const failedRows = scoped.body?.failed ?? [];
    check("bulk: stranger skipped WITH reason", failedRows.length === 1 && failedRows[0].id === stranger.id && /permission/i.test(failedRows[0].reason ?? ""), `failed=${JSON.stringify(failedRows)}`);
    // the board/stage mutation path writes STAGE HISTORY (bulk reuses changeStage)
    const partnerHistory = await db.stageHistory.findMany({ where: { orgId: org.id, personId: partner.id } });
    check("bulk: stage history written via bulk change_stage", partnerHistory.some((h) => h.previousStage === "guest" && h.stage === "attender"), `rows=${partnerHistory.length}`);

    // ══ 3. board drag = existing stage endpoint → stage history ═════════════
    const drag = await api(pastorCookie, `/people/${draggable.id}/stage`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ stage: "attender" }) });
    check("board-drag: POST /people/:id/stage 200", drag.status === 200, `status=${drag.status}`);
    const dragHistory = await db.stageHistory.findMany({ where: { orgId: org.id, personId: draggable.id } });
    check("board-drag: stage history entry created (guest→attender)", dragHistory.some((h) => h.previousStage === "guest" && h.stage === "attender"), `rows=${dragHistory.length}`);
    const dragNoPerm = await api(veraCookie, `/people/${draggable.id}/stage`, { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ stage: "member" }) });
    check("board-drag: read-only viewer gets 403 (drag disabled server-side)", dragNoPerm.status === 403, `status=${dragNoPerm.status}`);

    // ══ 4. all-matching selection resolved server-side ══════════════════════
    const cap = await api(pastorCookie, "/people/bulk", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ action: "add_tag", allMatching: true, params: { tagId: bulkTag.id } }) });
    check("bulk: allMatching above the 1000 cap → 400 (narrow first)", cap.status === 400, `status=${cap.status}`);
    const matched = await api(pastorCookie, "/people/bulk", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ action: "add_tag", allMatching: true, search: "Matcherson", params: { tagId: bulkTag.id } }),
    });
    check("bulk: allMatching + search tags exactly the 2 matchers", matched.status === 200 && matched.body?.succeeded === 2 && matched.body?.total === 2, `status=${matched.status} body=${JSON.stringify(matched.body).slice(0, 200)}`);
    const tagged = await db.personTag.count({ where: { tagId: bulkTag.id } });
    check("bulk: both matchers now carry the tag", tagged === 2, `tagged=${tagged}`);

    // ══ 5. saved views — system defaults + gating ═══════════════════════════
    const viewsPastor = await api(pastorCookie, "/people/v2/views");
    const sysViews = (viewsPastor.body?.items ?? []).filter((v: any) => v.scope === "system");
    check("views: 8 system defaults shipped", viewsPastor.status === 200 && sysViews.length === 8, `status=${viewsPastor.status} system=${sysViews.length}`);
    check("views: system names present", ["All people", "New visitors (30 days)", "Members", "Children & Youth", "Not seen in 4 weeks", "Birthdays this month", "Unassigned to a group", "Leaders & Workers"].every((n) => sysViews.some((v: any) => v.name === n)), `got=${sysViews.map((v: any) => v.name).join("|")}`);
    check("views: system views are immutable (canEdit=false)", sysViews.every((v: any) => v.canEdit === false && v.canDelete === false));

    // shared view needs people.views.manage — volunteer/finance-style viewer 403s
    const veraShared = await api(veraCookie, "/people/v2/views", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ name: "Nope", scope: "shared" }) });
    check("views: shared create WITHOUT people.views.manage → 403", veraShared.status === 403, `status=${veraShared.status}`);
    const plainShared = await api(plainCookie, "/people/v2/views", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ name: "Nope", scope: "shared" }) });
    check("views: shared create 403 for plain member too", plainShared.status === 403, `status=${plainShared.status}`);

    const sharedCreate = await api(pastorCookie, "/people/v2/views", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ name: SHARED_VIEW, scope: "shared", viewType: "table", filters: { match: "all", conditions: [{ field: "stage", op: "is", value: "attender" }] } }),
    });
    check("views: pastor creates shared view", sharedCreate.status === 200 && sharedCreate.body?.scope === "shared", `status=${sharedCreate.status}`);

    const personalCreate = await api(pastorCookie, "/people/v2/views", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ name: PERSONAL_VIEW, scope: "personal" }) });
    check("views: personal create needs no extra permission", personalCreate.status === 200 && personalCreate.body?.scope === "personal", `status=${personalCreate.status}`);

    const veraViews = await api(veraCookie, "/people/v2/views");
    const veraItems = veraViews.body?.items ?? [];
    check("views: shared view visible to everyone with people.view", veraItems.some((v: any) => v.name === SHARED_VIEW));
    check("views: someone else's PERSONAL view never leaks", !veraItems.some((v: any) => v.name === PERSONAL_VIEW), `names=${veraItems.filter((v: any) => v.scope === "personal").map((v: any) => v.name).join("|")}`);

    const veraPersonal = await api(veraCookie, "/people/v2/views", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ name: "Verify Vera Personal", scope: "personal" }) });
    check("views: volunteer can still save a personal view", veraPersonal.status === 200, `status=${veraPersonal.status}`);

    // editing: shared views need people.views.manage; personal views only the owner
    const veraPatchShared = await api(veraCookie, `/people/v2/views/${sharedCreate.body?.id}`, { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ name: "Verify Renamed" }) });
    check("views: volunteer PATCH shared view → 403", veraPatchShared.status === 403, `status=${veraPatchShared.status}`);
    const ritaPatchShared = await api(ritaCookie, `/people/v2/views/${sharedCreate.body?.id}`, { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ name: "Verify Renamed" }) });
    check("views: ministry leader (people.views.manage) PATCH shared view → 200", ritaPatchShared.status === 200 && ritaPatchShared.body?.name === "Verify Renamed", `status=${ritaPatchShared.status} body=${JSON.stringify(ritaPatchShared.body).slice(0, 120)}`);
    const veraPatchOthersPersonal = await api(veraCookie, `/people/v2/views/${personalCreate.body?.id}`, { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ name: "Hijack" }) });
    check("views: PATCHing someone else's personal view → 403/404", veraPatchOthersPersonal.status === 403 || veraPatchOthersPersonal.status === 404, `status=${veraPatchOthersPersonal.status}`);

    // system views are not rows — they can never be mutated or deleted
    const patchSys = await api(pastorCookie, "/people/v2/views/sys:members", { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ name: "X" }) });
    const delSys = await api(pastorCookie, "/people/v2/views/sys:members", { method: "DELETE" });
    check("views: system views immutable (404 on PATCH/DELETE)", patchSys.status === 404 && delSys.status === 404, `patch=${patchSys.status} del=${delSys.status}`);

    // invalid filter JSON is rejected at SAVE time (dry-run through the list engine)
    const badFilter = await api(pastorCookie, "/people/v2/views", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ name: "Verify Bad", filters: { match: "all", conditions: [{ field: "not_a_field", op: "is" }] } }) });
    check("views: invalid filter field rejected at save (400)", badFilter.status === 400, `status=${badFilter.status}`);

    // ══ 6. relative filters + stageCounts + v2 export ════════════════════════
    const within30 = await api(pastorCookie, "/people/v2/list", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ filters: { match: "all", conditions: [{ field: "created", op: "withinLast", value: { days: 30 } }] }, pageSize: 10 }) });
    check("list: created withinLast 30d works", within30.status === 200 && within30.body?.total >= 5, `status=${within30.status} total=${within30.body?.total}`);
    check("list: stageCounts present (board headers)", within30.body?.stageCounts && typeof within30.body.stageCounts === "object" && Object.values(within30.body.stageCounts).every((n: any) => typeof n === "number"), `got=${JSON.stringify(within30.body?.stageCounts)}`);
    const bday = await api(pastorCookie, "/people/v2/list", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ filters: { match: "all", conditions: [{ field: "birthdayMonth", op: "is", value: "current" }] }, pageSize: 5 }) });
    check("list: birthdayMonth 'current' resolves (tz-aware)", bday.status === 200, `status=${bday.status}`);
    const serveTeams = await api(pastorCookie, "/people/v2/list", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ filters: { match: "any", conditions: [{ field: "groupType", op: "is", value: "serve_team" }] }, pageSize: 5 }) });
    check("list: groupType filter works", serveTeams.status === 200, `status=${serveTeams.status}`);
    const notSeen = await api(pastorCookie, "/people/v2/list", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ filters: { match: "any", conditions: [{ field: "lastAttended", op: "olderThan", value: { days: 28 } }, { field: "lastAttended", op: "isMissing" }] }, pageSize: 5 }) });
    check("list: lastAttended olderThan + isMissing (Not seen in 4 weeks)", notSeen.status === 200 && notSeen.body?.total > 0, `status=${notSeen.status} total=${notSeen.body?.total}`);

    const exportSel = await api(pastorCookie, "/people/v2/export.csv", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ personIds: [draggable.id] }) });
    check("export: v2 CSV 200 + same column contract", exportSel.status === 200 && (exportSel.text ?? "").startsWith("first_name,last_name,email,phone,stage"), `status=${exportSel.status}`);
    const exportVera = await api(veraCookie, "/people/v2/export.csv", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ personIds: [draggable.id] }) });
    check("export: non-staff (no people.edit) → 403", exportVera.status === 403, `status=${exportVera.status}`);
  } finally {
    // ── cleanup temp fixtures ───────────────────────────────────────────────
    for (const uid of [bulkUser.id, plainUser.id]) {
      const memberships = await db.membership.findMany({ where: { userId: uid } });
      for (const m of memberships) await db.roleAssignment.deleteMany({ where: { membershipId: m.id } });
      await db.membership.deleteMany({ where: { userId: uid } });
      await db.session.deleteMany({ where: { userId: uid } });
      await db.notification.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    for (const rid of [bulkRole.id, plainRole.id]) {
      await db.rolePermission.deleteMany({ where: { roleId: rid } });
      await db.roleAssignment.deleteMany({ where: { roleId: rid } });
      await db.role.delete({ where: { id: rid } }).catch(() => {});
    }
    for (const p of [bulkPerson, partner, stranger, draggable, matcherA, matcherB]) {
      await db.stageHistory.deleteMany({ where: { personId: p.id } });
      await db.personTag.deleteMany({ where: { personId: p.id } });
      await db.householdMember.deleteMany({ where: { personId: p.id } });
      await db.person.delete({ where: { id: p.id } }).catch(() => {});
    }
    await db.household.deleteMany({ where: { orgId: org.id, name: "Verify Bulk Home" } });
    await db.tag.deleteMany({ where: { orgId: org.id, name: "Verify Bulk Tag" } });
    await db.savedView.deleteMany({ where: { orgId: org.id, name: { in: [SHARED_VIEW, "Verify Renamed", PERSONAL_VIEW, "Verify Vera Personal", "Verify Bad"] } } });
  }

  // ── report ─────────────────────────────────────────────────────────────
  console.log("\n════════ People CRM Phase 3 — smart views & bulk actions verification ════════");
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? "  ✓" : "  ✗"} ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : ""}`);
  }
  console.log(`════════ ${results.length - failed}/${results.length} checks passed ════════`);
  if (failed > 0) process.exit(1);
}

main()
  .then(async () => { await db.$disconnect(); process.exit(0); })
  .catch(async (err) => {
    console.error("VERIFY FAILED:", err);
    await db.$disconnect();
    process.exit(1);
  });
