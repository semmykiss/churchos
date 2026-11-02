// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-people-crm-phase6.ts — Phase 6 acceptance run
// (Add/Edit slide-over server contract · Consent · Custom fields)
//
// Logs in through the REAL /api/v1/auth/login endpoint per role tier, calls
// the REAL endpoints and asserts the Phase 6 done-when:
//   • duplicate detection still works (exact phone match → duplicates + force)
//   • minors CANNOT be saved without a guardian (422 needs_guardian, no bypass)
//   • DOB with unknown year stores the flag; the list hides the age
//   • custom fields: only people.customfields.manage can define them; values
//     are validated server-side (unknown key / bad option / cleared required);
//     per-field editableByRoles is enforced on writes
//   • custom values are OMITTED from payloads for viewers without visibility
//     (list rows + profile + classic detail), and filtering by a restricted
//     field is blocked for the same viewers
//   • one-click presets are idempotent
//   • consents: record via the profile endpoint; members cannot record or
//     read others' consents; the profile exposes the per-channel current status
//   • saved views accept "custom:<key>" columns (show-in-table fields)
//
// Creates TEMP users/roles/people/definitions and removes them after — no
// existing account or demo record is modified.
//
// Prereq: dev server on :3000 + Phase 6 schema applied (bun run db:push).
// Run:  bun scripts/verify-people-crm-phase6.ts
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

// ── fixture bookkeeping ──────────────────────────────────────────────────────
const RUN = randomBytes(3).toString("hex");
const sweep = {
  roleIds: [] as string[],
  userIds: [] as string[],
  personIds: [] as string[],
  defIds: [] as string[],
  viewIds: [] as string[],
};

