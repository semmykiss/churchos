import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/http";
import { audit } from "@/server/audit";
import type { SessionUser } from "@/server/permissions";
import { normalizeToE164, normalizePhoneForMatch } from "@/lib/phone";
import { NIGERIAN_STATES, STATE_LGAS } from "@/lib/nigeria";
import { checkDuplicates } from "@/server/services/people";

/**
 * People CRM Phase 7 — CSV/XLSX import wizard (server side).
 *
 * The browser parses the file (SheetJS) and posts the ROWS as JSON; this
 * service never trusts them: every value is re-validated/normalized here.
 * Lifecycle: stage (creates ImportJob + ImportRows, applies the mapping,
 * normalizes, dedupes) → reviewer decides per-row create/skip/merge →
 * chunked commit with progress in ImportJob.stats (client polls GET) →
 * rollback (hard-deletes exactly the persons this job created, guarded,
 * ≤7 days server-enforced). Every transition is audited.
 */

export const IMPORT_ROLLBACK_DAYS = 7;
const COMMIT_CHUNK = 50;

export const IMPORT_FIELDS = {
  firstName: { label: "First name", required: true },
  lastName: { label: "Last name", required: true },
  preferredName: { label: "Preferred name", required: false },
  title: { label: "Title", required: false },
  email: { label: "Email", required: false },
  phone: { label: "Phone", required: false },
  whatsapp: { label: "WhatsApp", required: false },
  gender: { label: "Gender", required: false },
  birthdate: { label: "Date of birth", required: false },
  maritalStatus: { label: "Marital status", required: false },
  weddingAnniversary: { label: "Wedding anniversary", required: false },
  occupation: { label: "Occupation", required: false },
  addressLine1: { label: "Street address", required: false },
  city: { label: "City", required: false },
  state: { label: "State", required: false },
  lga: { label: "LGA", required: false },
  lifecycleStage: { label: "Stage", required: false },
  notes: { label: "Notes", required: false },
} as const;

export type ImportFieldKey = keyof typeof IMPORT_FIELDS;

