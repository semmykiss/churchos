/**
 * People CRM Phase 3 — saved smart views (personal & shared directory lists).
 *
 * A saved view is a named bundle of { filters, columns, sort, viewType }. It
 * never stores people rows: applying a view just feeds its filter JSON into
 * the SAME permission-scoped list endpoint (POST /people/v2/list), so what a
 * viewer sees is always decided by the people serializer, never by the view.
 *
 * Scope rules (server-enforced):
 *   • system defaults — defined IN CODE below, immutable, visible to everyone
 *     with people.view. Nothing is seeded, so nothing can drift per tenant.
 *   • personal — visible + editable only by their owner.
 *   • shared — visible to everyone with people.view; create/edit/delete
 *     requires the "people.views.manage" permission.
 */
import { db } from "@/server/db";
import { can, type SessionUser } from "@/server/permissions";
import { badRequest, forbidden, notFound } from "@/server/http";
import { audit } from "@/server/audit";
import { buildPeopleV2Where, type PeopleFilterGroup } from "@/server/services/people";

export type SavedViewScope = "system" | "personal" | "shared";
export type SavedViewType = "table" | "cards" | "board";

export interface SavedViewSort {
  sort: string;
  dir: "asc" | "desc";
}

export interface SavedViewDTO {
  id: string;
  /** System defaults carry stable "sys:*" keys; DB rows echo their row id. */
  key: string | null;
  name: string;
  description: string | null;
  scope: SavedViewScope;
  viewType: SavedViewType;
  filters: PeopleFilterGroup | null;
  columns: string[] | null;
  sort: SavedViewSort | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

const VIEW_TYPES: Set<string> = new Set(["table", "cards", "board"]);
const SORT_KEYS: Set<string> = new Set(["name", "lastSeen", "age", "stage", "status", "createdAt"]);
const COLUMN_IDS: Set<string> = new Set(["name", "contact", "household", "stage", "groups", "lastSeen", "age", "campus"]);
const MAX_NAME = 80;
const MAX_CONDITIONS = 20;

// ── the 8 shipped defaults (Phase 3 spec) ───────────────────────────────────

interface SystemViewDef {
  key: string;
  name: string;
  description: string;
  viewType: SavedViewType;
  filters: PeopleFilterGroup | null;
}

export const SYSTEM_VIEWS: SystemViewDef[] = [
  { key: "sys:all-people", name: "All people", description: "Everyone in the directory", viewType: "table", filters: null },
  {
    key: "sys:new-visitors",
    name: "New visitors (30 days)",
    description: "People added to the church in the last 30 days",
    viewType: "table",
    filters: { match: "all", conditions: [{ field: "created", op: "withinLast", value: { days: 30 } }] },
  },
  {
    key: "sys:members",
    name: "Members",
    description: "Confirmed members of the church",
    viewType: "table",
    filters: { match: "all", conditions: [{ field: "stage", op: "is", value: "member" }] },
  },
  {
    key: "sys:children-youth",
    name: "Children & Youth",
    description: "Under-18s (children and teens)",
    viewType: "cards",
    filters: {
      match: "any",
      conditions: [
        { field: "ageCategory", op: "is", value: "child" },
        { field: "ageCategory", op: "is", value: "teen" },
      ],
    },
  },
  {
    key: "sys:not-seen-4w",
    name: "Not seen in 4 weeks",
    description: "No attendance recorded in the last 4 weeks (or ever)",
    viewType: "table",
    filters: {
      match: "any",
      conditions: [
        { field: "lastAttended", op: "olderThan", value: { days: 28 } },
        { field: "lastAttended", op: "isMissing" },
      ],
    },
  },
  {
    key: "sys:birthdays-month",
    name: "Birthdays this month",
    description: "Birthdays falling in the current calendar month",
    viewType: "table",
    filters: { match: "all", conditions: [{ field: "birthdayMonth", op: "is", value: "current" }] },
  },
  {
    key: "sys:no-group",
    name: "Unassigned to a group",
    description: "People not in any active group — a follow-up gap",
    viewType: "table",
    filters: { match: "all", conditions: [{ field: "group", op: "none" }] },
  },
  {
    key: "sys:leaders-workers",
    name: "Leaders & Workers",
    description: "Leaders plus everyone serving on a team",
    viewType: "table",
    filters: {
      match: "any",
      conditions: [
        { field: "stage", op: "is", value: "leader" },
        { field: "groupType", op: "is", value: "serve_team" },
        { field: "groupType", op: "is", value: "ministry" },
      ],
    },
  },
];

function systemViewDTO(user: SessionUser, def: SystemViewDef): SavedViewDTO {
  return {
    id: def.key,
    key: def.key,
    name: def.name,
    description: def.description,
    scope: "system",
    viewType: def.viewType,
    filters: def.filters,
    columns: null,
    sort: null,
    ownerId: null,
    ownerName: null,
    createdAt: "",
    updatedAt: "",
    canEdit: false,
    canDelete: false,
  };
}

function canManageShared(user: SessionUser): boolean {
  return can(user, "people.views.manage");
}

/** Validate the filter JSON by dry-running it through the REAL list engine —
 *  an invalid field/op saved today would 400 every future open otherwise. */
async function validatedFilters(
  user: SessionUser,
  filters: unknown
): Promise<PeopleFilterGroup | null> {
  if (filters === null || filters === undefined) return null;
  if (typeof filters !== "object" || Array.isArray(filters)) throw badRequest("filters must be an object.");
  const group = filters as PeopleFilterGroup;
  if (!Array.isArray(group.conditions)) throw badRequest("filters.conditions must be an array.");
  if (group.conditions.length > MAX_CONDITIONS) throw badRequest(`A view can hold at most ${MAX_CONDITIONS} conditions.`);
  for (const c of group.conditions) {
    if (!c || typeof c.field !== "string" || typeof c.op !== "string") {
      throw badRequest("Every filter condition needs a field and an op.");
    }
  }
  const normalized: PeopleFilterGroup = {
    match: group.match === "any" ? "any" : "all",
    conditions: group.conditions,
  };
  // throws badRequest on unknown fields/ops
  await buildPeopleV2Where(user, { filters: normalized });
  return normalized;
}

function validatedColumns(columns: unknown): string[] | null {
  if (columns === null || columns === undefined) return null;
  if (!Array.isArray(columns)) throw badRequest("columns must be an array of column ids.");
  const cols = columns.filter((c): c is string => {
    if (typeof c !== "string") return false;
    if (COLUMN_IDS.has(c)) return true;
    // People CRM (Phase 6): custom-field columns ("custom:<key>"). Accepted
    // leniently here (charset-checked); a def archived later just renders no
    // column instead of breaking every saved view that referenced it.
    if (c.startsWith("custom:")) return /^[a-z0-9_]{1,40}$/.test(c.slice(7));
    return false;
  });
  if (cols.length === 0) return null;
  return cols.includes("name") ? cols : ["name", ...cols];
}

function validatedSort(sort: unknown): SavedViewSort | null {
  if (sort === null || sort === undefined) return null;
  if (typeof sort !== "object") throw badRequest("sort must be an object.");
  const s = sort as Partial<SavedViewSort>;
  if (!s.sort || !SORT_KEYS.has(s.sort)) throw badRequest("Unknown sort key.");
  return { sort: s.sort, dir: s.dir === "desc" ? "desc" : "asc" };
}

function validatedViewType(v: unknown): SavedViewType {
  if (v === null || v === undefined) return "table";
  if (typeof v !== "string" || !VIEW_TYPES.has(v)) throw badRequest("viewType must be table, cards or board.");
  return v as SavedViewType;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function listSavedViews(user: SessionUser): Promise<{ items: SavedViewDTO[] }> {
  const rows = await db.savedView.findMany({
    where: {
      orgId: user.orgId,
      deletedAt: null,
      OR: [
        { scope: "shared" },
        { scope: "personal", ownerId: user.userId },
      ],
    },
    include: { owner: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const manageShared = canManageShared(user);
  const items: SavedViewDTO[] = [
    ...SYSTEM_VIEWS.map((d) => systemViewDTO(user, d)),
    ...rows.map((r): SavedViewDTO => {
      const own = r.scope === "personal" && r.ownerId === user.userId;
      const editable = r.scope === "shared" ? manageShared : own;
      return {
        id: r.id,
        key: null,
        name: r.name,
        description: null,
        scope: r.scope as SavedViewScope,
        viewType: (VIEW_TYPES.has(r.viewType) ? r.viewType : "table") as SavedViewType,
        filters: parseJson<PeopleFilterGroup | null>(r.filterJson, null),
        columns: parseJson<string[] | null>(r.columnsJson, null),
        sort: parseJson<SavedViewSort | null>(r.sortJson, null),
        ownerId: r.ownerId,
        ownerName: r.owner?.name ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        canEdit: editable,
        canDelete: editable,
      };
    }),
  ];
  return { items };
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface SaveViewInput {
  name?: string;
  scope?: string;
  viewType?: string;
  filters?: unknown;
  columns?: unknown;
  sort?: unknown;
}

export async function createSavedView(
  user: SessionUser,
  input: SaveViewInput,
  meta: { ip?: string; userAgent?: string }
): Promise<SavedViewDTO> {
  const name = String(input.name ?? "").trim();
  if (!name) throw badRequest("Give the view a name.");
  if (name.length > MAX_NAME) throw badRequest(`View names are capped at ${MAX_NAME} characters.`);

  const scope = input.scope === "shared" ? "shared" : "personal";
  if (scope === "shared" && !canManageShared(user)) {
    throw forbidden('Sharing a view with the whole church requires "people.views.manage".');
  }

  const filters = await validatedFilters(user, input.filters ?? null);
  const row = await db.savedView.create({
    data: {
      orgId: user.orgId,
      ownerId: user.userId,
      scope,
      name,
      viewType: validatedViewType(input.viewType),
      filterJson: filters ? JSON.stringify(filters) : null,
      columnsJson: (() => {
        const c = validatedColumns(input.columns);
        return c ? JSON.stringify(c) : null;
      })(),
      sortJson: (() => {
        const s = validatedSort(input.sort);
        return s ? JSON.stringify(s) : null;
      })(),
    },
    include: { owner: { select: { name: true } } },
  });

  await audit({
    orgId: user.orgId, actor: user, action: "people.view.create", entityType: "saved_view", entityId: row.id,
    after: { name: row.name, scope: row.scope },
    ip: meta.ip, userAgent: meta.userAgent,
  });

  return {
    id: row.id, key: null, name: row.name, description: null,
    scope: row.scope as SavedViewScope, viewType: row.viewType as SavedViewType,
    filters, columns: validatedColumns(input.columns), sort: validatedSort(input.sort),
    ownerId: row.ownerId, ownerName: row.owner?.name ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    canEdit: true, canDelete: true,
  };
}

async function loadEditableView(user: SessionUser, id: string) {
  const row = await db.savedView.findFirst({
    where: { id, orgId: user.orgId, deletedAt: null },
    include: { owner: { select: { name: true } } },
  });
  if (!row) throw notFound("Saved view not found.");
  const own = row.scope === "personal" && row.ownerId === user.userId;
  if (row.scope === "shared" && !canManageShared(user)) {
    throw forbidden('Managing a shared view requires "people.views.manage".');
  }
  if (row.scope === "personal" && !own) throw forbidden("You can only change your own views.");
  return row;
}

export async function updateSavedView(
  user: SessionUser,
  id: string,
  input: SaveViewInput,
  meta: { ip?: string; userAgent?: string }
): Promise<SavedViewDTO> {
  const row = await loadEditableView(user, id);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (!name) throw badRequest("Give the view a name.");
    if (name.length > MAX_NAME) throw badRequest(`View names are capped at ${MAX_NAME} characters.`);
    data.name = name;
  }
  if (input.scope !== undefined && input.scope !== row.scope) {
    const nextScope = input.scope === "shared" ? "shared" : "personal";
    if (nextScope === "shared" && !canManageShared(user)) {
      throw forbidden('Sharing a view with the whole church requires "people.views.manage".');
    }
    data.scope = nextScope;
  }
  if (input.viewType !== undefined) data.viewType = validatedViewType(input.viewType);
  if (input.filters !== undefined) {
    const filters = await validatedFilters(user, input.filters);
    data.filterJson = filters ? JSON.stringify(filters) : null;
  }
  if (input.columns !== undefined) {
    const c = validatedColumns(input.columns);
    data.columnsJson = c ? JSON.stringify(c) : null;
  }
  if (input.sort !== undefined) {
    const s = validatedSort(input.sort);
    data.sortJson = s ? JSON.stringify(s) : null;
  }

  const updated = await db.savedView.update({
    where: { id: row.id },
    data,
    include: { owner: { select: { name: true } } },
  });

  await audit({
    orgId: user.orgId, actor: user, action: "people.view.update", entityType: "saved_view", entityId: row.id,
    after: { name: updated.name, scope: updated.scope },
    ip: meta.ip, userAgent: meta.userAgent,
  });

  return {
    id: updated.id, key: null, name: updated.name, description: null,
    scope: updated.scope as SavedViewScope, viewType: updated.viewType as SavedViewType,
    filters: parseJson<PeopleFilterGroup | null>(updated.filterJson, null),
    columns: parseJson<string[] | null>(updated.columnsJson, null),
    sort: parseJson<SavedViewSort | null>(updated.sortJson, null),
    ownerId: updated.ownerId, ownerName: updated.owner?.name ?? null,
    createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(),
    canEdit: true, canDelete: true,
  };
}

export async function deleteSavedView(
  user: SessionUser,
  id: string,
  meta: { ip?: string; userAgent?: string }
): Promise<{ ok: true }> {
  const row = await loadEditableView(user, id);
  await db.savedView.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "people.view.delete", entityType: "saved_view", entityId: row.id,
    before: { name: row.name, scope: row.scope },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}
