import { db } from "@/server/db";
import { audit, j } from "@/server/audit";
import { badRequest, notFound, forbidden } from "@/server/http";
import { PERMISSIONS, can, type SessionUser } from "@/server/permissions";

/**
 * Admin service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • permission matrix answers "who can see giving?" straight from the DB roles
 *  • audit log is append-only and read-only here
 *  • settings PUT is owner-only and audited
 *  • CSV import: stage → per-row validation + duplicate preview → commit
 *    (creates guests tagged with the batch) → rollback within 7 days (soft delete)
 */

// ── permission matrix ────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  people: "people", groups: "groups", checkin: "check-in", events: "events",
  giving: "giving", batches: "batches", statements: "statements", comms: "communications",
  consent: "consent", schedule: "scheduling", care: "care", workflows: "workflows",
  reports: "reports", admin: "admin", audit: "audit log", portal: "member portal",
};

/** Human-readable overrides for permissions whose auto label reads poorly. */
const LABEL_OVERRIDES: Record<string, string> = {
  "admin.view": "View administration",
  "admin.manage": "Manage roles & access",
  "audit.view": "View audit log",
  "portal.use": "Use member portal",
};

export function permissionCatalogue() {
  const actions: Record<string, string> = {
    view: "View", create: "Create", edit: "Edit", manage: "Manage", archive: "Archive", merge: "Merge",
    send: "Send", assign: "Assign", respond: "Respond", kiosk: "Run kiosk", attendance: "Record attendance", use: "Use",
  };
  return PERMISSIONS.map((key) => {
    const [module, action = "view"] = key.split(".");
    return {
      key,
      module,
      label: LABEL_OVERRIDES[key] ?? `${actions[action] ?? "Access"} ${MODULE_LABELS[module] ?? module}`,
    };
  });
}

export async function permissionMatrix(user: SessionUser) {
  const roles = await db.role.findMany({
    where: { orgId: user.orgId },
    include: { permissions: true },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  const matrix: Record<string, string[]> = {};
  for (const r of roles) matrix[r.key] = r.permissions.map((p) => p.permission);
  return {
    roles: roles.map((r) => ({ key: r.key, name: r.name, permissions: matrix[r.key] })),
    permissions: permissionCatalogue(),
    matrix,
    // "who can see giving?" — computed, not hardcoded
    whoSeesGiving: roles
      .filter((r) => matrix[r.key].includes("giving.view") || matrix[r.key].includes("*"))
      .map((r) => r.key),
  };
}

// ── audit log ────────────────────────────────────────────────────────────────

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function auditLog(user: SessionUser, q: { page?: number; action?: string; entityType?: string; search?: string }) {
  const where: any = { orgId: user.orgId };
  if (q.action) where.action = q.action;
  if (q.entityType) where.entityType = q.entityType;
  if (q.search?.trim()) where.actorLabel = { contains: q.search.trim() };
  const page = Math.max(1, q.page ?? 1);
  const pageSize = 25;
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actorLabel: r.actorLabel,
      actorType: r.actorType,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: safeJson(r.before),
      after: safeJson(r.after),
      ip: r.ip,
    })),
  };
}

// ── settings ─────────────────────────────────────────────────────────────────

export async function getSettings(user: SessionUser) {
  const org = await db.organization.findUnique({ where: { id: user.orgId } });
  if (!org) throw notFound("Organization not found.");
  return {
    org: {
      name: org.name,
      timezone: org.timezone,
      currency: org.currency,
      plan: org.plan,
      fiscalYearStartMonth: org.fiscalYearStartMonth,
    },
    settings: j<{ monthlyBudgetCents?: number; quietHours?: unknown }>(org.settings, {}),
  };
}