const GENDER_MAP: Record<string, string> = { male: "m", man: "m", m: "m", boy: "m", female: "f", woman: "f", f: "f", girl: "f" };
const MARITAL_MAP: Record<string, string> = {
  single: "single", engaged: "engaged", married: "married", widow: "widowed", widowed: "widowed",
  divorced: "divorced", separated: "separated",
};
const STAGE_VALUES = new Set(["guest", "returning_guest", "attender", "member", "leader", "inactive"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ImportFieldIssue {
  field: ImportFieldKey;
  raw: string;
  value?: string;
  reason: string;
}

interface NormalizedRow {
  values: Partial<Record<ImportFieldKey, string>>;
  issues: ImportFieldIssue[];
  errors: string[];
}

// ── normalization helpers ────────────────────────────────────────────────────

/** Title-case a messy name: trim, collapse spaces, capitalize letters after
 *  word starts (handles "ADA EZE", "ada eze", "ADA  eze", O'BIOR → O'Bior). */
export function titleCaseName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s'\-])([a-z\u00e0-\u017f])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Parse the date formats Nigerian spreadsheets actually contain:
 *  dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, "12 Mar 1998", "Mar 12, 1998",
 *  and SheetJS serial numbers (converted client-side; accepted here too). */
export function parseFlexibleDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // ISO
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoOr(m[1], m[2], m[3]);
  // dd/mm/yyyy or dd-mm-yyyy (day-first — Nigerian convention)
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (m) return isoOr(m[3], m[2], m[1]);
  // mm/dd/yyyy — only if day-first was impossible (first part > 12)
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  // "12 Mar 1998" / "12 March 1998"
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = monthFromName(m[2]);
    if (mo) return isoOr(m[3], String(mo), m[1]);
  }
  // "Mar 12, 1998" / "March 12 1998"
  m = /^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = monthFromName(m[1]);
    if (mo) return isoOr(m[3], String(mo), m[2]);
  }
  // SheetJS serial date (days since 1899-12-30)
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function isoOr(y: string, mo: string, d: string): string | null {
  const yy = Number(y), mm = Number(mo), dd = Number(d);
  if (!yy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  if (yy < 1900 || yy > new Date().getUTCFullYear()) return null;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function monthFromName(name: string): number | null {
  const i = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .findIndex((mo) => name.toLowerCase().slice(0, 3) === mo);
  return i === -1 ? null : i + 1;
}

/** Match a state name case/space/punctuation-insensitively ("lagos", "Lagos ",
 *  "F.C.T" → "FCT" style quirks) and return the canonical spelling. */
function matchState(input: string): string | null {
  const key = input.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return null;
  for (const st of NIGERIAN_STATES) {
    if (st.toLowerCase().replace(/[^a-z]/g, "") === key) return st;
  }
  // common aliases
  if (key === "fct" || key === "fctabuja" || key === "abuja") return "FCT";
  return null;
}

function matchLga(state: string, input: string): string | null {
  const lgas = STATE_LGAS[state];
  if (!lgas) return null;
  const key = input.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return null;
  for (const lga of lgas) {
    if (lga.toLowerCase().replace(/[^a-z]/g, "") === key) return lga;
  }
  return null;
}

function ageFrom(birthdate: string | undefined): number | null {
  if (!birthdate) return null;
  const bd = new Date(birthdate + "T00:00:00Z");
  if (Number.isNaN(bd.getTime())) return null;
  const now = new Date();
  let a = now.getUTCFullYear() - bd.getUTCFullYear();
  const mm = now.getUTCMonth() - bd.getUTCMonth();
  if (mm < 0 || (mm === 0 && now.getUTCDate() < bd.getUTCDate())) a--;
  return a;
}

/** Normalize one raw row against a mapping. Returns values + non-fatal issues
 *  + fatal errors (a row with errors cannot be created). */
export function normalizeImportRow(
  mapping: Record<string, string>, // column → field key
  raw: Record<string, string>
): NormalizedRow {
  const values: Partial<Record<ImportFieldKey, string>> = {};
  const issues: ImportFieldIssue[] = [];
  const errors: string[] = [];

  const get = (field: ImportFieldKey): string => {
    const col = Object.entries(mapping).find(([, f]) => f === field)?.[0];
    return col ? String(raw[col] ?? "").trim() : "";
  };

  // names — required
  for (const f of ["firstName", "lastName"] as const) {
    const v = get(f);
    if (!v) {
      errors.push(`${IMPORT_FIELDS[f].label} is required.`);
      continue;
    }
    values[f] = titleCaseName(v);
  }
  const pref = get("preferredName");
  if (pref) values.preferredName = titleCaseName(pref);
  const title = get("title");
  if (title) values.title = titleCaseName(title);

  // phone → E.164 (fatal if unparseable — a wrong number is worse than none)
  const phone = get("phone");
  if (phone) {
    const e164 = normalizeToE164(phone);
    if (!e164) errors.push(`Phone "${phone}" is not a valid Nigerian number.`);
    else {
      values.phone = e164;
      if (e164 !== phone.replace(/[\s\-()]/g, "")) issues.push({ field: "phone", raw: phone, value: e164, reason: "Normalized to E.164" });
    }
  }
  const whatsapp = get("whatsapp");
  if (whatsapp) {
    const e164 = normalizeToE164(whatsapp);
    if (!e164) errors.push(`WhatsApp "${whatsapp}" is not a valid Nigerian number.`);
    else values.whatsapp = e164;
  }

  // email
  const email = get("email");
  if (email) {
    const lower = email.toLowerCase();
    if (!EMAIL_RE.test(lower)) errors.push(`Email "${email}" is not valid.`);
    else values.email = lower;
  }

  // dates
  for (const f of ["birthdate", "weddingAnniversary"] as const) {
    const v = get(f);
    if (!v) continue;
    const iso = parseFlexibleDate(v);
    if (!iso) errors.push(`${IMPORT_FIELDS[f].label} "${v}" is not a recognised date.`);
    else {
      values[f] = iso;
      if (iso !== v) issues.push({ field: f, raw: v, value: iso, reason: "Parsed date" });
    }
  }

  // gender / marital / stage
  const gender = get("gender");
  if (gender) {
    const g = GENDER_MAP[gender.toLowerCase()];
    if (!g) issues.push({ field: "gender", raw: gender, reason: "Unrecognised — left blank" });
    else values.gender = g;
  }
  const marital = get("maritalStatus");
  if (marital) {
    const mv = MARITAL_MAP[marital.toLowerCase()];
    if (!mv) issues.push({ field: "maritalStatus", raw: marital, reason: "Unrecognised — left blank" });
    else values.maritalStatus = mv;
  }
  const stage = get("lifecycleStage");
  if (stage) {
    const sv = stage.toLowerCase().replace(/\s+/g, "_");
    if (!STAGE_VALUES.has(sv)) issues.push({ field: "lifecycleStage", raw: stage, reason: "Unrecognised — will default to guest" });
    else values.lifecycleStage = sv;
  }

  // occupation / address — free text, light cleanup
  for (const f of ["occupation", "addressLine1", "city"] as const) {
    const v = get(f);
    if (v) values[f] = v.replace(/\s+/g, " ").trim();
  }

  // state / LGA — canonicalize, warn when unmatched (never fatal)
  const stateRaw = get("state");
  if (stateRaw) {
    const st = matchState(stateRaw);
    if (!st) issues.push({ field: "state", raw: stateRaw, reason: "State not matched — left blank" });
    else {
      values.state = st;
      if (st !== stateRaw.trim()) issues.push({ field: "state", raw: stateRaw, value: st, reason: "Matched state" });
      const lgaRaw = get("lga");
      if (lgaRaw) {
        const lga = matchLga(st, lgaRaw);
        if (!lga) issues.push({ field: "lga", raw: lgaRaw, reason: `LGA not matched in ${st} — left blank` });
        else values.lga = lga;
      }
    }
  }

  const notes = get("notes");
  if (notes) values.notes = notes.trim();

  // child-safety invariant (mirrors the form): a minor cannot be imported
  // without a guardian link, which CSV cannot express → fatal with guidance.
  const age = ageFrom(values.birthdate);
  if (age !== null && age < 18) {
    errors.push("This row is a minor (under 18). Minors must be added with a guardian via Add person — they cannot be imported.");
  }

  return { values, issues, errors };
}

// ── auto column mapping ──────────────────────────────────────────────────────

/** First-pass auto-map: exact/alias header names → field keys. */
export function autoMapColumns(columns: string[]): Record<string, string> {
  const aliases: Record<ImportFieldKey, string[]> = {
    firstName: ["first name", "firstname", "first", "given name", "forename", "name"],
    lastName: ["last name", "lastname", "last", "surname", "family name"],
    preferredName: ["preferred name", "nickname", "known as"],
    title: ["title", "salutation"],
    email: ["email", "e-mail", "email address", "mail"],
    phone: ["phone", "phone number", "mobile", "mobile number", "gsm", "telephone", "tel", "phone no", "phone_no"],
    whatsapp: ["whatsapp", "whatsapp number", "wa"],
    gender: ["gender", "sex"],
    birthdate: ["date of birth", "dob", "birthdate", "birthday", "born"],
    maritalStatus: ["marital status", "marriage"],
    weddingAnniversary: ["wedding anniversary", "anniversary"],
    occupation: ["occupation", "job", "profession", "work"],
    addressLine1: ["address", "street", "street address", "home address", "residential address"],
    city: ["city", "town"],
    state: ["state", "state of residence"],
    lga: ["lga", "local government", "local government area"],
    lifecycleStage: ["stage", "lifecycle stage", "member status", "status"],
    notes: ["notes", "note", "comment", "comments"],
  };
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const col of columns) {
    const key = col.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
    for (const [field, names] of Object.entries(aliases) as [ImportFieldKey, string[]][]) {
      if (used.has(field)) continue;
      if (names.includes(key)) {
        mapping[col] = field;
        used.add(field);
        break;
      }
    }
  }
  return mapping;
}

// ── service (all org-scoped by user.orgId) ───────────────────────────────────

interface StageInput {
  fileName: string;
  source: "csv" | "xlsx";
  columns: string[];
  rows: Record<string, string>[];
}

function j<T>(v: string | null | undefined, fallback: T): T {
  try {
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function meta(meta: { ip?: string; userAgent?: string }) {
  return { ip: meta.ip, userAgent: meta.userAgent };
}

async function jobWithRows(orgId: string, jobId: string) {
  const job = await db.importJob.findFirst({ where: { id: jobId, orgId } });
  if (!job) throw notFound("Import job not found.");
  return job;
}

/** Stage a new import: create job + rows, apply mapping, normalize + dedupe. */
export async function stageImport(user: SessionUser, input: StageInput, m: { ip?: string; userAgent?: string }) {
  if (!user.permissions.includes("people.import")) throw badRequest("You do not have import permission.");
  const rows = input.rows ?? [];
  if (!rows.length) throw badRequest("The file has no data rows.");
  if (rows.length > 5000) throw badRequest("Import is limited to 5,000 rows per file — split larger files.");
  if (!input.columns?.length) throw badRequest("No columns detected in the file.");

  const mapping = autoMapColumns(input.columns);
  return applyMapping(user, null, { mapping, actions: {} }, { ...input }, m);
}

/** Apply (or re-apply) a mapping + per-row decisions, then normalize + dedupe
 *  every row. Also used as the DRY-RUN preview: nothing is committed. */
export async function applyMapping(
  user: SessionUser,
  jobId: string | null,
  input: { mapping: Record<string, string>; actions: Record<string, string> },
  stage?: StageInput,
  m: { ip?: string; userAgent?: string } = {}
) {
  // validate mapping targets
  const validFields = new Set(Object.keys(IMPORT_FIELDS));
  const mapping: Record<string, string> = {};
  for (const [col, field] of Object.entries(input.mapping ?? {})) {
    if (field && validFields.has(field)) mapping[col] = field;
  }
  const mappedNames = new Set(Object.values(mapping));
  if (!mappedNames.has("firstName") || !mappedNames.has("lastName")) {
    throw badRequest("Map at least First name and Last name columns.");
  }

  let job;
  if (jobId) {
    job = await jobWithRows(user.orgId, jobId);
    if (job.status !== "staged") throw badRequest("This import can no longer be modified.");
    await db.importRow.deleteMany({ where: { jobId: job.id, orgId: user.orgId } });
    const raw = j<{ columns: string[]; rows: Record<string, string>[] }>(job.rawContent, { columns: [], rows: [] });
    stage = { fileName: job.fileName ?? "upload", source: job.source as "csv" | "xlsx", columns: raw.columns, rows: raw.rows };
  } else {
    if (!stage) throw badRequest("Missing file data.");
    job = await db.importJob.create({
      data: {
        orgId: user.orgId,
        kind: "people",
        source: stage.source,
        fileName: stage.fileName,
        rawContent: JSON.stringify({ columns: stage.columns, rows: stage.rows }),
        status: "staged",
        createdByName: user.name,
      },
    });
  }

  const rows = stage.rows;

  // normalize every row
  const normalized: (NormalizedRow & { raw: Record<string, string>; rowNumber: number })[] = rows.map((raw, i) => ({
    raw,
    rowNumber: i + 1,
    ...normalizeImportRow(mapping, raw),
  }));

  // dedupe vs existing people (exact/fuzzy, same logic as Add person) —
  // only for rows that would otherwise be creatable
  const dupCache = new Map<string, Awaited<ReturnType<typeof checkDuplicates>>>();
  const existingMatches = await Promise.all(
    normalized.map(async (n) => {
      if (n.errors.length) return null;
      const key = `${n.values.email ?? ""}|${n.values.phone ?? ""}|${n.values.firstName ?? ""}|${n.values.lastName ?? ""}`;
      const cached = dupCache.get(key);
      if (cached) return cached;
      const dups = await checkDuplicates(user.orgId, {
        email: n.values.email,
        phone: n.values.phone,
        firstName: n.values.firstName,
        lastName: n.values.lastName,
        birthdate: n.values.birthdate,
      });
      const result = dups.exact.length
        ? { id: dups.exact[0].id, name: dups.exact[0].name, score: 100, kind: "exact" as const }
        : dups.fuzzy.length
          ? { id: dups.fuzzy[0].id, name: dups.fuzzy[0].name, score: 60, kind: "fuzzy" as const }
          : null;
      dupCache.set(key, result);
      return result;
    })
  );

  // intra-file duplicates: same normalized phone/email appearing twice
  const seen = new Map<string, number>(); // contact → first rowNumber
  const intraFile: (string | null)[] = normalized.map((n) => {
    const contact = n.values.phone ?? n.values.email ?? null;
    if (!contact) return null;
    const first = seen.get(contact);
    if (first !== undefined) return `Row ${first}`;
    seen.set(contact, n.rowNumber);
    return null;
  });

  // persist rows with decisions
  const issuesTotal = normalized.reduce((acc, n) => acc + n.issues.length, 0);
  await db.importRow.createMany({
    data: normalized.map((n, i) => {
      const dup = existingMatches[i];
      const action = input.actions[String(n.rowNumber)] ?? "create";
      return {
        orgId: user.orgId,
        jobId: job.id,
        rowNumber: n.rowNumber,
        rawData: JSON.stringify(n.raw),
        normalized: JSON.stringify({ values: n.values, issues: n.issues }),
        status: n.errors.length ? "error" : "ready",
        errorReason: n.errors.join(" ") || null,
        action: n.errors.length ? null : action,
        duplicateOfId: dup?.id ?? null,
        duplicateScore: dup?.score ?? null,
      };
    }),
  });

  const stats = {
    rows: rows.length,
    errors: normalized.filter((n) => n.errors.length).length,
    duplicates: existingMatches.filter(Boolean).length,
    intraFileDuplicates: intraFile.filter(Boolean).length,
    issues: issuesTotal,
    stage: "review" as const,
  };
  await db.importJob.update({ where: { id: job.id }, data: { mapping: JSON.stringify(mapping), stats: JSON.stringify(stats) } });

  await audit({
    orgId: user.orgId,
    actor: user,
    action: jobId ? "people.import.mapping" : "people.import.staged",
    entityType: "import_job",
    entityId: job.id,
    after: { rows: stats.rows, duplicates: stats.duplicates, errors: stats.errors },
    ...meta(m),
  });

  return { jobId: job.id, stats, mapping };
}

/** Dry-run preview payload: first N rows with normalization + dedupe info. */
export async function importPreview(user: SessionUser, jobId: string, limit = 100) {
  const job = await jobWithRows(user.orgId, jobId);
  const rows = await db.importRow.findMany({
    where: { jobId: job.id, orgId: user.orgId },
    orderBy: { rowNumber: "asc" },
    take: Math.min(300, Math.max(10, limit)),
  });
  return {
    job: { id: job.id, fileName: job.fileName, status: job.status, stats: j(job.stats, {}) },
    rows: rows.map((r) => {
      const norm = j<{ values: Record<string, string>; issues: ImportFieldIssue[] }>(r.normalized, { values: {}, issues: [] });
      return {
        rowNumber: r.rowNumber,
        raw: j(r.rawData, {}),
        values: norm.values,
        issues: norm.issues,
        status: r.status,
        errorReason: r.errorReason,
        action: r.action,
        duplicateOfId: r.duplicateOfId,
        duplicateScore: r.duplicateScore,
      };
    }),
  };
}

/** Set/adjust per-row decisions (create | skip | merge) after review. */
export async function setRowActions(user: SessionUser, jobId: string, actions: Record<string, string>) {
  const job = await jobWithRows(user.orgId, jobId);
  if (job.status !== "staged") throw badRequest("This import can no longer be modified.");
  const allowed = new Set(["create", "skip", "merge"]);
  let updated = 0;
  for (const [rowNumber, action] of Object.entries(actions)) {
    if (!allowed.has(action)) throw badRequest(`Unknown action "${action}".`);
    const res = await db.importRow.updateMany({
      where: { jobId: job.id, orgId: user.orgId, rowNumber: Number(rowNumber), status: "ready" },
      data: { action },
    });
    updated += res.count;
  }
  return { ok: true, updated };
}

/** Chunked commit — call repeatedly? No: one call starts the whole commit and
 *  processes in chunks before returning; the ROUTE returns after completion.
 *  For progress visibility the client polls GET people/import/:id, whose
 *  stats object is refreshed after every chunk. */
export async function commitImport(user: SessionUser, jobId: string, m: { ip?: string; userAgent?: string }) {
  const job = await jobWithRows(user.orgId, jobId);
  if (job.status !== "staged") throw badRequest("This import has already been committed or rolled back.");

  const batchId = `imp_${job.id}`;
  const stats = j<Record<string, number | string>>(job.stats, {});
  const progress = { processed: 0, created: 0, skipped: 0, merged: 0, failed: 0, committing: true };
  const writeStats = async () => {
    await db.importJob.update({
      where: { id: job.id },
      data: { stats: JSON.stringify({ ...stats, ...progress }) },
    });
  };
  await writeStats();

  // rows eligible: ready + has an action
  const total = await db.importRow.count({ where: { jobId: job.id, orgId: user.orgId, status: "ready" } });

  for (let offset = 0; offset < total; ) {
    const chunk = await db.importRow.findMany({
      where: { jobId: job.id, orgId: user.orgId, status: "ready" },
      orderBy: { rowNumber: "asc" },
      take: COMMIT_CHUNK,
    });
    if (!chunk.length) break;

    for (const row of chunk) {
      const norm = j<{ values: Record<string, string>; issues: ImportFieldIssue[] }>(row.normalized, { values: {}, issues: [] });
      const v = norm.values as Partial<Record<ImportFieldKey, string>>;
      try {
        if (row.action === "skip") {
          await db.importRow.update({ where: { id: row.id }, data: { status: "skipped" } });
          progress.skipped++;
        } else if (row.action === "merge" && row.duplicateOfId) {
          // fold non-blank imported values INTO the existing person (fill
          // blanks only — never overwrite what the church already knows)
          const existing = await db.person.findFirst({ where: { id: row.duplicateOfId, orgId: user.orgId, deletedAt: null, mergedIntoId: null } });
          if (!existing) throw new Error("Duplicate person no longer exists.");
          const patch: Record<string, unknown> = {};
          const fill = (field: keyof typeof existing, value: string | undefined) => {
            if (!value) return;
            const cur = existing[field];
            if (cur === null || cur === undefined || cur === "") patch[field] = value;
          };
          fill("firstName", v.firstName);
          fill("lastName", v.lastName);
          fill("preferredName", v.preferredName);
          fill("title", v.title);
          fill("email", v.email);
          if (v.phone) {
            fill("phoneE164", v.phone);
            fill("phone", v.phone);
          }
          if (v.whatsapp) fill("whatsappE164", v.whatsapp);
          if (v.birthdate) fill("birthdate", new Date(v.birthdate + "T00:00:00Z"));
          fill("gender", v.gender);
          fill("maritalStatus", v.maritalStatus);
          if (v.weddingAnniversary) fill("weddingAnniversary", new Date(v.weddingAnniversary + "T00:00:00Z"));
          fill("occupation", v.occupation);
          fill("addressLine1", v.addressLine1);
          fill("city", v.city);
          fill("state", v.state);
          fill("lga", v.lga);
          if (Object.keys(patch).length) {
            await db.person.update({ where: { id: existing.id }, data: { ...patch, updatedAt: new Date() } });
          }
          await db.importRow.update({ where: { id: row.id }, data: { status: "merged", mergedAt: new Date() } });
          progress.merged++;
        } else {
          // create — mirror createPerson's core data mapping (contact +
          // profile fields); guardian/custom/consent flows are form-only.
          const created = await db.person.create({
            data: {
              orgId: user.orgId,
              firstName: v.firstName!,
              lastName: v.lastName!,
              preferredName: v.preferredName || undefined,
              title: v.title || undefined,
              email: v.email || undefined,
              phone: v.phone || undefined,
              phoneE164: v.phone || undefined,
              whatsappE164: v.whatsapp || undefined,
              birthdate: v.birthdate ? new Date(v.birthdate + "T00:00:00Z") : undefined,
              gender: v.gender || undefined,
              maritalStatus: v.maritalStatus || undefined,
              weddingAnniversary: v.weddingAnniversary ? new Date(v.weddingAnniversary + "T00:00:00Z") : undefined,
              occupation: v.occupation || undefined,
              addressLine1: v.addressLine1 || undefined,
              city: v.city || undefined,
              state: v.state || undefined,
              lga: v.lga || undefined,
              lifecycleStage: v.lifecycleStage || "guest",
              notes: v.notes || undefined,
              firstVisitAt: new Date(),
              importBatchId: batchId,
            },
          });
          await db.importRow.update({ where: { id: row.id }, data: { status: "created", createdPersonId: created.id } });
          progress.created++;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        await db.importRow.update({ where: { id: row.id }, data: { status: "error", errorReason: reason } });
        progress.failed++;
      }
      progress.processed++;
    }

    await writeStats(); // progress after every chunk (client polls this)
  }

  const finalStats = { ...stats, ...progress, committing: false, committedAt: new Date().toISOString() };
  await db.importJob.update({
    where: { id: job.id },
    data: {
      status: "committed",
      committedAt: new Date(),
      importBatchId: batchId,
      stats: JSON.stringify(finalStats),
    },
  });

  await audit({
    orgId: user.orgId,
    actor: user,
    action: "people.import.commit",
    entityType: "import_job",
    entityId: job.id,
    after: { created: progress.created, merged: progress.merged, skipped: progress.skipped, failed: progress.failed, batchId },
    ...meta(m),
  });

  return { ok: true, stats: finalStats };
}

/** Undo: hard-delete exactly the persons this job created — and only those
 *  untouched since commit. Blocked after IMPORT_ROLLBACK_DAYS. */
export async function rollbackImport(user: SessionUser, jobId: string, m: { ip?: string; userAgent?: string }) {
  const job = await jobWithRows(user.orgId, jobId);
  if (job.status !== "committed") throw badRequest("Only committed imports can be rolled back.");
  if (!job.committedAt) throw badRequest("This import has no commit timestamp.");
  const cutoff = Date.now() - IMPORT_ROLLBACK_DAYS * 24 * 3600 * 1000;
  if (job.committedAt.getTime() < cutoff) {
    throw badRequest(`Imports can only be undone within ${IMPORT_ROLLBACK_DAYS} days.`);
  }

  const rows = await db.importRow.findMany({
    where: { jobId: job.id, orgId: user.orgId, createdPersonId: { not: null } },
    select: { id: true, rowNumber: true, createdPersonId: true },
  });

  const skipped: { row: number; reason: string }[] = [];
  let deleted = 0;

  for (const row of rows) {
    const pid = row.createdPersonId!;
    const person = await db.person.findFirst({ where: { id: pid, orgId: user.orgId } });
    if (!person) {
      skipped.push({ row: row.rowNumber, reason: "Already deleted" });
      continue;
    }
    if (person.mergedIntoId) {
      skipped.push({ row: row.rowNumber, reason: "Person has been merged — cannot undo" });
      continue;
    }
    if (person.updatedAt.getTime() > job.committedAt.getTime() + 2000) {
      skipped.push({ row: row.rowNumber, reason: "Person was modified after the import — not undoing" });
      continue;
    }
    try {
      // children first (import-created people only have stage history)
      await db.stageHistory.deleteMany({ where: { personId: pid, orgId: user.orgId } });
      await db.person.delete({ where: { id: pid } });
      await db.importRow.update({ where: { id: row.id }, data: { status: "pending", createdPersonId: null } });
      deleted++;
    } catch (err) {
      skipped.push({ row: row.rowNumber, reason: err instanceof Error ? err.message.slice(0, 120) : "Delete failed" });
    }
  }

  const stats = j<Record<string, unknown>>(job.stats, {});
  const finalStats = { ...stats, rollback: { deleted, skipped, at: new Date().toISOString() } };
  await db.importJob.update({
    where: { id: job.id },
    data: { status: "rolled_back", rolledBackAt: new Date(), stats: JSON.stringify(finalStats) },
  });

  await audit({
    orgId: user.orgId,
    actor: user,
    action: "people.import.rollback",
    entityType: "import_job",
    entityId: job.id,
    after: { deleted, skippedCount: skipped.length, batchId: job.importBatchId },
    ...meta(m),
  });

  return { ok: true, deleted, skipped };
}

/** Downloadable error/decision report (CSV of every row + outcome). */
export async function importErrorReport(user: SessionUser, jobId: string) {
  const job = await jobWithRows(user.orgId, jobId);
  const rows = await db.importRow.findMany({
    where: { jobId: job.id, orgId: user.orgId },
    orderBy: { rowNumber: "asc" },
  });
  const header = "row,outcome,error,action,duplicate_of,created_person_id,raw_data";
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.rowNumber, r.status, r.errorReason ?? "", r.action ?? "", r.duplicateOfId ?? "", r.createdPersonId ?? "", r.rawData]
      .map(esc)
      .join(",")
  );
  return header + "\n" + lines.join("\n");
}

// ── mapping templates ────────────────────────────────────────────────────────

export async function listMappingTemplates(user: SessionUser) {
  return db.importMappingTemplate.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, mapping: true, source: true, createdByName: true, createdAt: true },
    take: 100,
  });
}

