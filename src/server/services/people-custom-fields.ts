/**
 * People CRM (Phase 6) — person custom fields.
 *
 * Definitions live in the (pre-existing) CustomFieldDefinition table with
 * entity="person"; VALUES live in the (pre-existing) Person.custom JSON
 * column. This service is the single permission-scoped choke point for both:
 *
 *   • definition CRUD + one-click presets — requires people.customfields.manage
 *   • value validation — every write path (createPerson / updatePerson) runs
 *     values through validateCustomValues() here; unknown keys, wrong types,
 *     invalid select options and cleared required fields are rejected 400
 *   • value VISIBILITY — filterCustomValuesForViewer() runs on every read
 *     path; keys the viewer may not see are OMITTED from the payload (never
 *     merely blanked), mirroring the Phase 1 serializer rule
 *   • filter resolution — resolveCustomFilterIds() answers "which person ids
 *     match this condition" via parameterized SQLite json_extract (Prisma
 *     cannot filter JSON on SQLite), feeding the __customField marker in
 *     buildPeopleV2Where (same pattern as the birthday conditions)
 */
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import { can, SYSTEM_ROLES, type SessionUser } from "@/server/permissions";
import { profileVisible, type PersonViewerTier } from "@/server/services/people-serializer";

export const CUSTOM_FIELD_ENTITY = "person";

export const CUSTOM_FIELD_DATA_TYPES = [
  "text", "long_text", "number", "date", "boolean", "select", "multi_select", "url",
] as const;
export type CustomFieldDataType = (typeof CUSTOM_FIELD_DATA_TYPES)[number];

/** Keys ride in column ids ("custom:<key>") and json paths — keep them boring. */
const KEY_RE = /^[a-z0-9_]{1,40}$/;
const LABEL_MAX = 80;
const OPTIONS_MAX = 50;
const ROLE_KEYS_MAX = 20;

// ── definition DTO ───────────────────────────────────────────────────────────

export interface CustomFieldDefRow {
  id: string;
  key: string;
  label: string;
  dataType: CustomFieldDataType;
  options: string[];
  required: boolean;
  searchable: boolean;
  showInList: boolean;
  pii: boolean;
  visibility: string; // staff | leaders | member (legacy coarse gate)
  visibleToRoles: string[];
  editableByRoles: string[];
  filterable: boolean;
  archivedAt: Date | null;
}

type DefRowLike = {
  id: string; key: string; label: string; dataType: string;
  options: string | null; required: boolean; searchable: boolean; showInList: boolean;
  pii: boolean; visibility: string; visibleToRoles: string | null;
  editableByRoles: string | null; filterable: boolean; archivedAt: Date | null;
};

function parseRoleList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function parseOptions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === "string") : [];
  } catch {
    return [];
  }
}

export function serializeDefinition(r: DefRowLike): CustomFieldDefRow {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    dataType: (CUSTOM_FIELD_DATA_TYPES as readonly string[]).includes(r.dataType)
      ? (r.dataType as CustomFieldDataType)
      : "text",
    options: parseOptions(r.options),
    required: r.required,
    searchable: r.searchable,
    showInList: r.showInList,
    pii: r.pii,
    visibility: r.visibility,
    visibleToRoles: parseRoleList(r.visibleToRoles),
    editableByRoles: parseRoleList(r.editableByRoles),
    filterable: r.filterable,
    archivedAt: r.archivedAt,
  };
}

export function customColumnId(key: string): string {
  return `custom:${key}`;
}
export function parseCustomColumnId(columnId: string): string | null {
  return columnId.startsWith("custom:") ? columnId.slice(7) : null;
}

/**
 * Active (non-archived) person definitions — the ONE read every write path
 * (createPerson/updatePerson validation) and every read path (value
 * filtering, filter resolution) uses. One extra indexed query per request.
 */
export async function activeDefinitions(orgId: string): Promise<CustomFieldDefRow[]> {
  const rows = await db.customFieldDefinition.findMany({
    where: { orgId, entity: CUSTOM_FIELD_ENTITY, archivedAt: null },
  });
  return rows.map(serializeDefinition);
}

// ── role keys ────────────────────────────────────────────────────────────────

