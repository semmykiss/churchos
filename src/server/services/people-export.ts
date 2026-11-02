import { db } from "@/server/db";
import { badRequest } from "@/server/http";
import { audit } from "@/server/audit";
import type { SessionUser } from "@/server/permissions";
import { listPeopleV2 } from "@/server/services/people";
import { activeDefinitions } from "@/server/services/people-custom-fields";
import * as XLSX from "xlsx";

/**
 * People CRM Phase 7 — scoped people export (CSV/XLSX).
 *
 * Reads flow EXCLUSIVELY through listPeopleV2 (the one permission-scoped
 * service), so a viewer can only ever export the fields the serializer
 * already returned for them — privacy-gated contacts, role-gated custom
 * fields, etc. are simply not in the payload. Every export is written to
 * PersonExportLog (NDPA accountability) and the audit log.
 */

const EXPORT_CAP_ROWS = 10000;

/** Whitelisted scalar columns (composite CRM columns like "name"/"contact"
 *  are expanded server-side; `custom:<key>` columns are validated against
 *  the org's definitions). */
const SCALAR_COLUMNS: Record<string, { label: string; get: (p: Record<string, unknown>) => string | number | null }> = {
  firstName: { label: "First name", get: (p) => (p.firstName as string) ?? null },
  lastName: { label: "Last name", get: (p) => (p.lastName as string) ?? null },
  preferredName: { label: "Preferred name", get: (p) => (p.preferredName as string) ?? null },
  title: { label: "Title", get: (p) => (p.title as string) ?? null },
  email: { label: "Email", get: (p) => (p.email as string) ?? null },
  phone: { label: "Phone (E.164)", get: (p) => (p.phoneE164 as string) ?? (p.phone as string) ?? null },
  phoneDisplay: { label: "Phone (display)", get: (p) => (p.phoneDisplay as string) ?? null },
  whatsapp: { label: "WhatsApp (E.164)", get: (p) => (p.whatsappE164 as string) ?? null },
  gender: { label: "Gender", get: (p) => (p.gender as string) ?? null },
  birthdate: { label: "Date of birth", get: (p) => fmtDateVal(p.birthdate) },
  age: { label: "Age", get: (p) => (p.age as number) ?? null },
  maritalStatus: { label: "Marital status", get: (p) => (p.maritalStatus as string) ?? null },
  weddingAnniversary: { label: "Wedding anniversary", get: (p) => fmtDateVal(p.weddingAnniversary) },
  occupation: { label: "Occupation", get: (p) => (p.occupation as string) ?? null },
  address: { label: "Address", get: (p) => (p.addressLine1 as string) ?? null },
  city: { label: "City", get: (p) => (p.city as string) ?? null },
  state: { label: "State", get: (p) => (p.state as string) ?? null },
  lga: { label: "LGA", get: (p) => (p.lga as string) ?? null },
  household: { label: "Household", get: (p) => ((p.household as { name?: string } | null)?.name) ?? null },
  campus: { label: "Campus", get: (p) => (p.campusName as string) ?? null },
  stage: { label: "Stage", get: (p) => (p.lifecycleStage as string) ?? null },
  status: { label: "Status", get: (p) => (p.membershipStatus as string) ?? null },
  lifecycle: { label: "Member status", get: (p) => (p.lifecycleStage as string) ?? null },
  groups: { label: "Groups", get: (p) => ((p.groups as { name: string }[] | null) ?? []).map((g) => g.name).join("; ") || null },
  tags: { label: "Tags", get: (p) => ((p.tags as { name: string }[] | null) ?? []).map((t) => t.name).join("; ") || null },
  lastSeen: { label: "Last seen", get: (p) => fmtDateVal(p.lastAttendedAt ?? p.lastActivityAt) },
  createdAt: { label: "Added on", get: (p) => fmtDateVal(p.createdAt) },
  notes: { label: "Notes", get: (p) => (p.notes as string) ?? null },
};

