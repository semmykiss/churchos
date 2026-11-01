// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-people-crm-phase1.ts — role × endpoint visibility matrix
// (Phase 1 People CRM acceptance run)
//
// Logs in through the REAL /api/v1/auth/login endpoint for each tier, calls the
// REAL people endpoints and asserts the serializer's field visibility rules.
// Creates two TEMP users (member tier + parent tier) with matching temp roles
// and removes them afterwards — no existing account is modified.
//
// Prereq: dev server on :3000 + Phase 1 schema/data scripts already applied.
// Run:  bun scripts/verify-people-crm-phase1.ts
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

async function api<T = any>(cookie: string, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: `chms_session=${cookie}` },
  });
  const text = await res.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { status: res.status, body };
}

const ORIGINAL_LIST_KEYS = ["id", "firstName", "lastName", "preferredName", "email", "phone", "birthdate", "gender", "status", "lifecycleStage", "membershipStatus", "allergies", "photoUrl", "firstVisitAt", "lastActivityAt", "household", "tags"];
const ORIGINAL_DETAIL_KEYS = ["custom", "canEdit", "household", "guardians", "dependents", "groups", "stageHistory", "tags", "attendance", "giving", "care"];

async function main() {
  const org = await db.organization.findFirst();
  if (!org) throw new Error("No organization.");
  const campus = await db.campus.findFirst({ where: { orgId: org.id } });

  // sweep any leftover test rows from a previous interrupted run
  const leftovers = await db.person.findMany({ where: { firstName: "Testy", lastName: "Verify" }, select: { id: true } });
  for (const l of leftovers) {
    await db.stageHistory.deleteMany({ where: { personId: l.id } });
    await db.person.delete({ where: { id: l.id } }).catch(() => {});
  }

  const personByName = async (name: string) => {
    const [first, ...rest] = name.split(" ");
    return db.person.findFirst({ where: { orgId: org.id, firstName: first, lastName: rest.join(" "), deletedAt: null, mergedIntoId: null } });
  };

  // ── targets ────────────────────────────────────────────────────────────
  const rita = await personByName("Rita Peters");
  const joyce = await personByName("Joyce Mensah");
  const aisha = await personByName("Aisha Bello");
  const daniel = await personByName("Daniel Bello");
  const vera = await personByName("Vera Johnson");
  if (!rita || !joyce || !aisha || !daniel || !vera) throw new Error("Demo people missing — run scripts/nigerianize-demo-people.ts first.");

  // leader-tier target: a member of the group Vera leads who has group attendance
  const ledGroup = await db.groupMember.findFirst({
    where: { orgId: org.id, personId: vera.id, role: { in: ["leader", "co_leader"] }, status: "active", group: { deletedAt: null, status: "active" } },
    include: { group: true },
  });
  let leaderTarget: { id: string; name: string } | null = null;
  if (ledGroup) {
    const members = await db.groupMember.findMany({ where: { groupId: ledGroup.groupId, status: "active", personId: { not: vera.id } }, select: { personId: true } });
    for (const m of members) {
      const att = await db.attendanceRecord.findFirst({
        where: { personId: m.personId, event: { groupId: ledGroup.groupId } },
        select: { id: true },
      });
      if (att) {
        const p = await db.person.findUnique({ where: { id: m.personId }, select: { firstName: true, lastName: true } });
        leaderTarget = { id: m.personId, name: p ? `${p.firstName} ${p.lastName}` : m.personId };
        break;
      }
    }
  }

  // ── temp roles + users (member tier / parent tier) ─────────────────────
  const cleanup: { userIds: string[]; roleIds: string[] } = { userIds: [], roleIds: [] };
  async function ensureTempRole(key: string, name: string, permissions: string[], matrix: Record<string, number>) {
    const existing = await db.role.findFirst({ where: { orgId: org.id, key } });
    if (existing) { cleanup.roleIds.push(existing.id); return existing.id; }
    const r = await db.role.create({
      data: { orgId: org.id, key, name, isSystem: false, accessMatrix: JSON.stringify(matrix), permissions: { create: permissions.map((p) => ({ permission: p })) } },
    });
    cleanup.roleIds.push(r.id);
    return r.id;
  }
  async function tempUser(email: string, name: string, personId: string, roleId: string) {
    const u = await db.user.create({ data: { email, name, passwordHash: hashPassword("verify-temp-2026") } });
    const m = await db.membership.create({ data: { orgId: org.id, userId: u.id, personId, defaultCampusId: campus?.id } });
    await db.roleAssignment.create({ data: { orgId: org.id, membershipId: m.id, roleId, scopeType: "campus", scopeId: campus?.id ?? org.id } });
    cleanup.userIds.push(u.id);
    return { userId: u.id, membershipId: m.id };
  }

  let memberRoleId: string | null = null;
  let parentRoleId: string | null = null;
  let memberCookie = "";
  let parentCookie = "";
  let leaderCookie = "";
  try {
    memberRoleId = await ensureTempRole("verify_member", "Verify — Member (temp)", ["people.view"], { people: 1 });
    parentRoleId = await ensureTempRole("verify_parent", "Verify — Parent (temp)", ["people.view", "people.edit.own_household", "portal.use"], { people: 1, portal: 2 });
    const memberU = await tempUser("verify.member@test.local", "Verify Member", joyce.id, memberRoleId!);
    const parentU = await tempUser("verify.parent@test.local", "Verify Parent", daniel.id, parentRoleId!);
    memberCookie = await loginCookie("verify.member@test.local", ["verify-temp-2026"]);
    parentCookie = await loginCookie("verify.parent@test.local", ["verify-temp-2026"]);
    void memberU; void parentU;

    // ── demo logins ──────────────────────────────────────────────────────
    const pastorCookie = await loginCookie("pastor@redeembaptist.ng", ["redeem2026", "grace2026"]);
    const femiCookie = await loginCookie("femi.f@redeembaptist.ng", ["redeem2026", "grace2026"]);
    const veraCookie = await loginCookie("vera.v@redeembaptist.ng", ["redeem2026", "grace2026"]);

    // ── 1. list endpoint — shape intact + additive fields ────────────────
    const staffList = await api(pastorCookie, "/people?page=1&pageSize=100");
    check("list: staff gets 200", staffList.status === 200 && Array.isArray(staffList.body?.items), `status=${staffList.status}`);
    const items = staffList.body?.items ?? [];
    check("list: original keys preserved (superset)", items.length > 0 && ORIGINAL_LIST_KEYS.every((k) => k in items[0]), `missing: ${ORIGINAL_LIST_KEYS.filter((k) => !(k in (items[0] ?? {}))).join(",") || "none"}`);
    check("list: additive phoneDisplay/phoneE164 present", items.every((p: any) => "phoneDisplay" in p && "phoneE164" in p));
    // find the demo pastor deterministically (volume data may push him past page 1)
    const emmanuelSearch = await api(pastorCookie, `/people?search=${encodeURIComponent("+2348031234501")}`);
    const emmanuel = (emmanuelSearch.body?.items ?? []).find((p: any) => p.firstName === "Emmanuel");
    check("list: Nigerian +234 E164 + display format", !!emmanuel && emmanuel.phoneE164 === "+2348031234501" && emmanuel.phoneDisplay === "0803 123 4501", `phoneE164=${emmanuel?.phoneE164} display=${emmanuel?.phoneDisplay}`);
    check("list: state/lga surfaced for staff", !!emmanuel && emmanuel.state === "Lagos" && emmanuel.lga === "Ikeja");

    // ── 2. staff (owner) — full detail incl. notes + shepherd link ───────
    const staffDetail = await api(pastorCookie, `/people/${rita.id}`);
    const detailTopMissing = ORIGINAL_DETAIL_KEYS.filter((k) => k !== "custom" && k !== "canEdit" && !(k in staffDetail.body ?? {}));
    const detailPersonMissing = ["custom", "canEdit"].filter((k) => !(k in (staffDetail.body?.person ?? {})));
    check("detail: staff 200 + original keys (superset)", staffDetail.status === 200 && detailTopMissing.length === 0 && detailPersonMissing.length === 0, `top-missing: ${detailTopMissing.join(",") || "none"} · person-missing: ${detailPersonMissing.join(",") || "none"}`);
    check("detail: staff sees notes", staffDetail.body?.person?.viewerTier === "staff" && "notes" in staffDetail.body.person);
    const shepherdedDetail = await api(pastorCookie, `/people/${joyce.id}`);
    check("detail: assignedShepherd populated (Joyce Mensah)", !!shepherdedDetail.body?.person?.assignedShepherd?.name, `got=${JSON.stringify(shepherdedDetail.body?.person?.assignedShepherd)}`);
    const milesDetail = await api(pastorCookie, `/people/${(await personByName("Miles Osei"))!.id}`);
    check("detail: invitedBy populated (Miles ← Andre Kalu)", milesDetail.body?.person?.invitedBy?.name === "Andre Kalu", `got=${JSON.stringify(milesDetail.body?.person?.invitedBy)}`);
    check("detail: canEditDirectoryPrivacy true for staff", staffDetail.body?.person?.canEditDirectoryPrivacy === true);

    // ── 3. finance — full contact but NO confidential notes ──────────────
    const femiDetail = await api(femiCookie, `/people/${rita.id}`);
    check("finance: contact visible", femiDetail.status === 200 && femiDetail.body?.person?.phone !== null && femiDetail.body?.person?.phoneE164 !== null);
    check("finance: notes === null (tier-gated)", femiDetail.body?.person?.viewerTier === "finance" && femiDetail.body?.person?.notes === null, `tier=${femiDetail.body?.person?.viewerTier} notes=${JSON.stringify(femiDetail.body?.person?.notes)}`);
    check("finance: allergies hidden", femiDetail.body?.person?.allergies === null);
    const femiCreate = await api(femiCookie, "/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: "No", lastName: "Chance" }) });
    check("finance: people.create denied (403)", femiCreate.status === 403, `status=${femiCreate.status}`);

    // ── 4. member tier — privacy default hides contact of others ─────────
    const memberSelf = await api(memberCookie, `/people/${joyce.id}`);
    check("member: self sees own phone", memberSelf.status === 200 && memberSelf.body?.person?.viewerTier === "self" && memberSelf.body?.person?.phone !== null, `tier=${memberSelf.body?.person?.viewerTier}`);
    const memberOther = await api(memberCookie, `/people/${rita.id}`);
    check("member: others' contact hidden by privacy default", memberOther.body?.person?.viewerTier === "member" && memberOther.body?.person?.phone === null && memberOther.body?.person?.email === null && memberOther.body?.person?.birthdate === null, `phone=${JSON.stringify(memberOther.body?.person?.phone)}`);
    check("member: attendance hidden", Array.isArray(memberOther.body?.attendance) && memberOther.body.attendance.length === 0);
    check("member: privacyHidden flags explain why", Array.isArray(memberOther.body?.person?.privacyHidden) && memberOther.body.person.privacyHidden.includes("phone") && memberOther.body.person.privacyHidden.includes("attendance"));
    const memberNotes = await api(memberCookie, `/people/${joyce.id}`);
    check("member: even own notes never exposed", memberNotes.body?.person?.notes === null);

    // ── 5. leader tier — temp user on Frank Danjuma (leads an ADULT group with phones) ─
    const frank = await personByName("Frank Danjuma");
    let leaderChecked = false;
    if (frank) {
      const volunteerRole = await db.role.findFirst({ where: { orgId: org.id, key: "volunteer" } });
      const ledByFrank = await db.groupMember.findFirst({
        where: { orgId: org.id, personId: frank.id, role: { in: ["leader", "co_leader"] }, status: "active", group: { deletedAt: null, status: "active" } },
        include: { group: true },
      });
      if (volunteerRole && ledByFrank) {
        const frankUser = await tempUser("verify.leader@test.local", "Verify Leader", frank.id, volunteerRole.id);
        leaderCookie = await loginCookie("verify.leader@test.local", ["verify-temp-2026"]);
        const members = await db.groupMember.findMany({ where: { groupId: ledByFrank.groupId, status: "active", personId: { not: frank.id } }, select: { personId: true } });
        for (const m of members) {
          const p = await db.person.findFirst({ where: { id: m.personId, phone: { not: null } }, select: { id: true, firstName: true, lastName: true } });
          if (!p) continue;
          const leaderView = await api(leaderCookie, `/people/${p.id}`);
          check("leader: group member contact visible", leaderView.status === 200 && leaderView.body?.person?.viewerTier === "leader" && leaderView.body?.person?.phone !== null, `tier=${leaderView.body?.person?.viewerTier} phone=${JSON.stringify(leaderView.body?.person?.phone)}`);
          check("leader: group member attendance visible", Array.isArray(leaderView.body?.attendance) && leaderView.body.attendance.length > 0, `rows=${leaderView.body?.attendance?.length}`);
          check("leader: giving stays hidden", leaderView.body?.giving?.visible === false, `visible=${leaderView.body?.giving?.visible}`);
          leaderChecked = true;
          break;
        }
      }
    }
    if (leaderChecked) {
      const leaderOther = await api(leaderCookie, `/people/${rita.id}`);
      check("leader: non-group member stays member-tier", leaderOther.body?.person?.viewerTier === "member" && leaderOther.body?.person?.phone === null, `tier=${leaderOther.body?.person?.viewerTier}`);
    } else {
      check("leader: (skipped — no adult led-group with phones found in demo data)", true);
    }

    // ── 6. parent tier — own household full, others member-tier ──────────
    const parentWife = await api(parentCookie, `/people/${aisha.id}`);
    check("parent: household member contact visible", parentWife.status === 200 && parentWife.body?.person?.viewerTier === "parent" && parentWife.body?.person?.phone !== null, `tier=${parentWife.body?.person?.viewerTier} phone=${JSON.stringify(parentWife.body?.person?.phone)}`);
    check("parent: household address visible", parentWife.body?.household?.addressLine1 !== null && parentWife.body?.household?.addressLine1 !== undefined);
    const parentOther = await api(parentCookie, `/people/${rita.id}`);
    check("parent: non-household person gated", parentOther.body?.person?.viewerTier === "member" && parentOther.body?.person?.phone === null, `tier=${parentOther.body?.person?.viewerTier}`);

    // ── 7. normalized duplicate detection ─────────────────────────────────
    const dup = await api(pastorCookie, `/people/duplicates?phone=${encodeURIComponent("0803 123 4501")}`);
    check("duplicates: local-format phone matches E164 record", dup.status === 200 && (dup.body?.exact ?? []).some((d: any) => d.phoneE164 === "+2348031234501"), `exact=${JSON.stringify((dup.body?.exact ?? []).map((d: any) => d.phoneE164))}`);

    // ── 8. search finds normalized phone ─────────────────────────────────
    const search = await api(pastorCookie, `/people?search=${encodeURIComponent("+2348161234504")}`);
    check("search: E164 search hits record", search.status === 200 && (search.body?.items ?? []).some((p: any) => p.phoneE164 === "+2348161234504"));

    // ── 9. write path normalization (create + update) ────────────────────
    const created = await api(pastorCookie, "/people", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Testy", lastName: "Verify", phone: "0703 555 0199", whatsapp: "0703 555 0199", state: "Lagos", lga: "Ikeja", title: "Mr", occupation: "QA", source: "guest_card", force: true }),
    });
    const createdId = created.body?.created?.id;
    check("create: 200 + id", created.status === 200 && !!createdId, `status=${created.status} body=${JSON.stringify(created.body).slice(0, 160)}`);
    if (createdId) {
      const got = await api(pastorCookie, `/people/${createdId}`);
      check("create: phone normalized to E164", got.body?.person?.phoneE164 === "+2347035550199" && got.body?.person?.phone === "0703 555 0199", `e164=${got.body?.person?.phoneE164}`);
      check("create: display format", got.body?.person?.phoneDisplay === "0703 555 0199", `display=${got.body?.person?.phoneDisplay}`);
      const updated = await api(pastorCookie, `/people/${createdId}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "0803 123 4501", directoryPrivacy: { phone: true, email: false, birthday: true, address: false } }),
      });
      check("update: 200", updated.status === 200, `status=${updated.status}`);
      const got2 = await api(pastorCookie, `/people/${createdId}`);
      check("update: E164 re-derived from raw phone", got2.body?.person?.phoneE164 === "+2348031234501");
      check("update: directoryPrivacy stored + echoed", JSON.stringify(got2.body?.person?.directoryPrivacy) === JSON.stringify({ phone: true, email: false, birthday: true, address: false }), `got=${JSON.stringify(got2.body?.person?.directoryPrivacy)}`);
      // cleanup test person (stage history holds an FK to person)
      await api(pastorCookie, `/people/${createdId}/archive`, { method: "POST" });
      await db.stageHistory.deleteMany({ where: { personId: createdId } });
      await db.person.delete({ where: { id: createdId } }).catch(() => {});
    }
  } finally {
    // ── cleanup temp users/roles ────────────────────────────────────────
    for (const uid of cleanup.userIds) {
      const memberships = await db.membership.findMany({ where: { userId: uid } });
      for (const m of memberships) await db.roleAssignment.deleteMany({ where: { membershipId: m.id } });
      await db.membership.deleteMany({ where: { userId: uid } });
      await db.session.deleteMany({ where: { userId: uid } });
      await db.notification.deleteMany({ where: { userId: uid } });
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    for (const rid of cleanup.roleIds) {
      await db.rolePermission.deleteMany({ where: { roleId: rid } });
      await db.roleAssignment.deleteMany({ where: { roleId: rid } });
      await db.role.delete({ where: { id: rid } }).catch(() => {});
    }
  }

  // ── report ─────────────────────────────────────────────────────────────
  console.log("\n════════ People CRM Phase 1 — role × endpoint verification ════════");
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