/** Role keys valid for role-gate config: this org's roles + system presets. */
async function validRoleKeys(orgId: string): Promise<Set<string>> {
  const roles = await db.role.findMany({ where: { orgId }, select: { key: true } });
  return new Set([...roles.map((r) => r.key), ...Object.keys(SYSTEM_ROLES)]);
}

async function assertRoleKeys(orgId: string, raw: unknown, field: string): Promise<string[]> {
  if (raw === undefined || raw === null || raw === "") return [];
  if (!Array.isArray(raw)) throw badRequest(`${field} must be an array of role keys.`);
  const list = raw.map((k) => String(k).trim()).filter(Boolean);
  if (list.length > ROLE_KEYS_MAX) throw badRequest(`${field} allows at most ${ROLE_KEYS_MAX} roles.`);
  if (new Set(list).size !== list.length) throw badRequest(`${field} contains duplicate roles.`);
  const valid = await validRoleKeys(orgId);
  for (const k of list) {
    if (!valid.has(k)) throw badRequest(`Unknown role "${k}" in ${field}.`);
  }
  return list;
}

// ── definition CRUD ──────────────────────────────────────────────────────────

export async function listDefinitions(user: SessionUser, opts?: { includeArchived?: boolean }) {
  assertManage(user);
  const rows = await db.customFieldDefinition.findMany({
    where: { orgId: user.orgId, entity: CUSTOM_FIELD_ENTITY, ...(opts?.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ label: "asc" }],
  });
  return { items: rows.map(serializeDefinition) };
}

/**
 * Read-only definition list for FORMS / FILTERS / COLUMN CHOOSERS. Every
 * people.view holder may fetch the definitions (the form renders inputs from
 * them); the server still filters VALUES per viewer and per field at read
 * time, and re-checks editability at write time.
 */
