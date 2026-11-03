/**
 * Permission catalogue + policy checks (backend only).
 * Mirrors 04-architecture.md §3.8: authorization is resolved server-side
 * per (user, tenant, module, action) before any data is returned.
 * Hiding a button is not a permission.
 *
 * ── Module access matrix (2026 restructure) ─────────────────────────────────
 * Every module — including Shepherd AI — has a single granular access level
 * per role: OFF(0) → READ_ONLY(1) → EDIT(2) → CREATE(3) → DELETE(4). Levels
 * stack: each includes every capability below it. The matrix is stored on
 * Role.accessMatrix (JSON) and EXPANDED into the flat permission keys below
 * at session-build time, so every router gate and in-service re-check keeps
 * enforcing without change. RolePermission rows continue to hold advanced
 * extras that don't fit the ladder (scoped/own-household grants, channel
 * sends, care-radar scoping, kiosk tokens…).
 */

export const PERMISSIONS = [
  "people.view", "people.create", "people.edit", "people.archive", "people.merge",
  // SCOPED: unlocks edit ONLY on the user's own profile, their household
  // members and their linked dependents — never grants global people.edit.
  // Enforced server-side per (user, targetPerson) in services/people.ts.
  "people.edit.own_household",
  "people.tags.manage", "people.groups.manage",
  // People CRM Phase 3: multi-select bulk actions (add tag / add to group /
  // change stage / assign shepherd / archive). The bulk endpoint STILL
  // re-checks the underlying right PER RECORD — this key only opens the door.
  "people.bulk",
  // People CRM Phase 3: create/edit/delete SHARED smart views (church-wide
  // lists). Personal views need no extra permission beyond people.view.
  "people.views.manage",
  // People CRM Phase 5: structured care notes on the profile (Notes & Care
  // tab). view gates reading the tab at all; create gates writing;
  // confidential rows are filtered out SERVER-SIDE for anyone without the
  // confidential key — they never appear in any response (notes or activity).
  "people.notes.view",
  "people.notes.create",
  "people.notes.confidential",
  // People CRM Phase 6: define/archive person custom-field definitions and run
  // the one-click presets. FILLING IN a field follows the field's own
  // editableByRoles list — this key is only about managing the definitions.
  "people.customfields.manage",
  // People CRM Phase 7: bulk import (CSV/XLSX wizard) and export of the
  // people list. Both are bulk data-in/out actions with their own audit
  // trails (ImportJob / PersonExportLog); import can be rolled back for 7
  // days, every export is logged for NDPA accountability.
  "people.import",
  "people.export",
  // People CRM Phase 7: manage the public Visitor Connect Card forms —
  // builder (fields / thank-you / approval queue), QR + short link, and the
  // submission review queue. Submitting needs NO permission (public form).
  "people.forms.manage",
  "groups.view", "groups.manage", "groups.attendance",
  "checkin.view", "checkin.manage", "checkin.kiosk",
  "events.view", "events.manage",
  // ── assets & facilities: register, maintenance log, bookings ──
  "assets.view",    // browse the register, maintenance history and booking requests
  "assets.edit",    // record maintenance, request/approve bookings, update records
  "assets.create",  // register new assets
  "assets.delete",  // remove assets / booking entries
  // ── giving: donor-facing self-service vs staff ledger vs accounting ──
  "giving.give",              // member: submit own gifts, manage own methods/recurring
  "giving.view.own",          // member: view own giving history + own statements
  "giving.view.all",          // finance/admin: view everyone's giving records
  "giving.record",            // finance/admin: record gifts on behalf of donors (cash/check)
  "giving.reverse",           // finance/admin: reverse a gift
  "giving.batches.manage",    // finance/admin: create/post batches
  "giving.funds.manage",      // finance/admin: create/edit funds
  "giving.pledges.manage",    // finance/admin: create pledges FOR others
  "giving.statements.manage", // finance/admin: generate/send statements for others
  // ── giving verification gate: usher two-person count + accountant post-to-GL ──
  "giving.verify.usher",      // Head Usher / Usher Counter: co-sign service count sheets
  "giving.verify.accountant", // Accountant: verify batches/transfers and post to GL
  // CANDIDATE: role holding this sees individual giving ONLY when the church
  // setting pastorCanViewIndividualGiving is true — lets churches keep gift
  // histories private from pastoral staff while still granting oversight.
  "giving.view.pastor",
  "accounting.view",          // finance/admin/pastor: chart of accounts, reports, budgets (read)
  "accounting.manage",        // finance/admin: bills, vendors, reconciliation, journals, budgets
  // ── payment voucher workflow: request → approve → disburse ──
  "accounting.vouchers.request",  // Department Heads / Pastors / Ushers: raise expense requisitions
  "accounting.vouchers.approve", // Senior Pastor / Treasurer / Board Signatory: approve before payment
  "comms.view", "comms.send", "comms.sms.send", "comms.email.send",
  "comms.whatsapp.send", // WhatsApp channel — template/broadcast/reply send
  "comms.chat.use", "comms.chat.churchwide",
  "consent.view",
  "schedule.view", "schedule.assign", "schedule.respond",
  "care.view", "care.create", "care.manage",
  "pipeline.view",          // leaders/admins/follow-up volunteers: kanban + journey
  "pipeline.manage",        // admin: configure stages + sequences
  "pipeline.tasks.own",     // assigned volunteer: see/complete own tasks
  "pipeline.tasks.all",     // admin/pastor: see all tasks across volunteers
  "workflows.view", "workflows.manage",
  "reports.view",
  // ── AI Beyond the Chat: sermon studio ──
  "sermon.view",           // open Sermon Studio (series/sermon library read)
  "sermon.create",         // create sermons + generate AI drafts
  "sermon.edit",           // edit sermon content/drafts
  "sermon.manage",         // series management + delete/preached lifecycle
  "sermon.library.manage", // worship song library CRUD
  // ── AI Beyond the Chat: care radar (deterministic, human-reviewed) ──
  "care.risk.view",        // see risk flags scoped to the viewer (e.g. own small groups)
  "care.risk.view.all",    // church-wide risk flags (pastoral/admin only)
  "care.risk.manage",      // acknowledge/resolve/dismiss flags + configure thresholds
  // ── AI Beyond the Chat: serving (extends existing schedule.*) ──
  "serving.view.own",      // volunteer self-service: own schedule, availability, swaps
  "serving.schedule.manage", // team leaders: run rota engine, commit/publish rotas
  // ── AI Beyond the Chat: board reporting ──
  "reports.board.generate", // generate board/trustee reports (intentional, audited grant)
  "reports.board.view",     // view/download previously generated board reports
  "reports.templates.manage", // admin: create/edit report templates
  "admin.view", "admin.manage", "audit.view",
  "portal.use",
  // ── Shepherd AI assistant (module-matrix gated) ──
  "ai.use",                // open & chat with the Shepherd AI assistant
  "ai.admin",              // AI administration: crisis-flag review queue + tool audit trail
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// ── Module access matrix ─────────────────────────────────────────────────────

export const ACCESS_LEVELS = [
  { value: 0, label: "OFF", short: "OFF", description: "No access — module hidden" },
  { value: 1, label: "Read only", short: "READ", description: "View existing records" },
  { value: 2, label: "Edit / Modify", short: "EDIT", description: "Read + change existing records" },
  { value: 3, label: "Create", short: "CREATE", description: "Read + edit + add new records" },
  { value: 4, label: "Delete (Full)", short: "DELETE", description: "Everything, including remove/archive" },
] as const;
export type AccessLevel = 0 | 1 | 2 | 3 | 4;

/** Every matrix-gated module, in display order. "ai" = Shepherd AI assistant. */
export const MODULE_KEYS = [
  "dashboard", "people", "groups", "checkin", "events", "assets", "volunteers", "care",
  "pipeline", "sermons", "giving", "accounting", "comms", "whatsapp", "reports",
  "workflows", "admin", "portal", "ai",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface MatrixModuleDef {
  key: ModuleKey;
  label: string;
  group: "overview" | "ministry" | "finance" | "system" | "ai";
  /** Per-level caveat shown in the admin editor (levels still stack). */
  hint?: string;
}

export const MODULE_CATALOGUE: MatrixModuleDef[] = [
  { key: "dashboard", label: "This Week (dashboard)", group: "overview" },
  { key: "people", label: "People & households", group: "ministry" },
  { key: "groups", label: "Departments", group: "ministry" },
  { key: "checkin", label: "Check-in", group: "ministry" },
  { key: "events", label: "Events & services", group: "ministry" },
  { key: "assets", label: "Assets & Facilities", group: "ministry", hint: "Edit = record maintenance & approve bookings · Create = register assets · Delete = remove records" },
  { key: "volunteers", label: "Volunteers & scheduling", group: "ministry" },
  { key: "care", label: "Care (pastoral cases)", group: "ministry" },
  { key: "pipeline", label: "Follow-up pipeline", group: "ministry" },
  { key: "sermons", label: "Sermon Studio", group: "ministry" },
  { key: "giving", label: "Giving", group: "finance", hint: "Read = own gifts only · Edit = record gifts · Create = full giving office (sees all donors) · Delete = + reversals" },
  { key: "accounting", label: "Accounting", group: "finance" },
  { key: "comms", label: "Communications (SMS/Email/Chat)", group: "finance", hint: "Edit unlocks channel sending" },
  { key: "whatsapp", label: "WhatsApp", group: "finance" },
  { key: "reports", label: "Reports", group: "finance", hint: "Create unlocks board-report generation" },
  { key: "workflows", label: "Workflows (automation)", group: "system" },
  { key: "admin", label: "Administration", group: "system", hint: "Edit = manage roles & users + audit log" },
  { key: "portal", label: "My Portal (self-service)", group: "system", hint: "Edit = also update own household details" },
  { key: "ai", label: "Shepherd AI", group: "ai", hint: "Any ON level = chat with Shepherd AI · Delete = + AI administration (crisis review queue & tool audit trail)" },
];

/**
 * What each module level UNLOCKS, expressed in the flat permission keys the
 * router gate and services already enforce. Tier keys union downward:
 * level 3 grants view+edit+create keys of that module.
 */
export const MODULE_CAPABILITIES: Record<ModuleKey, { view: string[]; edit: string[]; create: string[]; delete: string[] }> = {
  dashboard:  { view: ["reports.view"], edit: [], create: [], delete: [] },
  people:     { view: ["people.view"], edit: ["people.edit", "people.tags.manage", "people.groups.manage", "people.bulk", "people.notes.view", "people.notes.create"], create: ["people.create", "people.views.manage", "people.import", "people.export"], delete: ["people.archive", "people.merge", "people.customfields.manage", "people.forms.manage"] },
  groups:     { view: ["groups.view"], edit: ["groups.attendance"], create: ["groups.manage"], delete: [] },
  checkin:    { view: ["checkin.view"], edit: ["checkin.manage"], create: ["checkin.kiosk"], delete: [] },
  events:     { view: ["events.view"], edit: ["events.manage"], create: [], delete: [] },
  assets:     { view: ["assets.view"], edit: ["assets.edit"], create: ["assets.create"], delete: ["assets.delete"] },
  volunteers: { view: ["schedule.view", "serving.view.own"], edit: ["schedule.respond"], create: ["schedule.assign", "serving.schedule.manage"], delete: [] },
  care:       { view: ["care.view"], edit: ["care.manage"], create: ["care.create"], delete: [] },
  pipeline:   { view: ["pipeline.view", "pipeline.tasks.own"], edit: [], create: ["pipeline.manage", "pipeline.tasks.all"], delete: [] },
  sermons:    { view: ["sermon.view"], edit: ["sermon.edit"], create: ["sermon.create"], delete: ["sermon.manage", "sermon.library.manage"] },
  giving:     { view: ["giving.view.own", "giving.give"], edit: ["giving.record"], create: ["giving.view.all", "giving.batches.manage", "giving.funds.manage", "giving.pledges.manage", "giving.statements.manage", "giving.verify.usher", "giving.verify.accountant"], delete: ["giving.reverse"] },
  accounting: { view: ["accounting.view"], edit: ["accounting.manage"], create: ["accounting.vouchers.request"], delete: ["accounting.vouchers.approve"] },
  comms:      { view: ["comms.view", "comms.chat.use", "consent.view"], edit: ["comms.send", "comms.sms.send", "comms.email.send"], create: ["comms.chat.churchwide"], delete: [] },
  whatsapp:   { view: ["comms.view"], edit: ["comms.whatsapp.send"], create: [], delete: [] },
  reports:    { view: ["reports.view", "reports.board.view"], edit: [], create: ["reports.board.generate", "reports.templates.manage"], delete: [] },
  workflows:  { view: ["workflows.view"], edit: ["workflows.manage"], create: [], delete: [] },
  admin:      { view: ["admin.view"], edit: ["admin.manage", "audit.view"], create: [], delete: [] },
  portal:     { view: ["portal.use"], edit: ["people.edit.own_household"], create: [], delete: [] },
  ai:         { view: ["ai.use"], edit: ["ai.use"], create: ["ai.use"], delete: ["ai.use", "ai.admin"] },
};

export type AccessMatrix = Partial<Record<ModuleKey, number>>;

/** Union of flat permission keys granted by a module matrix. */
export function permissionsForMatrix(matrix: AccessMatrix): string[] {
  const out = new Set<string>();
  for (const key of MODULE_KEYS) {
    const level = Math.max(0, Math.min(4, Math.floor(Number(matrix[key] ?? 0))));
    if (!level) continue;
    const cap = MODULE_CAPABILITIES[key];
    const tiers = [cap.view, cap.edit, cap.create, cap.delete];
    for (let t = 0; t < level; t++) for (const p of tiers[t]) out.add(p);
  }
  return [...out];
}

/** Merge several roles' matrices — highest level wins per module (roles stack). */
export function mergeMatrices(matrices: AccessMatrix[]): AccessMatrix {
  const out: AccessMatrix = {};
  for (const m of matrices) {
    if (!m) continue;
    for (const key of MODULE_KEYS) {
      const v = Math.max(0, Math.min(4, Math.floor(Number(m[key] ?? 0)))) as AccessLevel;
      out[key] = Math.max(out[key] ?? 0, v) as AccessLevel;
    }
  }
  return out;
}

const FULL_MATRIX: AccessMatrix = Object.fromEntries(MODULE_KEYS.map((k) => [k, 4]));

/** Parse a stored Role.accessMatrix JSON string (null-safe). */
export function parseAccessMatrix(raw: string | null | undefined): AccessMatrix | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as AccessMatrix;
  } catch {
    return null;
  }
}