export async function saveMappingTemplate(user: SessionUser, input: { name: string; mapping: Record<string, string>; source?: string }) {
  const name = input.name?.trim();
  if (!name) throw badRequest("Give the template a name.");
  if (!input.mapping || !Object.keys(input.mapping).length) throw badRequest("Nothing to save — map some columns first.");
  const existing = await db.importMappingTemplate.findFirst({ where: { orgId: user.orgId, name } });
  if (existing) {
    return db.importMappingTemplate.update({
      where: { id: existing.id },
      data: { mapping: JSON.stringify(input.mapping), source: input.source ?? existing.source },
    });
  }
  return db.importMappingTemplate.create({
    data: { orgId: user.orgId, name, mapping: JSON.stringify(input.mapping), source: input.source ?? "csv", createdByName: user.name },
  });
}

export async function deleteMappingTemplate(user: SessionUser, id: string) {
  const res = await db.importMappingTemplate.deleteMany({ where: { id, orgId: user.orgId } });
  if (!res.count) throw notFound("Template not found.");
  return { ok: true };
}

/** Recent jobs (shown in the wizard's history / undo banner). */
export async function listImportJobs(user: SessionUser) {
  const jobs = await db.importJob.findMany({
    where: { orgId: user.orgId, kind: "people" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, fileName: true, status: true, stats: true, importBatchId: true, createdByName: true, createdAt: true, committedAt: true, rolledBackAt: true },
  });
  return jobs.map((job) => ({
    ...job,
    stats: j(job.stats, {}),
    undoable:
      job.status === "committed" &&
      !!job.committedAt &&
      job.committedAt.getTime() > Date.now() - IMPORT_ROLLBACK_DAYS * 24 * 3600 * 1000,
  }));
}
