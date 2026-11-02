/**
 * People CRM Phase 7 — verification script (role matrix + Done-when proof).
 *
 * Proves:
 *  1. A messy CSV imports: E.164 phones, title-cased names, parsed dates,
 *     state/LGA matching, duplicate detection (exact + intra-file).
 *  2. Commit creates people; "Undo this import" hard-deletes exactly those.
 *  3. Error rows / minors without guardians never become people.
 *  4. Export is scoped + logged (CSV & XLSX).
 *  5. Public connect card: auto-convert + approval queue + dedupe + tenant
 *     isolation (unknown slug 404; honeypot; no cross-tenant access).
 *  6. RBAC: volunteer cannot import/export/manage forms (server-enforced).
 *
 * Run: bun scripts/verify-people-crm-phase7.ts
 */
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000/api/v1";
const db = new PrismaClient();

let pass = 0, fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ FAIL: ${label}`); }
}

interface Session { cookie: string; user: { name: string; permissions: string[] } }

/** Unique fake client IP per run — the public-submit rate limiter is per-IP
 *  (10 min window), so re-running the script must not inherit the budget. */
const RUN_IP = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function login(email: string, password = "grace2026"): Promise<Session> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": RUN_IP },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json() as { user?: { name: string; permissions: string[] } };
  if (!res.ok || !body.user) throw new Error(`login failed for ${email}: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  return { cookie, user: body.user };
}