/**
 * Reverse-map flat permission rows → a module matrix (used to backfill custom
 * roles created before the matrix existed). A tier counts only when ALL of its
 * keys are held; empty tiers are skipped downward.
 */
export function deriveMatrixFromPermissions(perms: string[]): AccessMatrix {
  const held = new Set(perms);
  const full = held.has("*");
  const out: AccessMatrix = {};
  for (const key of MODULE_KEYS) {
    const cap = MODULE_CAPABILITIES[key];
    let level = 0;
    const tiers: string[][] = [cap.delete, cap.create, cap.edit, cap.view];
    for (let t = 0; t < tiers.length; t++) {
      const keys = tiers[t];
      if (!keys.length) continue;
      if (full || keys.every((k) => held.has(k))) { level = 4 - t; break; }
    }
    if (!level && cap.view.some((k) => full || held.has(k))) level = 1;
    out[key] = level as AccessLevel;
  }
  return out;
}

/**
 * Effective module access for a membership: merge each assigned role's matrix
 * (highest level wins). Roles carrying "*" or the owner key are full-access.
 * Roles with no stored matrix are derived from their permission rows so
 * pre-matrix roles keep working without migration.
 */
export function moduleAccessForRoles(
  roles: { key: string; accessMatrix?: string | null; permissions?: { permission: string }[] }[]
): Record<string, number> {
  const matrices: AccessMatrix[] = roles.map((r) => {
    if (r.key === "owner" || (r.permissions ?? []).some((p) => p.permission === "*")) return FULL_MATRIX;
    const stored = parseAccessMatrix(r.accessMatrix);
    if (stored) return stored;
    return deriveMatrixFromPermissions((r.permissions ?? []).map((p) => p.permission));
  });
  return mergeMatrices(matrices);
}