function fmtDateVal(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export interface ExportColumn {
  id: string;
  label?: string;
}

export interface ExportInput {
  format: "csv" | "xlsx";
  columns: ExportColumn[];
  search?: string;
  filters?: unknown;
  sort?: string;
  dir?: "asc" | "desc";
}

export async function exportPeopleV2(
  user: SessionUser,
  input: ExportInput,
  meta: { ip?: string; userAgent?: string }
) {
  if (!user.permissions.includes("people.export")) throw badRequest("You do not have export permission.");
  const format = input.format === "xlsx" ? "xlsx" : "csv";

  // resolve columns: expand composites, validate customs against definitions
  const cfDefs = await activeDefinitions(user.orgId);
  const defByKey = new Map(cfDefs.map((d) => [d.key, d]));
  const cols: { id: string; label: string; customKey?: string }[] = [];
  const expand = (id: string, label?: string) => {
    switch (id) {
      case "name":
        cols.push({ id: "firstName", label: "First name" }, { id: "lastName", label: "Last name" });
        return;
      case "contact":
        cols.push({ id: "email", label: "Email" }, { id: "phone", label: "Phone (E.164)" }, { id: "phoneDisplay", label: "Phone (display)" });
        return;
      default: {
        if (id.startsWith("custom:")) {
          const key = id.slice(7);
          const def = defByKey.get(key);
          if (!def) throw badRequest(`Unknown custom field "${key}".`);
          cols.push({ id, label: label || def.label, customKey: key });
          return;
        }
        const scalar = SCALAR_COLUMNS[id];
        if (!scalar) throw badRequest(`Unknown column "${id}".`);
        cols.push({ id, label: label || scalar.label });
      }
    }
  };
  const requested = input.columns?.length ? input.columns : [{ id: "name" }, { id: "contact" }, { id: "stage" }];
  for (const c of requested) expand(c.id, c.label);
  if (!cols.length) throw badRequest("Pick at least one column to export.");

  // fetch through the ONE scoped read path, page by page
  const people: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listPeopleV2(user, {
      search: input.search || undefined,
      filters: (input.filters as never) ?? null,
      sort: input.sort,
      dir: input.dir,
      pageSize: 200,
      cursor,
    });
    people.push(...(page.items as unknown as Record<string, unknown>[]));
    if (!page.nextCursor || people.length >= EXPORT_CAP_ROWS) break;
    cursor = page.nextCursor;
  }
  const rows = people.slice(0, EXPORT_CAP_ROWS);

  // build cell values
  const cellFor = (p: Record<string, unknown>, col: { id: string; customKey?: string }): string | number | null => {
    if (col.customKey) {
      const val = (p.custom as Record<string, unknown> | null)?.[col.customKey];
      if (val === null || val === undefined) return null;
      if (Array.isArray(val)) return val.join("; ");
      if (typeof val === "boolean") return val ? "Yes" : "No";
      return String(val);
    }
    return SCALAR_COLUMNS[col.id]?.get(p) ?? null;
  };

  let content: string;
  let mime: string;
  let filename: string;
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.map((c) => esc(c.label)).join(",")];
    for (const p of rows) {
      lines.push(cols.map((c) => esc(cellFor(p, c))).join(","));
    }
    // BOM so Excel opens UTF-8 (Nigerian names) correctly
    content = "\uFEFF" + lines.join("\r\n");
    mime = "text/csv; charset=utf-8";
    filename = `people-export-${stamp}.csv`;
  } else {
    const aoa: (string | number)[][] = [cols.map((c) => c.label)];
    for (const p of rows) aoa.push(cols.map((c) => String(cellFor(p, c) ?? "")));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((c) => ({ wch: Math.max(12, Math.min(42, c.label.length + 6)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "People");
    content = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    filename = `people-export-${stamp}.xlsx`;
  }

  await db.personExportLog.create({
    data: {
      orgId: user.orgId,
      userId: user.userId,
      userName: user.name,
      format,
      filters: JSON.stringify({ search: input.search ?? null, filters: input.filters ?? null, sort: input.sort ?? null, dir: input.dir ?? null }),
      columns: JSON.stringify(cols.map((c) => c.id)),
      rowCount: rows.length,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  await audit({
    orgId: user.orgId,
    actor: user,
    action: "people.export.v2",
    entityType: "people",
    after: { rows: rows.length, format, columns: cols.map((c) => c.id) },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { content, mime, filename, rowCount: rows.length };
}

/** Admin view: recent export log entries (shown under the export dialog). */
export async function listExportLog(user: SessionUser) {
  return db.personExportLog.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, userName: true, format: true, rowCount: true, columns: true, filters: true, createdAt: true },
  });
}