export async function listDefinitionsForForms(orgId: string) {
  const rows = await db.customFieldDefinition.findMany({
    where: { orgId, entity: CUSTOM_FIELD_ENTITY, archivedAt: null },
    orderBy: [{ label: "asc" }],
  });
  return { items: rows.map(serializeDefinition) };
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

function assertValidOptions(dataType: CustomFieldDataType, options: string[] | undefined): string[] | null {
  if (dataType !== "select" && dataType !== "multi_select") {
    if (options && options.length > 0) throw badRequest("Only single/multi select fields take options.");
    return null;
  }
  if (!options || options.length < 2) throw badRequest("Select fields need at least 2 options.");
  if (options.length > OPTIONS_MAX) throw badRequest(`Select fields allow at most ${OPTIONS_MAX} options.`);
  const cleaned = options.map((o) => o.trim()).filter(Boolean);
  if (cleaned.length < 2) throw badRequest("Select fields need at least 2 non-empty options.");
  if (new Set(cleaned).size !== cleaned.length) throw badRequest("Select options must be unique.");
  for (const o of cleaned) if (o.length > 120) throw badRequest("Select options are limited to 120 characters.");
  return cleaned;
}

function assertManage(user: SessionUser) {
  if (!can(user, "people.customfields.manage")) {
    throw forbidden('Requires "people.customfields.manage" permission.');
  }
}

export interface DefinitionInput {
  label?: unknown; key?: unknown; dataType?: unknown; options?: unknown;
  required?: unknown; showInList?: unknown; filterable?: unknown; pii?: unknown;
  visibility?: unknown; visibleToRoles?: unknown; editableByRoles?: unknown;
}

function validateDefinitionInput(
  orgId: string,
  input: DefinitionInput,
  opts?: { keyImmutable?: string; fallbackType?: string }
) {
  const out: Record<string, unknown> = {};
  if (input.label !== undefined) {
    const label = String(input.label).trim();
    if (!label) throw badRequest("Label is required.");
    if (label.length > LABEL_MAX) throw badRequest(`Label is limited to ${LABEL_MAX} characters.`);
    out.label = label;
  }
  let key: string | undefined;
  if (input.key !== undefined && input.key !== "") {
    key = String(input.key).trim();
    if (!KEY_RE.test(key)) {
      throw badRequest("Key must be 1–40 characters of lowercase letters, digits and underscores.");
    }
  } else if (!opts?.keyImmutable) {
    const label = String(input.label ?? "").trim();
    key = slugify(label);
    if (!KEY_RE.test(key)) throw badRequest("Could not derive a key from that label — provide a key.");
  }
  if (key) out.key = key;

  let dataType: CustomFieldDataType | undefined;
  if (input.dataType !== undefined) {
    const t = String(input.dataType).trim();
    if (!(CUSTOM_FIELD_DATA_TYPES as readonly string[]).includes(t)) {
      throw badRequest(`Unknown data type "${t}".`);
    }
    dataType = t as CustomFieldDataType;
    out.dataType = t;
  }
  const effectiveType = dataType ?? (opts?.fallbackType as CustomFieldDataType | undefined) ?? "text";
  if (input.options !== undefined) {
    out.options = assertValidOptions(effectiveType, input.options as string[] | undefined);
  } else if (dataType === "select" || dataType === "multi_select") {
    throw badRequest("Select fields need at least 2 options.");
  }

  for (const k of ["required", "showInList", "filterable", "pii"] as const) {
    if (input[k] !== undefined) out[k] = input[k] === true;
  }
  if (input.visibility !== undefined) {
    const v = String(input.visibility).trim();
    if (!["staff", "leaders", "member"].includes(v)) throw badRequest("visibility must be staff, leaders or member.");
    out.visibility = v;
  }
  return out as { label: string; key: string; dataType?: string; options?: string[] | null } & Record<string, unknown>;
}

export async function createDefinition(user: SessionUser, input: DefinitionInput, meta: { ip?: string; userAgent?: string }) {
  assertManage(user);
  const data = validateDefinitionInput(user.orgId, input);
  const label = data.label as string;
  const key = (data.key as string) || slugify(label);
  const existing = await db.customFieldDefinition.findFirst({
    where: { orgId: user.orgId, entity: CUSTOM_FIELD_ENTITY, key },
    select: { id: true, archivedAt: true },
  });
  if (existing) {
    throw badRequest(existing.archivedAt
      ? `A field with key "${key}" was archived — restore it or pick another key.`
      : `A field with key "${key}" already exists.`);
  }
  const visibleToRoles = await assertRoleKeys(user.orgId, input.visibleToRoles, "visibleToRoles");
  const editableByRoles = await assertRoleKeys(user.orgId, input.editableByRoles, "editableByRoles");

  const row = await db.customFieldDefinition.create({
    data: {
      orgId: user.orgId,
      entity: CUSTOM_FIELD_ENTITY,
      key,
      label,
      dataType: (data.dataType as string) ?? "text",
      options: data.options ? JSON.stringify(data.options) : null,
      required: data.required === true,
      showInList: data.showInList === true,
      filterable: data.filterable === true,
      pii: data.pii === true,
      visibility: (data.visibility as string) ?? "staff",
      visibleToRoles: visibleToRoles.length ? JSON.stringify(visibleToRoles) : null,
      editableByRoles: editableByRoles.length ? JSON.stringify(editableByRoles) : null,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "people.customfields.create",
    entityType: "custom_field_definition", entityId: row.id,
    after: { key, label, dataType: row.dataType },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { field: serializeDefinition(row) };
}

export async function updateDefinition(user: SessionUser, id: string, input: DefinitionInput, meta: { ip?: string; userAgent?: string }) {
  assertManage(user);
  const row = await db.customFieldDefinition.findFirst({
    where: { id, orgId: user.orgId, entity: CUSTOM_FIELD_ENTITY },
  });
  if (!row) throw notFound("Custom field not found.");

  // key is immutable (values already stored under it would orphan)
  const data = validateDefinitionInput(user.orgId, { ...input, key: undefined }, { keyImmutable: row.key, fallbackType: row.dataType });
  const dbData: Record<string, unknown> = {};
  for (const k of ["label", "dataType", "required", "showInList", "filterable", "pii", "visibility"]) {
    if (data[k] !== undefined) dbData[k] = data[k];
  }
  if (data.options !== undefined) dbData.options = data.options ? JSON.stringify(data.options) : null;

  if (input.visibleToRoles !== undefined) {
    const roles = await assertRoleKeys(user.orgId, input.visibleToRoles, "visibleToRoles");
    dbData.visibleToRoles = roles.length ? JSON.stringify(roles) : null;
  }
  if (input.editableByRoles !== undefined) {
    const roles = await assertRoleKeys(user.orgId, input.editableByRoles, "editableByRoles");
    dbData.editableByRoles = roles.length ? JSON.stringify(roles) : null;
  }
  if (Object.keys(dbData).length === 0) throw badRequest("Nothing to update.");

  const updated = await db.customFieldDefinition.update({ where: { id: row.id }, data: dbData });
  await audit({
    orgId: user.orgId, actor: user, action: "people.customfields.update",
    entityType: "custom_field_definition", entityId: row.id,
    before: { key: row.key, label: row.label, required: row.required, showInList: row.showInList, filterable: row.filterable },
    after: { key: row.key, ...dbData },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { field: serializeDefinition(updated) };
}

/** Soft-archive: existing values are kept but the field leaves forms/filters. */
export async function archiveDefinition(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  assertManage(user);
  const row = await db.customFieldDefinition.findFirst({
    where: { id, orgId: user.orgId, entity: CUSTOM_FIELD_ENTITY, archivedAt: null },
  });
  if (!row) throw notFound("Custom field not found.");
  await db.customFieldDefinition.update({ where: { id: row.id }, data: { archivedAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "people.customfields.archive",
    entityType: "custom_field_definition", entityId: row.id,
    before: { key: row.key, label: row.label },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── one-click presets ────────────────────────────────────────────────────────

interface PresetField {
  key: string; label: string; dataType: CustomFieldDataType; options?: string[];
  filterable?: boolean; showInList?: boolean;
}
export interface CustomFieldPreset {
  key: string; label: string; description: string; fields: PresetField[];
}

export const CUSTOM_FIELD_PRESETS: CustomFieldPreset[] = [
  {
    key: "cell_home_fellowship",
    label: "Cell / Home Fellowship",
    description: "Track membership of a cell/home fellowship and which one.",
    fields: [
      { key: "cell_fellowship_status", label: "Cell fellowship status", dataType: "select", options: ["Active member", "Cell leader", "Not yet joined", "Inactive"], filterable: true },
      { key: "cell_group_name", label: "Cell / home fellowship name", dataType: "text", filterable: true },
    ],
  },
  {
    key: "zone_area_parish",
    label: "Zone / Area / Parish",
    description: "Zonal structure used by most Nigerian churches.",
    fields: [
      { key: "zone", label: "Zone", dataType: "text", filterable: true },
      { key: "area", label: "Area", dataType: "text", filterable: true },
      { key: "parish", label: "Parish", dataType: "text", filterable: true },
    ],
  },
  {
    key: "foundation_school",
    label: "Foundation School status",
    description: "New-member foundation school progress.",
    fields: [
      { key: "foundation_school_status", label: "Foundation school status", dataType: "select", options: ["Not started", "Enrolled", "Graduated"], filterable: true },
    ],
  },
  {
    key: "department_unit",
    label: "Department / Unit",
    description: "Where a worker serves (choir, ushering, media…).",
    fields: [
      { key: "department", label: "Department", dataType: "text", filterable: true },
      { key: "unit", label: "Unit", dataType: "text", filterable: true },
    ],
  },
];

export async function applyPreset(user: SessionUser, presetKey: string, meta: { ip?: string; userAgent?: string }) {
  assertManage(user);
  const preset = CUSTOM_FIELD_PRESETS.find((p) => p.key === presetKey);
  if (!preset) throw badRequest(`Unknown preset "${presetKey}".`);

  const existing = await db.customFieldDefinition.findMany({
    where: { orgId: user.orgId, entity: CUSTOM_FIELD_ENTITY, key: { in: preset.fields.map((f) => f.key) } },
    select: { key: true },
  });
  const existingKeys = new Set(existing.map((e) => e.key));

  let created = 0;
  for (const f of preset.fields) {
    if (existingKeys.has(f.key)) continue;
    await db.customFieldDefinition.create({
      data: {
        orgId: user.orgId,
        entity: CUSTOM_FIELD_ENTITY,
        key: f.key,
        label: f.label,
        dataType: f.dataType,
        options: f.options ? JSON.stringify(f.options) : null,
        filterable: f.filterable ?? false,
        showInList: f.showInList ?? false,
        visibility: "staff",
      },
    });
    created++;
  }
  await audit({
    orgId: user.orgId, actor: user, action: "people.customfields.preset",
    entityType: "custom_field_definition", entityId: preset.key,
    after: { preset: preset.key, created },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { preset: preset.key, label: preset.label, created, skipped: preset.fields.length - created };
}

// ── value validation (every write path funnels through here) ────────────────

const TEXT_MAX = 500;
const LONG_TEXT_MAX = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateValue(def: CustomFieldDefRow, value: unknown): unknown {
  if (value === null || value === "" || value === undefined) return null; // cleared
  switch (def.dataType) {
    case "text":
    case "long_text": {
      const s = String(value).trim();
      if (!s) return null;
      const max = def.dataType === "text" ? TEXT_MAX : LONG_TEXT_MAX;
      if (s.length > max) throw badRequest(`"${def.label}" is limited to ${max} characters.`);
      return s;
    }
    case "url": {
      const s = String(value).trim();
      if (!s) return null;
      if (s.length > TEXT_MAX) throw badRequest(`"${def.label}" is limited to ${TEXT_MAX} characters.`);
      if (!/^https?:\/\//i.test(s)) throw badRequest(`"${def.label}" must be an http(s):// link.`);
      return s;
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw badRequest(`"${def.label}" must be a number.`);
      if (Math.abs(n) > 1e15) throw badRequest(`"${def.label}" is out of range.`);
      return n;
    }
    case "date": {
      const s = String(value).trim().slice(0, 10);
      if (!DATE_RE.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
        throw badRequest(`"${def.label}" must be a date (YYYY-MM-DD).`);
      }
      return s;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const s = String(value).toLowerCase();
      if (["true", "yes", "1"].includes(s)) return true;
      if (["false", "no", "0"].includes(s)) return false;
      throw badRequest(`"${def.label}" must be yes or no.`);
    }
    case "select": {
      const s = String(value).trim();
      if (!s) return null;
      if (!def.options.includes(s)) throw badRequest(`"${def.label}" must be one of: ${def.options.join(", ")}.`);
      return s;
    }
    case "multi_select": {
      const arr = Array.isArray(value) ? value : String(value).split(",");
      const cleaned = [...new Set(arr.map((v) => String(v).trim()).filter(Boolean))];
      if (cleaned.length === 0) return null;
      if (cleaned.length > OPTIONS_MAX) throw badRequest(`"${def.label}" allows at most ${OPTIONS_MAX} selections.`);
      for (const v of cleaned) {
        if (!def.options.includes(v)) throw badRequest(`"${def.label}" does not include option "${v}".`);
      }
      return cleaned;
    }
    default:
      throw badRequest(`Unknown data type for "${def.label}".`);
  }
}

/**
 * Validate a `custom` payload against the org's active person definitions.
 * Unknown keys are rejected (they would otherwise be silently unreadable).
 * `requireAll` enforces required fields on CREATE — on UPDATE, clearing a
 * required field is what gets rejected instead.
 */
export function validateCustomValues(
  defs: CustomFieldDefRow[],
  input: unknown,
  opts: { requireAll?: boolean } = {}
): Record<string, unknown> {
  // absent/null payloads still run the required-fields sweep on CREATE
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) throw badRequest("custom must be an object.");

  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(input as Record<string, unknown>)) {
    const def = byKey.get(rawKey);
    if (!def) throw badRequest(`Unknown custom field "${rawKey}".`);
    out[rawKey] = validateValue(def, value);
  }
  if (opts.requireAll) {
    for (const def of defs) {
      if (!def.required) continue;
      const v = out[def.key];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        throw badRequest(`"${def.label}" is required.`);
      }
    }
  } else {
    for (const def of defs) {
      if (!def.required) continue;
      if (out[def.key] === undefined) continue; // not touched in this update
      const v = out[def.key];
      if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        throw badRequest(`"${def.label}" is required and cannot be cleared.`);
      }
    }
  }
  return out;
}

/**
 * Per-field EDITABILITY (server-side write gate). A field with an explicit
 * editableByRoles list may only be written by those roles; without one, the
 * caller's people.edit / own_household rights (already checked by the caller)
 * govern. Throwing names the field so the UI can explain.
 */
export function assertCustomFieldsEditable(user: SessionUser, defs: CustomFieldDefRow[], values: Record<string, unknown>) {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const key of Object.keys(values)) {
    const def = byKey.get(key);
    if (!def) continue;
    if (def.editableByRoles.length === 0) continue;
    if (def.editableByRoles.some((r) => user.roleKeys.includes(r))) continue;
    if (can(user, "admin.manage")) continue; // church administrator — noteAdmin precedent
    throw forbidden(`You don't have permission to edit the "${def.label}" field.`);
  }
}

// ── value visibility (every read path funnels through here) ─────────────────

const STAFF_TIERS: PersonViewerTier[] = ["staff", "finance"];
const LEADER_TIERS: PersonViewerTier[] = ["staff", "finance", "leader"];

/**
 * Keys the viewer may see on THIS person. Rules (first match wins):
 *   1. archived/unknown key → dropped
 *   2. pii → staff/finance only
 *   3. explicit visibleToRoles list → role intersection (church
 *      administrators holding admin.manage see everything — noteAdmin precedent)
 *   4. legacy visibility: staff → staff/finance · leaders → +leader ·
 *      member → anyone who can see the profile at all
 */
export function filterCustomValuesForViewer(
  defs: CustomFieldDefRow[],
  values: unknown,
  viewer: { roleKeys: string[]; permissions?: string[] },
  tier: PersonViewerTier
): Record<string, unknown> {
  const parsed = (values && typeof values === "object" && !Array.isArray(values))
    ? (values as Record<string, unknown>)
    : {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  // Church administrators (owner / campus admin — admin.manage, the noteAdmin
  // precedent) see every field regardless of role lists
  const superadmin = (viewer.permissions ?? []).includes("admin.manage");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const def = byKey.get(key);
    if (!def || def.archivedAt) continue;
    if (value === null || value === undefined) continue;
    if (!superadmin) {
      if (def.pii && !STAFF_TIERS.includes(tier)) continue;
      if (def.visibleToRoles.length > 0) {
        if (!def.visibleToRoles.some((r) => viewer.roleKeys.includes(r))) continue;
      } else if (def.visibility === "staff") {
        if (!STAFF_TIERS.includes(tier)) continue;
      } else if (def.visibility === "leaders") {
        if (!LEADER_TIERS.includes(tier)) continue;
      } else if (!profileVisible(tier)) {
        continue;
      }
    }
    out[key] = value;
  }
  return out;
}

// ── filter resolution (SQLite json_extract; Prisma cannot filter JSON here) ──

const TEXT_OPS = new Set(["is", "contains", "isSet", "isMissing"]);
const NUMBER_OPS = new Set(["is", "between", "isSet", "isMissing"]);
const DATE_OPS = new Set(["between", "after", "before", "isSet", "isMissing"]);
const BOOL_OPS = new Set(["is"]);
const SELECT_OPS = new Set(["is", "isSet", "isMissing"]);
const MULTI_OPS = new Set(["has", "isSet", "isMissing"]);

export function customFieldOpsFor(def: CustomFieldDefRow): string[] {
  switch (def.dataType) {
    case "text": case "long_text": case "url": return [...TEXT_OPS];
    case "number": return [...NUMBER_OPS];
    case "date": return [...DATE_OPS];
    case "boolean": return [...BOOL_OPS];
    case "select": return [...SELECT_OPS];
    case "multi_select": return [...MULTI_OPS];
    default: return [];
  }
}

/**
 * Whether THIS viewer may FILTER by this field at all. Filtering reveals WHO
 * has a value set, so it follows the same role gates as value visibility —
 * with a conservative fallback for the coarse legacy visibility levels
 * ("leaders" org-wide filtering requires people.edit; per-target leadership
 * nuance is not knowable outside a person row).
 */
export function canFilterCustomField(def: CustomFieldDefRow, user: SessionUser): boolean {
  if (can(user, "admin.manage")) return true; // church administrator
  if (def.visibleToRoles.length > 0) {
    return def.visibleToRoles.some((r) => user.roleKeys.includes(r));
  }
  if (def.pii) return can(user, "people.edit") || can(user, "giving.view.all");
  if (def.visibility === "member") return true;
  return can(user, "people.edit"); // staff + leaders coarsely
}

function likeEscape(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

/** Resolve the person ids matching ONE custom-field condition (org-scoped). */
export async function resolveCustomFilterIds(
  orgId: string,
  def: CustomFieldDefRow,
  op: string,
  value: unknown
): Promise<string[]> {
  const allowed = customFieldOpsFor(def);
  if (!allowed.includes(op)) {
    throw badRequest(`Unsupported op "${op}" for filter field "${def.label}".`);
  }
  // Dialect: local/sandbox runs SQLite; serverless deploys (Vercel + Neon)
  // run PostgreSQL. $queryRawUnsafe passes SQL through verbatim, so the
  // placeholder style and JSON helpers must match the actual engine.
  const IS_PG = (process.env.DATABASE_URL ?? "").trim().toLowerCase().startsWith("postgres");
  const ph = (i: number) => (IS_PG ? `$${i}` : "?");
  // json path is built from a charset-whitelisted key (KEY_RE) — no injection.
  // (NULLIF guards the cast for empty/NULL blobs; strict SRFs yield no rows on NULL.)
  const expr = IS_PG
    ? `NULLIF("custom", '')::jsonb->>'${def.key}'`
    : `json_extract("custom", '$."${def.key}"')`;
  let sql = `SELECT "id" FROM "Person" WHERE "orgId" = ${ph(1)} AND "deletedAt" IS NULL AND "mergedIntoId" IS NULL`;
  const params: (string | number)[] = [orgId];
  const push = (v: string | number) => { sql += ` ${ph(params.length + 1)}`; params.push(v); };

  const setOrMissing = (column: string, negate: boolean) => {
    sql += negate
      ? ` AND (${column} IS NULL OR ${column} = '')`
      : ` AND (${column} IS NOT NULL AND ${column} != '')`;
  };

  switch (op) {
    case "isSet":
      setOrMissing(expr, false);
      break;
    case "isMissing":
      setOrMissing(expr, true);
      break;
    case "is": {
      const v = validateValue(def, value);
      if (v === null) throw badRequest(`Filter "${def.label}" needs a value.`);
      const cast = def.dataType === "number"
        ? `CAST(${expr} AS REAL) = `
        : def.dataType === "boolean"
          ? `CAST(${expr} AS INTEGER) = `
          : `${expr} = `;
      sql += ` AND ${cast}`;
      push(def.dataType === "number" ? (v as number) : def.dataType === "boolean" ? (v ? 1 : 0) : String(v));
      break;
    }
    case "contains": {
      const s = String(value ?? "").trim();
      if (!s) throw badRequest(`Filter "${def.label}" needs text to search for.`);
      sql += ` AND ${expr} LIKE `;
      push(`%${likeEscape(s)}%`);
      sql += ` ESCAPE '\\'`;
      break;
    }
    case "has": {
      const v = validateValue(def, value);
      if (v === null || v === undefined) throw badRequest(`Filter "${def.label}" needs a value.`);
      if (IS_PG) {
        sql += ` AND EXISTS (SELECT 1 FROM json_array_elements_text(NULLIF("custom", '')::jsonb->'${def.key}') je WHERE je.value = `;
      } else {
        sql += ` AND EXISTS (SELECT 1 FROM json_each(${expr}) je WHERE je.value = `;
      }
      push(String(v));
      sql += `)`;
      break;
    }
    case "between":
    case "after":
    case "before": {
      const range = (value ?? {}) as { from?: unknown; to?: unknown };
      if (def.dataType === "number") {
        const from = range.from === undefined || range.from === "" ? null : validateValue(def, range.from);
        const to = range.to === undefined || range.to === "" ? null : validateValue(def, range.to);
        if (from === null && to === null) throw badRequest(`Filter "${def.label}" needs a from and/or to value.`);
        if (from !== null) { sql += ` AND CAST(${expr} AS REAL) >= `; push(from as number); }
        if (to !== null) { sql += ` AND CAST(${expr} AS REAL) <= `; push(to as number); }
      } else {
        // dates are stored as "YYYY-MM-DD" — ISO strings compare correctly
        const from = range.from ? validateValue(def, range.from) : null;
        const to = range.to ? validateValue(def, range.to) : null;
        if (!from && !to) throw badRequest(`Filter "${def.label}" needs a from and/or to date.`);
        if (from) { sql += ` AND ${expr} >= `; push(String(from)); }
        if (to) { sql += ` AND ${expr} <= `; push(String(to)); }
      }
      break;
    }
    default:
      throw badRequest(`Unsupported op "${op}".`);
  }

  const rows = await db.$queryRawUnsafe<{ id: string }[]>(sql, ...params);
  return rows.map((r) => r.id);
}