/** Validate an incoming matrix payload — unknown modules or levels rejected. */
export function validateAccessMatrix(input: unknown): AccessMatrix {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("accessMatrix must be an object.");
  const validModules = new Set<string>(MODULE_KEYS);
  const out: AccessMatrix = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "" || Number(v) === 0) continue; // OFF = omit
    if (!validModules.has(k)) throw new Error(`Unknown module "${k}".`);
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 4) throw new Error(`Access level for "${k}" must be between 0 (OFF) and 4 (Delete).`);
    out[k as ModuleKey] = n as AccessLevel;
  }
  return out;
}

export function serializeAccessMatrix(matrix: AccessMatrix): string {
  return JSON.stringify(matrix ?? {});
}

// ── Session identity ─────────────────────────────────────────────────────────

export interface SessionUser {
  sessionId: string;
  userId: string;
  membershipId: string;
  orgId: string;
  orgName: string;
  campusId: string | null;
  campusName: string | null;
  email: string;
  name: string;
  personId: string | null;
  roleKeys: string[];
  roleNames: string[];
  permissions: string[]; // expanded, wildcard-resolved (matrix-derived keys included)
  /** Effective per-module access levels (max across the user's roles). 0=OFF. */
  moduleAccess: Record<string, number>;
  amr: string;
  /** Raw JSON preferences blob from User (theme etc.). Optional/additive. */
  preferences?: string | null;
}