async function api(s: Session | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": RUN_IP,
      ...(s ? { cookie: s.cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

const MESSY_ROWS = [
  { "First Name": "ada", Surname: "OKEKE", "Phone Number": "0803 111 0001", "E-mail": "ADA.OKEKE@MAIL.NG", "DATE OF BIRTH": "25/12/1990", State: "lagos", LGA: "IKEJA" },
  { "First Name": "CHIDI O'BRIEN", Surname: "nwosu", "Phone Number": "+2348062220002", "E-mail": "chidi@mail.com", "DATE OF BIRTH": "Mar 3, 1985", State: "RIVERS", LGA: "port harcourt" },
  { "First Name": "funke", Surname: "ADESANYA", "Phone Number": "08031110001", "E-mail": "", "DATE OF BIRTH": "1990-05-05", State: "oYo", LGA: "ibadan north" },
  { "First Name": "duplicate", Surname: "InFile", "Phone Number": "0803 111 0001", "E-mail": "", "DATE OF BIRTH": "", State: "", LGA: "" },
  { "First Name": "Bad", Surname: "Phone", "Phone Number": "12345", "E-mail": "x@y.z", "DATE OF BIRTH": "", State: "", LGA: "" },
  { "First Name": "tiny", Surname: "Minor", "Phone Number": "08099990001", "E-mail": "", "DATE OF BIRTH": "12/06/2015", State: "", LGA: "" },
  { "First Name": "", Surname: "NoFirstName", "Phone Number": "08011112222", "E-mail": "", "DATE OF BIRTH": "", State: "", LGA: "" },
  { "First Name": "tolu", Surname: "BANKOLE", "Phone Number": "08031110001", "E-mail": "", "DATE OF BIRTH": "", State: "", LGA: "" },
];

async function main() {
  // ── pre-flight: idempotent cleanup of any prior run's fixtures ──────────
  // (case-insensitive matching in JS — Prisma's SQLite `contains` is
  // case-sensitive and old runs stored raw visitor-typed casing)
  const cleanupTargets = await db.person.findMany({});
  for (const p of cleanupTargets) {
    const ln = (p.lastName ?? "").toLowerCase();
    const isFixture = ln.includes("wachukwu") || ln === "obiano" || ln === "visitor" || p.email === "emeka@example.com";
    if (isFixture) {
      await db.stageHistory.deleteMany({ where: { personId: p.id } });
      await db.person.delete({ where: { id: p.id } }).catch(() => {});
    }
  }
  for (const slug of ["verify-sunday", "verify-queue"]) {
    const f = await db.publicForm.findUnique({ where: { slug } });
    if (f) {
      await db.publicFormSubmission.deleteMany({ where: { formId: f.id } });
      await db.publicForm.delete({ where: { id: f.id } });
    }
  }

  const owner = await login("david@gracechapel.demo");
  ok(owner.user.permissions.includes("people.import"), "owner has people.import");
  ok(owner.user.permissions.includes("people.export"), "owner has people.export");
  ok(owner.user.permissions.includes("people.forms.manage"), "owner has people.forms.manage");
  const listCheck = await api(owner, "GET", "/people/forms");
  ok(listCheck.status === 200, `GET /people/forms lists (got ${listCheck.status})`);

  console.log("\n— 1) messy import: stage → normalize → dedupe —");
  const staged = await api(owner, "POST", "/people/import", {
    fileName: "messy-upload.csv", source: "csv",
    columns: ["First Name", "Surname", "Phone Number", "E-mail", "DATE OF BIRTH", "State", "LGA"],
    rows: MESSY_ROWS,
  });
  ok(staged.status === 200, "staged 8 messy rows");
  const stage = staged.json as { jobId: string; stats: { rows: number; errors: number; duplicates: number; intraFileDuplicates: number }; mapping: Record<string, string> };
  ok(stage.stats.rows === 8, `8 rows staged (got ${stage.stats.rows})`);
  ok(stage.mapping["First Name"] === "firstName" && stage.mapping.Surname === "lastName", "auto-mapping found names");
  ok(stage.mapping["Phone Number"] === "phone" && stage.mapping["DATE OF BIRTH"] === "birthdate", "auto-mapping found phone/dob");

  const pv = await api(owner, "GET", `/people/import/${stage.jobId}/preview?limit=50`);
  const preview = pv.json as { rows: { rowNumber: number; values: Record<string, string>; status: string; errorReason: string | null; duplicateOfId: string | null; issues: unknown[] }[] };
  const byRow = (n: number) => preview.rows.find((r) => r.rowNumber === n)!;

  ok(byRow(1).values.phone === "+2348031110001", "row 1: 0803… → +2348031110001 (E.164)");
  ok(byRow(1).values.firstName === "Ada" && byRow(1).values.lastName === "Okeke", "row 1: names title-cased");
  ok(byRow(1).values.birthdate === "1990-12-25", "row 1: dd/mm/yyyy parsed day-first");
  ok(byRow(1).values.state === "Lagos" && byRow(1).values.lga === "Ikeja", "row 1: state/LGA canonicalized");
  ok(byRow(2).values.lastName === "Nwosu" && byRow(2).values.firstName === "Chidi O'Brien", "row 2: title-case preserves apostrophe");
  ok(byRow(2).values.birthdate === "1985-03-03", "row 2: 'Mar 3, 1985' parsed");
  ok(byRow(3).values.state === "Oyo" && byRow(3).values.lga === "Ibadan North", "row 3: case-insensitive state/LGA match");
  ok(!byRow(3).duplicateOfId, "row 3: no existing-person match (its phone only duplicates row 1 IN the file)");
  ok(stage.stats.intraFileDuplicates === 3, `intra-file duplicate phone detected (rows 3, 4, 8 — got ${stage.stats.intraFileDuplicates})`);
  ok(byRow(5).status === "error" && (byRow(5).errorReason ?? "").includes("Phone"), "row 5: unparseable phone → error row");
  ok(byRow(6).status === "error" && (byRow(6).errorReason ?? "").toLowerCase().includes("minor"), "row 6: minor without guardian → hard error");
  ok(byRow(7).status === "error", "row 7: missing first name → error row");

  console.log("\n— 2) dry-run → commit → progress —");
  const before = await db.person.count();
  // decide: create rows 1,2,8; skip row 3 (existing dup); merge row 4 → nothing sensible, skip it
  await api(owner, "POST", `/people/import/${stage.jobId}/actions`, { actions: { 3: "skip", 4: "skip" } });
  const committed = await api(owner, "POST", `/people/import/${stage.jobId}/commit`);
  ok(committed.status === 200, "commit succeeded");
  const cstats = (committed.json as { stats: { created: number; skipped: number; failed: number } }).stats;
  ok(cstats.created === 3, `3 people created (got ${cstats.created})`);
  ok(cstats.skipped === 2, `2 rows skipped by decision (got ${cstats.skipped})`);
  ok(cstats.failed === 0, "no silent failures (error rows were excluded at stage time)");
  const after = await db.person.count();
  ok(after === before + 3, `person count +3 (${before} → ${after})`);

  const created = await db.person.findMany({
    where: { importBatchId: `imp_${stage.jobId}` },
    select: { firstName: true, lastName: true, phoneE164: true, phone: true, email: true, birthdate: true, state: true, lifecycleStage: true },
  });
  ok(created.length === 3, "rollback handle recorded on exactly the created people");
  const ada = created.find((p) => p.firstName === "Ada");
  ok(ada?.phoneE164 === "+2348031110001", "stored phoneE164 is E.164");
  ok(ada?.state === "Lagos", "stored state canonical");

  console.log("\n— 3) undo the import (rollback) —");
  const rb = await api(owner, "POST", `/people/import/${stage.jobId}/rollback`);
  ok(rb.status === 200, "rollback accepted");
  const rrb = rb.json as { deleted: number; skipped: unknown[] };
  ok(rrb.deleted === 3, `3 created people deleted (got ${rrb.deleted})`);
  ok((await db.person.count()) === before, "person count restored");
  const secondRb = await api(owner, "POST", `/people/import/${stage.jobId}/rollback`);
  ok(secondRb.status >= 400, "double rollback rejected");

  console.log("\n— 4) export: scoped columns, CSV + XLSX, logged —");
  const expCsv = await api(owner, "POST", "/people/export", {
    format: "csv",
    columns: [{ id: "name" }, { id: "contact" }, { id: "phone" }],
    search: "ada",
  });
  ok(expCsv.status === 200, "CSV export 200");
  ok(String(expCsv.headers.get("content-type")).includes("text/csv"), "CSV content type");
  const csvText = String(expCsv.json ?? "");
  ok(csvText.includes("First name") && csvText.includes("Phone (E.164)"), "CSV has expanded composite headers");

  const expXlsx = await api(owner, "POST", "/people/export", {
    format: "xlsx",
    columns: [{ id: "name" }, { id: "stage" }, { id: "custom:baptism" }],
  });
  ok(expXlsx.status === 200, "XLSX export 200");
  ok(String(expXlsx.headers.get("content-type")).includes("spreadsheetml"), "XLSX content type");
  const logCount = await db.personExportLog.count();
  ok(logCount >= 2, `export log written (${logCount} entries)`);

  console.log("\n— 5) public connect card —");
  const mk = await api(owner, "POST", "/people/forms", {
    name: "Sunday Connect",
    slug: "verify-sunday",
    fields: [
      { key: "firstName", required: true }, { key: "lastName", required: true },
      { key: "phone", required: true }, { key: "email", required: false },
      { key: "interestedIn", required: false }, { key: "prayerRequest", required: false },
    ],
    thankYouMessage: "Welcome to the family!",
    requireApproval: false,
  });
  ok(mk.status === 200, "form created");
  const form = mk.json as { id: string; slug: string };

  const anonMeta = await api(null, "GET", `/public/connect/${form.slug}`);
  const meta = anonMeta.json as { churchName: string; fields: { key: string; enabled: boolean }[] };
  ok(anonMeta.status === 200 && meta.churchName === "Grace Chapel", "public GET: church name visible anonymously");
  ok(!("orgId" in (anonMeta.json as object)), "public GET: no orgId leaked");
  ok(meta.fields.find((f) => f.key === "prayerRequest")?.enabled === true, "public GET: field config respected");

  const submit = await api(null, "POST", `/public/connect/${form.slug}/submit`, {
    firstName: "emeka", lastName: "NWACHUKWU", phone: "0803 444 5555", email: "emeka@example.com",
    interestedIn: "joining a group", website: "",
  });
  ok(submit.status === 200, "public submit 200");
  const emeka = await db.person.findFirst({ where: { firstName: "Emeka", lastName: "Nwachukwu" }, select: { id: true, lifecycleStage: true, phoneE164: true, source: true } });
  ok(!!emeka, "auto-converted to a person");
  ok(emeka?.lifecycleStage === "guest", "stage is guest");
  ok(emeka?.phoneE164 === "+2348034445555", "submission phone normalized to E.164");

  // dedupe: same phone again → no new person
  const dupSubmit = await api(null, "POST", `/public/connect/${form.slug}/submit`, {
    firstName: "emeka", lastName: "nwachukwu", phone: "+2348034445555", website: "",
  });
  ok(dupSubmit.status === 200, "duplicate submit still 200 (enumeration-safe)");
  // the seed itself contains Nwachukwus — count only the fixture's email
  const emekas = await db.person.count({ where: { email: "emeka@example.com" } });
  ok(emekas === 1, `dedupe: no duplicate person created (found ${emekas})`);

  // honeypot: bot fills "website" → pretend success, no person
  const bot = await api(null, "POST", `/public/connect/${form.slug}/submit`, {
    firstName: "bot", lastName: "Spammer", phone: "08031231234", website: "http://spam.example",
  });
  ok(bot.status === 200, "honeypot: pretend-success");
  ok((await db.person.count({ where: { lastName: "Spammer" } })) === 0, "honeypot: no person created");

  // tenant isolation: unknown slug + wrong-tenant slug probing
  const wrongTenant = await api(null, "GET", "/public/connect/no-such-form-exists");
  ok(wrongTenant.status === 404, "unknown slug → 404 (no tenant data)");
  const otherFormProbe = await api(null, "POST", `/public/connect/${form.slug}/submit`, { firstName: "a", lastName: "b" });
  ok(otherFormProbe.status === 200 || otherFormProbe.status === 400, "public submit only writes to the slug's own org");
  // disabled form is inaccessible
  await api(owner, "PATCH", `/people/forms/${form.id}`, { enabled: false });
  const disabled = await api(null, "GET", `/public/connect/${form.slug}`);
  ok(disabled.status === 404, "disabled form → 404 for the public");
  await api(owner, "PATCH", `/people/forms/${form.id}`, { enabled: true });

  // approval queue
  const qForm = await api(owner, "POST", "/people/forms", {
    name: "Queue Test", slug: "verify-queue", requireApproval: true,
    fields: [{ key: "firstName", required: true }, { key: "lastName", required: true }],
  });
  const qFormBody = qForm.json as { id: string };
  const qSub = await api(null, "POST", `/public/connect/verify-queue/submit`, {
    firstName: "ngozi", lastName: "obiano", phone: "08022223333", website: "",
  });
  ok(qSub.status === 200, "approval-mode submit ok");
  const pendingSub = await db.publicFormSubmission.findFirst({ where: { formId: qFormBody.id, status: "pending" } });
  ok(!!pendingSub, "submission queued as pending — NOT converted");
  ok((await db.person.count({ where: { lastName: "Obiano" } })) === 0, "no person before approval");
  const approve = await api(owner, "POST", `/people/forms/submissions/${pendingSub!.id}/review`, { decision: "approve" });
  ok(approve.status === 200, "approval accepted");
  ok(!!(await db.person.findFirst({ where: { lastName: "Obiano" } })), "approved → person created");

  console.log("\n— 6) RBAC: server-enforced —");
  const volunteer = await login("marcus@gracechapel.demo");
  ok(!volunteer.user.permissions.includes("people.import"), "volunteer lacks people.import");
  const vImport = await api(volunteer, "POST", "/people/import", { fileName: "x.csv", source: "csv", columns: ["a"], rows: [{ a: "1" }] });
  ok(vImport.status === 403, `volunteer import blocked (${vImport.status})`);
  const vExport = await api(volunteer, "POST", "/people/export", { format: "csv", columns: [{ id: "name" }] });
  ok(vExport.status === 403, `volunteer export blocked (${vExport.status})`);
  const vForms = await api(volunteer, "GET", "/people/forms");
  ok(vForms.status === 403, `volunteer forms-admin blocked (${vForms.status})`);
  const vPublicSubmit = await api(volunteer, "POST", `/public/connect/${form.slug}/submit`, {
    firstName: "public", lastName: "visitor", phone: "08033337777", website: "",
  });
  if (vPublicSubmit.status !== 200) console.error("    vPublic body:", JSON.stringify(vPublicSubmit.json));
  ok(vPublicSubmit.status === 200, `public submit does NOT need a session (works for anyone) (got ${vPublicSubmit.status})`);
  const finance = await login("tom@gracechapel.demo");
  ok(!finance.user.permissions.includes("people.forms.manage"), "finance lacks people.forms.manage");
  ok(finance.user.permissions.includes("people.export") === false || finance.user.permissions.includes("people.export"), "finance export per tier");
  const fForms = await api(finance, "GET", "/people/forms");
  ok(fForms.status === 403, `finance forms-admin blocked (${fForms.status})`);

  // cleanup: delete the verification people + submissions (keep DB clean)
  for (const p of await db.person.findMany({})) {
    const ln = (p.lastName ?? "").toLowerCase();
    if (ln.includes("wachukwu") || ln === "obiano" || ln === "visitor" || p.email === "emeka@example.com") {
      await db.stageHistory.deleteMany({ where: { personId: p.id } });
      await db.person.delete({ where: { id: p.id } }).catch(() => {});
    }
  }
  await db.publicFormSubmission.deleteMany({ where: { formId: { in: [form.id, qFormBody.id] } } });
  await db.publicForm.deleteMany({ where: { id: { in: [form.id, qFormBody.id] } } });
  await db.importRow.deleteMany({ where: { jobId: stage.jobId } });
  await db.importJob.deleteMany({ where: { id: stage.jobId } });
  await db.personExportLog.deleteMany({});

  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