export async function updateSettings(user: SessionUser, body: any, meta: { ip?: string; userAgent?: string }) {
  if (!user.roleKeys.includes("owner")) throw forbidden("Only owners can change organization settings.");
  const org = await db.organization.findUnique({ where: { id: user.orgId } });
  if (!org) throw notFound("Organization not found.");
  const beforeSettings = j(org.settings, {});

  const orgData: any = {};
  for (const k of ["name", "timezone", "currency", "plan"] as const) {
    if (body?.[k] !== undefined) orgData[k] = String(body[k]);
  }
  if (body?.fiscalYearStartMonth !== undefined) orgData.fiscalYearStartMonth = Math.round(Number(body.fiscalYearStartMonth)) || 1;

  let mergedSettings = beforeSettings;
  if (body?.settings && typeof body.settings === "object") {
    mergedSettings = { ...beforeSettings, ...body.settings };
    orgData.settings = JSON.stringify(mergedSettings);
  }
  if (!Object.keys(orgData).length) throw badRequest("Nothing to update.");

  const updated = await db.organization.update({ where: { id: org.id }, data: orgData });
  await audit({
    orgId: user.orgId, actor: user, action: "settings.update", entityType: "organization", entityId: org.id,
    before: { name: org.name, timezone: org.timezone, settings: beforeSettings },
    after: { name: updated.name, timezone: updated.timezone, settings: j(updated.settings, {}) },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── CSV imports ──────────────────────────────────────────────────────────────

/** Minimal CSV parser: quoted fields, "" escapes, CRLF-safe. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n") {
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const FIELD_ALIASES: Record<string, string> = {
  first_name: "firstName", firstname: "firstName", "first name": "firstName",
  last_name: "lastName", lastname: "lastName", "last name": "lastName",
  email: "email", email_address: "email",
  phone: "phone", mobile: "phone", cell: "phone",
  birthdate: "birthdate", birthday: "birthdate", dob: "birthdate", date_of_birth: "birthdate",
};

interface CsvPerson {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthdate: string;
}

/** Parse + validate. A row is valid when it has a first_name and a way to contact (email or phone). */
function parseAndValidate(csvText: string) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { headers: [] as string[], people: [] as CsvPerson[], errors: [] as { row: number; reason: string }[] };
  const headers = rows[0].map((h) => h.trim());
  const fieldMap: (string | null)[] = headers.map((h) => FIELD_ALIASES[h.toLowerCase()] ?? null);

  const people: CsvPerson[] = [];
  const errors: { row: number; reason: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const rec: any = {};
    fieldMap.forEach((f, idx) => {
      if (f && values[idx] !== undefined) rec[f] = String(values[idx]).trim();
    });
    const rowNo = i + 1; // 1-based including header
    if (!rec.firstName) {
      errors.push({ row: rowNo, reason: "Missing first_name." });
      continue;
    }
    if (!rec.email && !rec.phone) {
      errors.push({ row: rowNo, reason: "Missing contact info (email or phone)." });
      continue;
    }
    people.push({
      row: rowNo,
      firstName: rec.firstName,
      lastName: rec.lastName ?? "",
      email: rec.email ? rec.email.toLowerCase() : "",
      phone: rec.phone ?? "",
      birthdate: rec.birthdate ?? "",
    });
  }
  return { headers, people, errors };
}

/** Exact email/phone duplicates already in the DB (or earlier in the same file). */
async function findDuplicates(orgId: string, people: CsvPerson[]) {
  const emails = [...new Set(people.map((p) => p.email).filter(Boolean))];
  const phones = [...new Set(people.map((p) => p.phone).filter(Boolean))];
  const existing = await db.person.findMany({
    where: {
      orgId,
      deletedAt: null,
      OR: [...(emails.length ? [{ email: { in: emails } }] : []), ...(phones.length ? [{ phone: { in: phones } }] : [])],
    },
    select: { email: true, phone: true },
  });
  const dupValues = new Set<string>();
  for (const e of existing) {
    if (e.email) dupValues.add(e.email.toLowerCase());
    if (e.phone) dupValues.add(e.phone);
  }
  const seen = new Set<string>();
  const duplicateRows = new Set<number>();
  for (const p of people) {
    const isDup =
      (p.email && (dupValues.has(p.email) || seen.has(p.email))) ||
      (p.phone && (dupValues.has(p.phone) || seen.has(p.phone)));
    if (isDup) duplicateRows.add(p.row);
    if (p.email) seen.add(p.email);
    if (p.phone) seen.add(p.phone);
  }
  return duplicateRows;
}

export async function listImports(user: SessionUser) {
  const jobs = await db.importJob.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: "desc" }, take: 50 });
  return {
    items: jobs.map((job) => ({
      id: job.id,
      fileName: job.fileName,
      status: job.status,
      stats: j<any>(job.stats, null),
      createdByName: job.createdByName,
      createdAt: job.createdAt,
    })),
  };
}