/** Resolve wildcard patterns: "*" grants everything; "giving.*" grants "giving.view". */
export function can(user: Pick<SessionUser, "permissions"> | null, required: string): boolean {
  if (!user) return false;
  for (const p of user.permissions) {
    if (p === "*" || p === required) return true;
    if (p.endsWith(".*") && required.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

export function canAny(user: Pick<SessionUser, "permissions"> | null, required: string[]): boolean {
  return required.some((r) => can(user, r));
}

/** Effective module level for a session user (0 when absent → OFF). */
export function moduleLevel(user: Pick<SessionUser, "moduleAccess"> | null, key: string): number {
  if (!user?.moduleAccess) return 0;
  return user.moduleAccess[key] ?? 0;
}

/**
 * Channel-specific send permissions — SMS and Email are gated independently.
 * The legacy "comms.send" grant still authorizes both channels so existing
 * roles keep working until an admin splits them in the permission matrix.
 */
export const CHANNEL_SEND_PERMISSION: Record<string, string> = {
  sms: "comms.sms.send",
  email: "comms.email.send",
  whatsapp: "comms.whatsapp.send",
};

export function canSendChannel(user: Pick<SessionUser, "permissions"> | null, channel: string): boolean {
  if (!user) return false;
  if (can(user, CHANNEL_SEND_PERMISSION[channel] ?? "__none__")) return true;
  return can(user, "comms.send");
}

// ── Preset roles ─────────────────────────────────────────────────────────────

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  /** Module access ladder for this preset. */
  matrix: AccessMatrix;
  /** Advanced grants beyond the module ladder (stored in RolePermission rows). */
  extras: string[];
}

const m = (spec: Partial<Record<ModuleKey, number>>): AccessMatrix => spec;

/**
 * Preset access levels — the out-of-the-box church team. Custom roles created
 * in Administration start from any of these (or blank) and are fully editable.
 */
export const SYSTEM_ROLES: Record<string, SystemRoleDef> = {
  owner: {
    key: "owner",
    name: "Owner / Super Admin",
    description: "Full access to every module and setting. Cannot be edited or deleted.",
    matrix: FULL_MATRIX,
    extras: ["*"], // expanded wildcard — kept for backwards compatibility
  },
  campus_admin: {
    key: "campus_admin",
    name: "Church Admin",
    description: "Runs the church office: every ministry, finance and administration module.",
    matrix: m({
      dashboard: 4, people: 4, groups: 4, checkin: 4, events: 4, assets: 4, volunteers: 4, care: 4,
      pipeline: 4, sermons: 4, giving: 4, accounting: 4, comms: 4, whatsapp: 4, reports: 4,
      workflows: 4, admin: 4, portal: 4, ai: 4,
    }),
    extras: ["people.notes.confidential"],
  },
  finance: {
    key: "finance",
    name: "Church Accountant",
    description: "Treasurer: full giving ledger, accounting, budgets and board reports. Verifies giving and posts to the GL.",
    matrix: m({
      dashboard: 1, people: 1, giving: 4, accounting: 4, assets: 2, reports: 3,
      comms: 1, portal: 2, ai: 2,
    }),
    extras: ["audit.view", "giving.verify.accountant"],
  },
  pastor: {
    key: "pastor",
    name: "Pastor",
    description: "Pastoral care, follow-up and preaching. Individual giving stays private unless the church enables it in Settings. Can raise payment voucher requisitions.",
    matrix: m({
      dashboard: 1, people: 2, groups: 1, events: 2, assets: 1, volunteers: 1, care: 4,
      pipeline: 3, sermons: 3, giving: 1, accounting: 1, comms: 2, whatsapp: 1,
      reports: 2, portal: 2, ai: 4,
    }),
    extras: ["giving.view.pastor", "care.risk.view.all", "care.risk.manage", "pipeline.tasks.all", "people.notes.confidential", "accounting.vouchers.approve"],
  },
  head_usher: {
    key: "head_usher",
    name: "Head Usher",
    description: "Runs Sunday front-of-house: check-in stations, service events, usher roster and offering count sheets (two-person verification).",
    matrix: m({
      dashboard: 1, people: 1, checkin: 3, events: 2, assets: 1, volunteers: 2, care: 1,
      giving: 2, comms: 1, portal: 1, ai: 1,
    }),
    extras: ["giving.verify.usher"],
  },
  minister: {
    key: "minister",
    name: "Minister",
    description: "Department minister: shepherds people, groups and follow-up in their department. Can raise payment voucher requisitions.",
    matrix: m({
      dashboard: 1, people: 2, groups: 2, checkin: 1, events: 2, assets: 1, volunteers: 1,
      care: 2, pipeline: 2, sermons: 1, reports: 1, comms: 1, portal: 1, ai: 2,
    }),
    extras: ["accounting.vouchers.request"],
  },
  ministry_leader: {
    key: "ministry_leader",
    name: "HOD / Ministry Leader",
    description: "Head of department: leads a ministry end-to-end — people, groups, scheduling, care and follow-up. Can raise payment voucher requisitions.",
    matrix: m({
      dashboard: 1, people: 3, groups: 3, checkin: 2, events: 3, assets: 3, volunteers: 3,
      care: 3, pipeline: 3, sermons: 2, giving: 1, accounting: 1, comms: 3,
      whatsapp: 1, reports: 2, portal: 2, ai: 2,
    }),
    extras: ["giving.view.pastor", "care.risk.view.all", "care.risk.manage", "accounting.vouchers.request"],
  },
  volunteer: {
    key: "volunteer",
    name: "Volunteer",
    description: "Serves on a team: own serving schedule, check-in station help and church chat.",
    matrix: m({
      people: 1, checkin: 1, events: 1, volunteers: 1, pipeline: 1,
      giving: 1, comms: 1, portal: 1, ai: 1,
    }),
    extras: ["checkin.kiosk", "pipeline.tasks.own"],
  },
  member: {
    key: "member",
    name: "Member",
    description: "Regular member: self-service portal, own giving history, their own groups, events and church chat.",
    matrix: m({
      groups: 1, events: 1, giving: 1, comms: 1, portal: 2, ai: 1,
    }),
    extras: [],
  },
  parent: {
    key: "parent",
    name: "Parent / Guardian",
    description: "Scoped self-service: edit own household & dependents, own giving, their own groups, chat.",
    matrix: m({
      groups: 1, events: 1, giving: 1, comms: 1, portal: 2, ai: 1,
    }),
    extras: [],
  },
};

/**
 * Legacy flat bundles (derived from SYSTEM_ROLES: matrix permissions ∪ extras).
 * Kept in the old Record<string, string[]> shape because tenant onboarding,
 * partner provisioning and the demo seed build RolePermission rows from it.
 */
export const ROLE_TEMPLATES: Record<string, string[]> = Object.fromEntries(
  Object.values(SYSTEM_ROLES).map((r) => [
    r.key,
    r.key === "owner" ? ["*"] : [...new Set([...permissionsForMatrix(r.matrix), ...r.extras])].sort(),
  ])
);