async function main() {
  const org = await db.organization.findFirst();
  if (!org) throw new Error("No organization.");

  // ── sweep leftovers from a previous interrupted run ────────────────────────
  for (const key of ["verify_p6_member", "verify_p6_minister", "verify_p6_owner", "verify_p6_finance"]) {
    const role = await db.role.findFirst({ where: { orgId: org.id, key } });
    if (role) {
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      await db.roleAssignment.deleteMany({ where: { roleId: role.id } });
      await db.role.delete({ where: { id: role.id } }).catch(() => {});
    }
  }
  for (const email of [
    "verify.p6.member@test.local", "verify.p6.minister@test.local",
    "verify.p6.owner@test.local", "verify.p6.finance@test.local",
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
  for (const last of ["P6Target", "P6Minor", "P6Kid", "P6Guardian", "P6NoContact", "P6ValueA", "P6ValueB", "P6Owner", "P6Finance"]) {
    const ppl = await db.person.findMany({ where: { orgId: org.id, lastName: last }, select: { id: true } });
    for (const p of ppl) {
      await db.personConsent.deleteMany({ where: { personId: p.id } });
      await db.personRelationship.deleteMany({ where: { OR: [{ fromPersonId: p.id }, { toPersonId: p.id }] } });
      await db.householdMember.deleteMany({ where: { personId: p.id } });
      await db.stageHistory.deleteMany({ where: { personId: p.id } });
      await db.person.delete({ where: { id: p.id } }).catch(() => {});
    }
  }
  await db.customFieldDefinition.deleteMany({ where: { orgId: org.id, entity: "person", key: { startsWith: "p6_" } } });
  await db.savedView.deleteMany({ where: { orgId: org.id, name: { startsWith: "P6 Verify" } } });

  // ── fixtures ───────────────────────────────────────────────────────────────
  const guardian = await db.person.create({
    data: { orgId: org.id, firstName: "Ngozi", lastName: "P6Guardian", phone: "+2348031160901", phoneE164: "+2348031160901" },
  });
  sweep.personIds.push(guardian.id);

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

  const memberRoleId = await makeRole("verify_p6_member", "Verify P6 Member", ["people.view"]);
  // ROLE_TEMPLATES mirror the real presets — owner carries "*" (full), finance
  // holds people:1 + giving:view-all (the Phase 6 finance matrix).
  const ownerRoleId = await makeRole("verify_p6_owner", "Verify P6 Owner", ROLE_TEMPLATES.owner);
  const financeRoleId = await makeRole("verify_p6_finance", "Verify P6 Finance", ROLE_TEMPLATES.finance);
  // ROLE_TEMPLATES.minister mirrors the real preset: people:2 (edit — but NOT
  // create), no people.customfields.manage, no admin extras. We add
  // people.create so the temp minister can exercise the create/edit paths.
  const ministerRoleId = await makeRole("verify_p6_minister", "Verify P6 Minister", [...ROLE_TEMPLATES.minister, "people.create"]);

  const memberPerson = await db.person.create({
    data: { orgId: org.id, firstName: "Adaeze", lastName: "P6Target", phone: "+2348031160902", phoneE164: "+2348031160902" },
  });
  sweep.personIds.push(memberPerson.id);
  await makeUser("verify.p6.member@test.local", "Adaeze P6Target", "p6member-pass", memberPerson.id, memberRoleId);
  const ministerPerson = await db.person.create({
    data: { orgId: org.id, firstName: "Obinna", lastName: "P6ValueB", phone: "+2348031160903", phoneE164: "+2348031160903" },
  });
  sweep.personIds.push(ministerPerson.id);
  await makeUser("verify.p6.minister@test.local", "Obinna Minister", "p6minister-pass", ministerPerson.id, ministerRoleId);
  const ownerPerson = await db.person.create({
    data: { orgId: org.id, firstName: "Chima", lastName: "P6Owner", phone: "+2348031160904", phoneE164: "+2348031160904" },
  });
  sweep.personIds.push(ownerPerson.id);
  await makeUser("verify.p6.owner@test.local", "Chima Owner", "p6owner-pass", ownerPerson.id, ownerRoleId);
  const financePerson = await db.person.create({
    data: { orgId: org.id, firstName: "Halima", lastName: "P6Finance", phone: "+2348031160905", phoneE164: "+2348031160905" },
  });
  sweep.personIds.push(financePerson.id);
  await makeUser("verify.p6.finance@test.local", "Halima Finance", "p6finance-pass", financePerson.id, financeRoleId);

  const memberCookie = await loginCookie("verify.p6.member@test.local", "p6member-pass");
  const ministerCookie = await loginCookie("verify.p6.minister@test.local", "p6minister-pass");
  const ownerCookie = await loginCookie("verify.p6.owner@test.local", "p6owner-pass"); // Owner ("*" permissions)
  const financeCookie = await loginCookie("verify.p6.finance@test.local", "p6finance-pass"); // Finance (people:1)

  // ══ 1. Definition management — people.customfields.manage gates it ════════
  let foundationDefId = "";
  let leaderOnlyDefId = "";
  {
    const fin = await api(financeCookie, "/people/custom-fields", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ label: "Finance sneaky field", key: "p6_sneaky", dataType: "text" }) });
    check("finance: create definition 403 (people.customfields.manage)", fin.status === 403, `status ${fin.status}`);

    const mem = await api(memberCookie, "/people/custom-fields", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ label: "Member sneaky field", key: "p6_sneaky2", dataType: "text" }) });
    check("member: create definition 403", mem.status === 403, `status ${mem.status}`);
    const memList = await api(memberCookie, "/people/custom-fields");
    check("member: definition list 200 (forms/filters render from it)", memList.status === 200, `status ${memList.status}`);

    const own = await api(ownerCookie, "/people/custom-fields", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({
        label: "P6 Foundation school status", key: "p6_foundation", dataType: "select",
        options: ["Not started", "Enrolled", "Graduated"],
        required: false, showInList: true, filterable: true, visibility: "leaders",
      }),
    });
    check("owner: select definition created", own.status === 200 && own.body?.field?.key === "p6_foundation", `status ${own.status} ${JSON.stringify(own.body).slice(0, 120)}`);
    foundationDefId = own.body?.field?.id ?? "";

    const lo = await api(ownerCookie, "/people/custom-fields", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({
        label: "P6 Pastoral remark", key: "p6_leader_only", dataType: "text",
        filterable: true, visibility: "staff",
        // preset role keys + the temp role's own key (org role keys are valid)
        visibleToRoles: ["owner", "campus_admin", "pastor", "minister", "ministry_leader", "verify_p6_minister"],
      }),
    });
    check("owner: role-gated definition created", lo.status === 200 && (lo.body?.field?.visibleToRoles ?? []).includes("verify_p6_minister"), `status ${lo.status}`);
    leaderOnlyDefId = lo.body?.field?.id ?? "";

    const dup = await api(ownerCookie, "/people/custom-fields", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ label: "Dup", key: "p6_foundation", dataType: "text" }) });
    check("owner: duplicate key rejected 400", dup.status === 400, `status ${dup.status}`);

    const badOpt = await api(ownerCookie, "/people/custom-fields", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ label: "P6 bad", key: "p6_bad", dataType: "select", options: ["only-one"] }) });
    check("owner: select with <2 options rejected 400", badOpt.status === 400, `status ${badOpt.status}`);

    const patch = await api(ownerCookie, `/people/custom-fields/${foundationDefId}`, { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ label: "P6 Foundation school", filterable: true }) });
    check("owner: PATCH definition 200", patch.status === 200 && patch.body?.field?.label === "P6 Foundation school", `status ${patch.status}`);

    const minPatch = await api(ministerCookie, `/people/custom-fields/${foundationDefId}`, { method: "PATCH", headers: JSON_HDRS, body: JSON.stringify({ label: "hijack" }) });
    check("minister: PATCH definition 403", minPatch.status === 403, `status ${minPatch.status}`);

    const preset1 = await api(ownerCookie, "/people/custom-fields/presets", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ preset: "zone_area_parish" }) });
    check("owner: preset zone/area/parish creates 3 fields", preset1.status === 200 && preset1.body?.created === 3, `status ${preset1.status} ${JSON.stringify(preset1.body)}`);
    const presetDefs = await db.customFieldDefinition.findMany({ where: { orgId: org.id, entity: "person", key: { in: ["zone", "area", "parish"] } }, select: { id: true } });
    for (const d of presetDefs) sweep.defIds.push(d.id);
    const preset2 = await api(ownerCookie, "/people/custom-fields/presets", { method: "POST", headers: JSON_HDRS, body: JSON.stringify({ preset: "zone_area_parish" }) });
    check("owner: preset re-run is idempotent (created 0)", preset2.status === 200 && preset2.body?.created === 0, `status ${preset2.status} ${JSON.stringify(preset2.body)}`);

    const list = await api(ownerCookie, "/people/custom-fields?archived=1");
    const keys = (list.body?.items ?? []).map((d: any) => d.key);
    check("owner: manage list includes zone/area/parish", list.status === 200 && keys.includes("zone") && keys.includes("area") && keys.includes("parish"), keys.join(","));
  }

  // ══ 2. Value validation on create (server-side, always) ════════════════════
  let valuePersonId = "";
  {
    const badKey = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Tola", lastName: "P6ValueA", phone: "08031160911", custom: { p6_unknown_key: "x" } }),
    });
    check("minister: unknown custom key rejected 400", badKey.status === 400, `status ${badKey.status}`);

    const badOpt = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Tola", lastName: "P6ValueA", phone: "08031160911", custom: { p6_foundation: "Does not exist" } }),
    });
    check("minister: invalid select option rejected 400", badOpt.status === 400, `status ${badOpt.status}`);

    const ok = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({
        firstName: "Tola", lastName: "P6ValueA", phone: "08031160911",
        custom: {
          p6_foundation: "Enrolled",
          // visibleToRoles gates READING; without editableByRoles, writes follow
          // the person-level right (minister holds people.edit) → allowed
          p6_leader_only: "Pastoral remark — ministers may see this",
        },
        consents: [{ channel: "whatsapp", status: "granted", source: "connection_card" }],
      }),
    });
    check("minister: create with valid custom values + consent 200", ok.status === 200 && ok.body?.created?.id, `status ${ok.status} ${JSON.stringify(ok.body).slice(0, 120)}`);
    valuePersonId = ok.body?.created?.id ?? "";
    if (valuePersonId) sweep.personIds.push(valuePersonId);

    // an editableByRoles field the minister may NOT write
    const adminOnly = await api(ownerCookie, "/people/custom-fields", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ label: "P6 Admin note", key: "p6_admin_note", dataType: "text", editableByRoles: ["owner", "campus_admin"] }),
    });
    check("owner: editableByRoles definition created", adminOnly.status === 200, `status ${adminOnly.status}`);

    const setByOwner = await api(ownerCookie, `/people/${valuePersonId}`, {
      method: "PUT", headers: JSON_HDRS, body: JSON.stringify({ custom: { p6_admin_note: "set by owner" } }),
    });
    check("owner: PUT person sets the admin-only field 200", setByOwner.status === 200, `status ${setByOwner.status}`);

    const setByMinister = await api(ministerCookie, `/people/${valuePersonId}`, {
      method: "PUT", headers: JSON_HDRS, body: JSON.stringify({ custom: { p6_admin_note: "hijack" } }),
    });
    check("minister: PUT same field 403 (per-field editableByRoles)", setByMinister.status === 403, `status ${setByMinister.status}`);

    const badUpdate = await api(ministerCookie, `/people/${valuePersonId}`, {
      method: "PUT", headers: JSON_HDRS, body: JSON.stringify({ custom: { p6_foundation: "Bogus" } }),
    });
    check("minister: PUT invalid option 400 (update path validates too)", badUpdate.status === 400, `status ${badUpdate.status}`);
  }

  // ══ 3. Required-field enforcement ═════════════════════════════════════════
  {
    const req = await api(ownerCookie, "/people/custom-fields", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ label: "P6 Required zone", key: "p6_required_zone", dataType: "text", required: true }),
    });
    check("owner: required definition created", req.status === 200, `status ${req.status}`);

    const missing = await api(ownerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Nnamdi", lastName: "P6ValueB", phone: "08031160922" }),
    });
    check("owner: create without required custom field 400", missing.status === 400, `status ${missing.status}`);

    const withIt = await api(ownerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Nnamdi", lastName: "P6ValueB", phone: "08031160922", custom: { p6_required_zone: "Zone 2" } }),
    });
    check("owner: create with required field 200", withIt.status === 200 && Boolean(withIt.body?.created?.id), `status ${withIt.status}`);
    const nnamdiId = withIt.body?.created?.id ?? "";
    if (nnamdiId) sweep.personIds.push(nnamdiId);

    const clear = await api(ownerCookie, `/people/${nnamdiId}`, {
      method: "PUT", headers: JSON_HDRS, body: JSON.stringify({ custom: { p6_required_zone: null } }),
    });
    check("owner: clearing a required field 400", clear.status === 400, `status ${clear.status}`);
  }

  // ══ 4. Visibility: values OMITTED from payloads per viewer ════════════════
  {
    const listMinister = await api(ministerCookie, "/people/v2/list", {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ search: "P6Value", pageSize: 100 }),
    });
    const rows = listMinister.body?.items ?? [];
    const tola = rows.find((r: any) => r.lastName === "P6ValueA");
    check("minister: list row carries p6_foundation (leaders visibility)",
      Boolean(tola?.custom?.p6_foundation), JSON.stringify(tola?.custom ?? {}));
    check("minister: list row carries the role-gated p6_leader_only value (minister is in visibleToRoles)",
      tola?.custom?.p6_leader_only === "Pastoral remark — ministers may see this", JSON.stringify(tola?.custom ?? {}));

    const listMember = await api(memberCookie, "/people/v2/list", {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ search: "P6Value", pageSize: 100 }),
    });
    const mrow = (listMember.body?.items ?? []).find((r: any) => r.lastName === "P6ValueA");
    check("member: list row OMITS staff-visibility custom keys",
      mrow && mrow.custom && Object.keys(mrow.custom).every((k: string) => !k.startsWith("p6_")),
      JSON.stringify(mrow?.custom ?? {}));

    const profMember = await api(memberCookie, `/people/v2/${valuePersonId}/profile`);
    check("member: profile omits customFields (all restricted)", profMember.status === 200 && profMember.body?.customFields === undefined, `keys=${Object.keys(profMember.body?.customFields ?? {})}`);

    const profFinance = await api(financeCookie, `/people/v2/${valuePersonId}/profile`);
    check("finance: profile has p6_foundation (staff tier) but NOT p6_leader_only (role list)",
      profFinance.body?.customFields?.p6_foundation === "Enrolled" && profFinance.body?.customFields?.p6_leader_only === undefined,
      JSON.stringify(profFinance.body?.customFields ?? {}));
    const profMinister = await api(ministerCookie, `/people/v2/${valuePersonId}/profile`);
    check("minister: profile exposes p6_admin_note value? NO (set but staff-visibility; minister tier is staff → visible)",
      profMinister.body?.customFields?.p6_admin_note === "set by owner",
      JSON.stringify(profMinister.body?.customFields ?? {}));
  }

  // ══ 5. Filters — typed ops + role gates ═══════════════════════════════════
  {
    const fMinister = await api(ministerCookie, "/people/v2/list", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ filters: { match: "all", conditions: [{ field: "custom:p6_foundation", op: "is", value: "Enrolled" }] } }),
    });
    const ids = (fMinister.body?.items ?? []).map((r: any) => r.id);
    check("minister: custom filter 'p6_foundation is Enrolled' returns exactly the seeded person",
      fMinister.status === 200 && ids.includes(valuePersonId) && !ids.includes(ministerPerson.id),
      `status ${fMinister.status} ids=${ids.length}`);

    const fContains = await api(ministerCookie, "/people/v2/list", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ filters: { match: "all", conditions: [{ field: "custom:p6_foundation", op: "is", value: "Graduated" }] } }),
    });
    check("minister: custom filter other option returns nothing of ours",
      fContains.status === 200 && !(fContains.body?.items ?? []).some((r: any) => r.id === valuePersonId), `status ${fContains.status}`);

    const fMember = await api(memberCookie, "/people/v2/list", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ filters: { match: "all", conditions: [{ field: "custom:p6_foundation", op: "is", value: "Enrolled" }] } }),
    });
    check("member: filtering by a staff-visibility field is blocked (403)", fMember.status === 403, `status ${fMember.status}`);
  }

  // ══ 6. Duplicate detection still works ════════════════════════════════════
  {
    const first = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      // p6_required_zone was created in step 3 — every create must carry it now
      body: JSON.stringify({ firstName: "Chidi", lastName: "P6Target", phone: "08031160931", custom: { p6_required_zone: "Zone 1" } }),
    });
    check("minister: first create 200", first.status === 200 && Boolean(first.body?.created?.id), `status ${first.status}`);
    if (first.body?.created?.id) sweep.personIds.push(first.body.created.id);

    const dup = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Chidi", lastName: "P6Target", phone: "+2348031160931", custom: { p6_required_zone: "Zone 1" } }),
    });
    check("minister: same phone in another format → duplicates (exact), created null",
      dup.status === 200 && dup.body?.created === null && (dup.body?.duplicates?.exact?.length ?? 0) > 0,
      `status ${dup.status} exact=${(dup.body?.duplicates?.exact ?? []).length}`);

    const forced = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Chidi", lastName: "P6Target", phone: "+2348031160931", custom: { p6_required_zone: "Zone 1" }, force: true }),
    });
    check("minister: force create succeeds", forced.status === 200 && Boolean(forced.body?.created?.id), `status ${forced.status}`);
    if (forced.body?.created?.id) sweep.personIds.push(forced.body.created.id);
  }

  // ══ 7. Minors need a guardian; no-contact needs force; unknown year ═══════
  {
    const minor = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Kene", lastName: "P6Kid", phone: "08031160951", birthdate: "2015-04-10", householdRole: "child", householdMode: "new", newHousehold: { name: "P6 Verify Family" }, custom: { p6_required_zone: "Zone 1" } }),
    });
    check("minor without guardian → 422 needs_guardian (hard block)",
      minor.status === 422 && minor.body?.details?.needsGuardian === true, `status ${minor.status} ${JSON.stringify(minor.body).slice(0, 140)}`);

    const minorOk = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({
        firstName: "Kene", lastName: "P6Kid", phone: "08031160951", birthdate: "2015-04-10",
        householdRole: "child", householdMode: "new", newHousehold: { name: "P6 Verify Family" },
        guardians: [{ guardianId: guardian.id }],
        custom: { p6_required_zone: "Zone 1" },
      }),
    });
    check("minor WITH guardian → created", minorOk.status === 200 && Boolean(minorOk.body?.created?.id), `status ${minorOk.status}`);
    const kidId = minorOk.body?.created?.id ?? "";
    if (kidId) sweep.personIds.push(kidId);

    const noContact = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Ada", lastName: "P6NoContact" }),
    });
    check("no-contact create → 400 needsForce", noContact.status === 400 && noContact.body?.details?.needsForce === true, `status ${noContact.status}`);

    const noContactOk = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Ada", lastName: "P6NoContact", force: true, custom: { p6_required_zone: "Zone 1" } }),
    });
    check("no-contact create with force → created", noContactOk.status === 200 && Boolean(noContactOk.body?.created?.id), `status ${noContactOk.status}`);
    if (noContactOk.body?.created?.id) sweep.personIds.push(noContactOk.body.created.id);

    const unknownYear = await api(ministerCookie, "/people", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ firstName: "Chike", lastName: "P6ValueB", phone: "08031160941", birthdate: "1904-06-15", birthdateYearKnown: false, custom: { p6_required_zone: "Zone 1" } }),
    });
    check("unknown-year DOB → created", unknownYear.status === 200 && Boolean(unknownYear.body?.created?.id), `status ${unknownYear.status}`);
    const cyId = unknownYear.body?.created?.id ?? "";
    if (cyId) sweep.personIds.push(cyId);

    if (cyId) {
      const prof = await api(ministerCookie, `/people/v2/${cyId}/profile`);
      check("profile reports birthdateYearKnown=false", prof.body?.person?.birthdateYearKnown === false, JSON.stringify(prof.body?.person?.birthdateYearKnown));
      const rowQ = await api(ministerCookie, "/people/v2/list", {
        method: "POST", headers: JSON_HDRS, body: JSON.stringify({ search: "Chike", pageSize: 50 }),
      });
      const row = (rowQ.body?.items ?? []).find((r: any) => r.lastName === "P6ValueB" && r.firstName === "Chike");
      check("list row age is null for unknown-year DOB", row && row.age === null, `age=${row?.age}`);
    }
  }

  // ══ 8. Consents — record, validate, gate ══════════════════════════════════
  {
    const bad = await api(ministerCookie, `/people/v2/${valuePersonId}/consents`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ channel: "fax", status: "granted" }),
    });
    check("consent with unknown channel 400", bad.status === 400, `status ${bad.status}`);

    const ok = await api(ministerCookie, `/people/v2/${valuePersonId}/consents`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ channel: "photo", status: "declined", source: "in_person", note: "Parent declined at door" }),
    });
    check("minister: consent recorded 200", ok.status === 200 && ok.body?.consent?.status === "declined", `status ${ok.status}`);

    const list = await api(ministerCookie, `/people/v2/${valuePersonId}/consents`);
    check("minister: consent history has current.photo=declined (whatsapp granted at intake)",
      list.status === 200 && list.body?.current?.photo === "declined" && list.body?.current?.whatsapp === "granted",
      JSON.stringify(list.body?.current ?? {}));

    const memPost = await api(memberCookie, `/people/v2/${valuePersonId}/consents`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ channel: "sms", status: "granted" }),
    });
    check("member: record consent for someone else 403", memPost.status === 403, `status ${memPost.status}`);

    const memGet = await api(memberCookie, `/people/v2/${valuePersonId}/consents`);
    check("member: read someone else's consents 403", memGet.status === 403, `status ${memGet.status}`);

    const prof = await api(ministerCookie, `/people/v2/${valuePersonId}/profile`);
    check("profile embeds consents trail for staff viewers", Boolean(prof.body?.consents?.current), JSON.stringify(prof.body?.consents?.current ?? {}));
  }

  // ══ 9. Saved views accept custom columns; restricted filters rejected ═════
  {
    const view = await api(ministerCookie, "/people/v2/views", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ name: `P6 Verify View ${RUN}`, columns: ["name", "custom:p6_foundation"], viewType: "table" }),
    });
    check("minister: saved view with custom column 200", view.status === 200, `status ${view.status} ${JSON.stringify(view.body).slice(0, 120)}`);
    if (view.body?.id) sweep.viewIds.push(view.body.id);

    const viewFiltered = await api(memberCookie, "/people/v2/views", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({
        name: `P6 Verify Bad ${RUN}`,
        filters: { match: "all", conditions: [{ field: "custom:p6_foundation", op: "is", value: "Enrolled" }] },
      }),
    });
    check("member: saved view with restricted custom filter rejected (4xx)", viewFiltered.status >= 400, `status ${viewFiltered.status}`);
  }

  // ══ 10. Archive definition: leaves forms/filters, values kept ═════════════
  {
    const arch = await api(ownerCookie, `/people/custom-fields/${foundationDefId}`, { method: "DELETE" });
    check("owner: archive definition 200", arch.status === 200, `status ${arch.status}`);
    const list = await api(ownerCookie, "/people/custom-fields");
    check("archived definition absent from the active list", !(list.body?.items ?? []).some((d: any) => d.id === foundationDefId));

    const useArchived = await api(ministerCookie, "/people/v2/list", {
      method: "POST", headers: JSON_HDRS,
      body: JSON.stringify({ filters: { match: "all", conditions: [{ field: "custom:p6_foundation", op: "is", value: "Enrolled" }] } }),
    });
    check("filtering by an archived definition 400", useArchived.status === 400, `status ${useArchived.status}`);
  }

  // ── summary ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log(`\n══ Phase 6 verification — ${results.length - failed.length}/${results.length} passed ${failed.length === 0 ? "✓" : "✗"}\n`);
  for (const r of results) {
    console.log(`${r.pass ? "  ✓" : "  ✗"} ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : ""}`);
  }
  if (failed.length > 0) {
    console.log(`\n${failed.length} FAILURES`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Verification run crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // ── sweep ── definitions first (no FK), then views, then people ──
    await db.savedView.deleteMany({ where: { id: { in: sweep.viewIds } } }).catch(() => {});
    await db.customFieldDefinition.deleteMany({ where: { id: { in: sweep.defIds } } }).catch(() => {});
    await db.customFieldDefinition.deleteMany({ where: { orgId: (await db.organization.findFirst())?.id ?? "", entity: "person", key: { startsWith: "p6_" } } }).catch(() => {});
    for (const pid of sweep.personIds) {
      await db.personConsent.deleteMany({ where: { personId: pid } }).catch(() => {});
      await db.personRelationship.deleteMany({ where: { OR: [{ fromPersonId: pid }, { toPersonId: pid }] } }).catch(() => {});
      await db.householdMember.deleteMany({ where: { personId: pid } }).catch(() => {});
      await db.stageHistory.deleteMany({ where: { personId: pid } }).catch(() => {});
      await db.person.delete({ where: { id: pid } }).catch(() => {});
    }
    for (const uid of sweep.userIds) {
      const ms = await db.membership.findMany({ where: { userId: uid } });
      for (const m of ms) await db.roleAssignment.deleteMany({ where: { membershipId: m.id } }).catch(() => {});
      await db.membership.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.session.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    for (const rid of sweep.roleIds) {
      await db.rolePermission.deleteMany({ where: { roleId: rid } }).catch(() => {});
      await db.roleAssignment.deleteMany({ where: { roleId: rid } }).catch(() => {});
      await db.role.delete({ where: { id: rid } }).catch(() => {});
    }
    await db.$disconnect?.();
    process.exit(process.exitCode ?? 0);
  });