export async function stageImport(user: SessionUser, input: { csvText?: string; fileName?: string }, meta: { ip?: string; userAgent?: string }) {
  if (!input?.csvText?.trim()) throw badRequest("csvText is required.");
  const parsed = parseCsv(input.csvText);
  const { headers, people, errors } = parseAndValidate(input.csvText);
  const duplicateRows = await findDuplicates(user.orgId, people);

  const stats = {
    rows: Math.max(0, parsed.length - 1),
    valid: people.length,
    duplicates: duplicateRows.size,
    errors,
  };
  const mapping = { columns: headers, fields: FIELD_ALIASES, note: "supported: first_name, last_name, email, phone, birthdate" };

  const job = await db.importJob.create({
    data: {
      orgId: user.orgId,
      kind: "people",
      source: "csv",
      fileName: input.fileName || "import.csv",
      rawContent: input.csvText,
      mapping: JSON.stringify(mapping),
      status: "staged",
      stats: JSON.stringify(stats),
      createdByName: user.name,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "import.stage", entityType: "import_job", entityId: job.id,
    after: { fileName: job.fileName, rows: stats.rows, valid: stats.valid, duplicates: stats.duplicates },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: job.id, stats, mapping };
}

export async function commitImport(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const job = await db.importJob.findFirst({ where: { id, orgId: user.orgId } });
  if (!job) throw notFound("Import job not found.");
  if (job.status !== "staged") throw badRequest(`Only staged imports can be committed (current status: ${job.status}).`);
  if (!job.rawContent) throw badRequest("Import job has no staged content.");

  const { people, errors } = parseAndValidate(job.rawContent);
  const duplicateRows = await findDuplicates(user.orgId, people);

  let created = 0;
  let duplicates = 0;
  for (const p of people) {
    if (duplicateRows.has(p.row)) {
      duplicates += 1;
      continue;
    }
    await db.person.create({
      data: {
        orgId: user.orgId,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email || undefined,
        phone: p.phone || undefined,
        birthdate: p.birthdate ? new Date(`${p.birthdate}T00:00:00.000Z`) : undefined,
        status: "active",
        lifecycleStage: "guest",
        importBatchId: job.id,
      },
    });
    created += 1;
  }

  await db.importJob.update({ where: { id: job.id }, data: { status: "committed", committedAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "import.commit", entityType: "import_job", entityId: job.id,
    after: { created, duplicates, errors: errors.length, fileName: job.fileName },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { created, duplicates };
}

export async function rollbackImport(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const job = await db.importJob.findFirst({ where: { id, orgId: user.orgId } });
  if (!job) throw notFound("Import job not found.");
  if (job.status !== "committed" || !job.committedAt) throw badRequest("Only committed imports can be rolled back.");
  const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
  if (Date.now() - job.committedAt.getTime() > SEVEN_DAYS) {
    throw badRequest("Rollback window (7 days) has passed.");
  }
  const deleted = await db.person.updateMany({
    where: { orgId: user.orgId, importBatchId: job.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  await db.importJob.update({
    where: { id: job.id },
    data: { status: "rolled_back", rolledBackAt: new Date() },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "import.rollback", entityType: "import_job", entityId: job.id,
    before: { status: "committed" }, after: { status: "rolled_back", rolledBack: deleted.count },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { rolledBack: deleted.count };
}
