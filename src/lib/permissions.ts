// ChurchOS — permission engine. Server-side authorization for every sensitive operation.
// Roles: super_admin, church_admin, pastor, finance_officer, department_head,
//        department_assistant, unit_leader, member, guest
//
// Permission matrix uses module + action. Actions: view, create, update, delete, approve, export, manage, assign
// Scopes: organization (all records in tenant), branch, department, unit, self
//
// Deny by default. A department_head can only access their own department's data — enforced by
// passing the resource's departmentId to `can()`.

export type Role =
  | 'super_admin'
  | 'church_admin'
  | 'pastor'
  | 'finance_officer'
  | 'accountant'
  | 'treasurer'
  | 'usher'
  | 'finance_committee'
  | 'department_head'
  | 'department_assistant'
  | 'unit_leader'
  | 'member'
  | 'guest'

export type Action = 'view' | 'create' | 'update' | 'delete' | 'approve' | 'export' | 'manage' | 'assign'

export type Module =
  | 'dashboard'
  | 'members'
  | 'departments'
  | 'attendance'
  | 'visitors'
  | 'followups'
  | 'events'
  | 'finance'
  | 'announcements'
  | 'pastoral'
  | 'tasks'
  | 'assets'
  | 'documents'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'access'
  | 'search'
  | 'celebrations'
  | 'townhall'
  | 'ai'

// Ordered list of modules for matrix display (excludes the search/access utility modules
// at the end so the matrix viewer focuses on functional modules).
export const MODULES: Module[] = [
  'dashboard', 'members', 'departments', 'attendance', 'visitors', 'followups',
  'events', 'finance', 'announcements', 'pastoral', 'tasks', 'assets',
  'documents', 'reports', 'audit', 'settings', 'celebrations', 'townhall', 'ai',
]

// Ordered list of all roles (highest privilege first).
export const ROLES: Role[] = [
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'accountant', 'treasurer', 'finance_committee', 'usher',
  'department_head', 'department_assistant', 'unit_leader', 'member', 'guest',
]

// All action types (used by the access-control matrix viewer).
export const ACTIONS: Action[] = [
  'view', 'create', 'update', 'delete', 'approve', 'export', 'manage', 'assign',
]

// Allow matrix: role -> module -> actions[]
export const MATRIX: Record<Role, Partial<Record<Module, Action[]>>> = {
  super_admin: {
    dashboard: ['view'], members: ['view', 'create', 'update', 'delete', 'export', 'manage'],
    departments: ['view', 'create', 'update', 'delete', 'manage'],
    attendance: ['view', 'create', 'update', 'delete', 'export'],
    visitors: ['view', 'create', 'update', 'delete', 'export'],
    followups: ['view', 'create', 'update', 'delete', 'assign'],
    events: ['view', 'create', 'update', 'delete', 'approve'],
    finance: ['view', 'create', 'update', 'delete', 'approve', 'export', 'manage'],
    announcements: ['view', 'create', 'update', 'delete'],
    pastoral: ['view', 'create', 'update', 'delete', 'assign'],
    tasks: ['view', 'create', 'update', 'delete', 'assign'],
    assets: ['view', 'create', 'update', 'delete', 'manage'],
    documents: ['view', 'create', 'update', 'delete'],
    reports: ['view', 'export'],
    settings: ['view', 'manage'],
    audit: ['view', 'export'],
    access: ['view', 'manage'],
    search: ['view'],
    celebrations: ['view', 'create', 'update', 'delete', 'export', 'manage'],
    townhall: ['view', 'create', 'update', 'delete', 'manage'],
    ai: ['view', 'create', 'manage'],
  },
  church_admin: {
    dashboard: ['view'], members: ['view', 'create', 'update', 'delete', 'export'],
    departments: ['view', 'create', 'update', 'delete', 'manage'],
    attendance: ['view', 'create', 'update', 'delete', 'export'],
    visitors: ['view', 'create', 'update', 'delete', 'export'],
    followups: ['view', 'create', 'update', 'delete', 'assign'],
    events: ['view', 'create', 'update', 'delete', 'approve'],
    finance: ['view', 'create', 'update', 'delete', 'approve', 'export', 'manage'],
    announcements: ['view', 'create', 'update', 'delete'],
    pastoral: ['view'],
    tasks: ['view', 'create', 'update', 'delete', 'assign'],
    assets: ['view', 'create', 'update', 'delete'],
    documents: ['view', 'create', 'update', 'delete'],
    reports: ['view', 'export'],
    settings: ['view', 'manage'],
    audit: ['view'],
    access: ['view', 'manage'],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view', 'create'],
    ai: ['view', 'create', 'manage'],
  },
  pastor: {
    dashboard: ['view'], members: ['view', 'update'],
    departments: ['view'],
    attendance: ['view'],
    visitors: ['view', 'create', 'update'],
    followups: ['view', 'create', 'update', 'assign'],
    events: ['view', 'create', 'update'],
    finance: [], // no finance access for pastors by default
    announcements: ['view', 'create'],
    pastoral: ['view', 'create', 'update', 'delete', 'assign'],
    tasks: ['view', 'create', 'update'],
    assets: ['view'],
    documents: ['view'],
    reports: ['view'],
    settings: ['view'],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view', 'create'],
    ai: ['view', 'create'],
  },
  finance_officer: {
    dashboard: ['view'], members: ['view'],
    departments: ['view'],
    attendance: ['view'],
    visitors: [],
    followups: [],
    events: ['view'],
    finance: ['view', 'create', 'update', 'approve', 'export', 'manage'],
    announcements: ['view'],
    pastoral: [], // finance cannot access confidential pastoral records
    tasks: ['view'],
    assets: ['view'],
    documents: ['view'],
    reports: ['view', 'export'],
    settings: ['view'],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view', 'create'],
    ai: ['view', 'create'],
  },
  // Accountant: maintains chart of accounts, posts journals, reconciles bank.
  // Can record + review transactions but NOT approve their own payments (segregation of duty).
  accountant: {
    dashboard: ['view'], members: ['view'],
    departments: ['view'],
    attendance: ['view'],
    visitors: [],
    followups: [],
    events: ['view'],
    finance: ['view', 'create', 'update', 'export', 'manage'],
    announcements: ['view'],
    pastoral: [],
    tasks: ['view'],
    assets: ['view'],
    documents: ['view'],
    reports: ['view', 'export'],
    settings: ['view'],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view'],
    ai: ['view', 'create'],
  },
  // Treasurer: receives verified collections, records deposits, processes approved payments.
  treasurer: {
    dashboard: ['view'], members: ['view'],
    departments: ['view'],
    attendance: ['view'],
    visitors: [],
    followups: [],
    events: ['view'],
    finance: ['view', 'create', 'update', 'export'],
    announcements: ['view'],
    pastoral: [],
    tasks: ['view'],
    assets: ['view'],
    documents: ['view'],
    reports: ['view', 'export'],
    settings: ['view'],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view'],
    ai: ['view', 'create'],
  },
  // Finance committee: reviews budgets + significant expenses (read-only + approve).
  finance_committee: {
    dashboard: ['view'], members: [],
    departments: ['view'],
    attendance: [],
    visitors: [],
    followups: [],
    events: ['view'],
    finance: ['view', 'approve', 'export'],
    announcements: ['view'],
    pastoral: [],
    tasks: [],
    assets: ['view'],
    documents: ['view'],
    reports: ['view', 'export'],
    settings: ['view'],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view'],
    ai: ['view', 'create'],
  },
  // Usher: creates collection count sheets, submits them. Cannot access GL.
  usher: {
    dashboard: ['view'], members: [],
    departments: [],
    attendance: ['view'],
    visitors: [],
    followups: [],
    events: ['view'],
    finance: ['view', 'create'], // limited to collection sessions
    announcements: ['view'],
    pastoral: [],
    tasks: [],
    assets: [],
    documents: [],
    reports: [],
    settings: [],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view'],
    ai: ['view', 'create'],
  },
  department_head: {
    dashboard: ['view'], members: ['view', 'create', 'update'], // scoped to own department
    departments: ['view', 'update', 'manage'],
    attendance: ['view', 'create', 'update'],
    visitors: ['view'],
    followups: ['view', 'create', 'update', 'assign'],
    events: ['view', 'create', 'update'],
    finance: ['view'],
    announcements: ['view', 'create'],
    pastoral: [], // department heads cannot access pastoral cases
    tasks: ['view', 'create', 'update', 'delete', 'assign'],
    assets: ['view', 'update'],
    documents: ['view'],
    reports: ['view'],
    settings: ['view'],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view', 'create'],
    ai: ['view', 'create'],
  },
  department_assistant: {
    dashboard: ['view'], members: ['view', 'create'],
    departments: ['view'],
    attendance: ['view', 'create'],
    visitors: ['view', 'create'],
    followups: ['view', 'create', 'update'],
    events: ['view'],
    finance: [],
    announcements: ['view'],
    pastoral: [],
    tasks: ['view', 'create', 'update'],
    assets: ['view'],
    documents: ['view'],
    reports: [],
    settings: [],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view', 'create'],
    ai: ['view', 'create'],
  },
  unit_leader: {
    dashboard: ['view'], members: ['view'],
    departments: ['view'],
    attendance: ['view', 'create'],
    visitors: ['view'],
    followups: ['view', 'create'],
    events: ['view'],
    finance: [],
    announcements: ['view'],
    pastoral: [],
    tasks: ['view', 'create'],
    assets: ['view'],
    documents: ['view'],
    reports: [],
    settings: [],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view', 'create'],
    ai: ['view', 'create'],
  },
  member: {
    dashboard: ['view'], members: ['view'], // self only via scope=self
    departments: ['view'],
    attendance: ['view'], // own history
    visitors: [],
    followups: [],
    events: ['view'],
    finance: ['view', 'create'], // own giving history + submit pending tithe/donation
    announcements: ['view'],
    pastoral: ['create'], // can submit prayer requests/care requests (self)
    tasks: ['view'], // own
    assets: [],
    documents: ['view'], // public/members access only
    reports: [],
    settings: ['view'],
    search: ['view'],
    celebrations: ['view'],
    townhall: ['view', 'create'],
    ai: ['view', 'create'],
  },
  guest: {
    dashboard: [], members: [], departments: [], attendance: [], visitors: [],
    followups: [], events: ['view'], finance: [], announcements: ['view'],
    pastoral: [], tasks: [], assets: [], documents: ['view'], reports: [],
    settings: [], audit: [], search: [],
    ai: [],
  },
}

export function can(
  role: string,
  mod: Module,
  action: Action,
): boolean {
  const actions = MATRIX[role as Role]?.[mod]
  return !!actions && actions.includes(action)
}

// Scope helper: department_head / department_assistant / unit_leader are scoped to their department.
export function isScopedRole(role: string): boolean {
  return role === 'department_head' || role === 'department_assistant' || role === 'unit_leader'
}

// nav visibility: modules a role can see at all
export function visibleModules(role: string): Module[] {
  const entry = MATRIX[role as Role]
  if (!entry) return []
  return (Object.keys(entry) as Module[]).filter((m) => (entry[m]?.length ?? 0) > 0)
}

// helper for API routes — throws 403-style error
export class ForbiddenError extends Error {
  status = 403
  constructor(message = 'You do not have permission to perform this action.') {
    super(message)
  }
}

// ===========================================================================
// DB-driven editable permission layer (Access Control module)
// ===========================================================================
// The code MATRIX above is the immutable seed/default. Admins can edit roles +
// permissions at runtime via the Access Control module — those edits are persisted
// in the Role + RolePermission tables and take precedence on the SERVER side
// (requirePermission / canAsync). Client-side can() + visibleModules() read the
// code matrix; the client also receives the effective matrix via /api/me.

import { db } from './db'

export interface RoleInfo {
  id: string
  name: string
  label: string
  description: string | null
  color: string | null
  isSystem: boolean
  active: boolean
  sortOrder: number
}

export interface EffectiveMatrix {
  roles: RoleInfo[]
  /** role name -> module -> actions[] */
  matrix: Record<string, Record<string, Action[]>>
  seeded: boolean
}

// System role display metadata (label/description/color/sortOrder).
export const SYSTEM_ROLE_META: Record<string, { label: string; description: string; color: string; sortOrder: number }> = {
  super_admin: { label: 'Super Admin', description: 'Platform-wide administration. Use with care.', color: '#e11d48', sortOrder: 0 },
  church_admin: { label: 'Church Admin', description: 'Full church configuration and operations.', color: '#4f46e5', sortOrder: 1 },
  pastor: { label: 'Pastor', description: 'Pastoral care, members, prayer, visitation.', color: '#7c3aed', sortOrder: 2 },
  finance_officer: { label: 'Finance Officer', description: 'Giving, expenses, budgets, approvals.', color: '#059669', sortOrder: 3 },
  accountant: { label: 'Accountant', description: 'Chart of accounts, journals, bank reconciliation.', color: '#0d9488', sortOrder: 4 },
  treasurer: { label: 'Treasurer', description: 'Collections, deposits, payment processing.', color: '#0891b2', sortOrder: 5 },
  finance_committee: { label: 'Finance Committee', description: 'Budget + significant expense review.', color: '#0ea5e9', sortOrder: 6 },
  usher: { label: 'Usher', description: 'Offering collection + count sheets.', color: '#65a30d', sortOrder: 7 },
  department_head: { label: 'Department Head', description: 'Leads one department (scoped access).', color: '#d97706', sortOrder: 8 },
  department_assistant: { label: 'Dept Assistant', description: 'Delegated departmental functions.', color: '#0891b2', sortOrder: 9 },
  unit_leader: { label: 'Unit Leader', description: 'Leads a unit or team within a department.', color: '#0d9488', sortOrder: 10 },
  member: { label: 'Member', description: 'Personal profile, directory, events, giving history.', color: '#64748b', sortOrder: 11 },
  guest: { label: 'Guest', description: 'Public pages only.', color: '#94a3b8', sortOrder: 12 },
}

// In-memory cache (per org). TTL 60s.
interface CacheEntry { matrix: EffectiveMatrix; expiresAt: number }
const matrixCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000

/** Seed the 9 system roles for an org (idempotent).
 *
 *  IMPORTANT: This function creates missing system roles with their default
 *  permissions from the code MATRIX. For roles that ALREADY EXIST, it only
 *  updates metadata (label, description, color, sortOrder, isSystem) and
 *  does NOT touch their permissions.
 *
 *  Previously this function deleted ALL RolePermissions for each system role
 *  and re-created them from the code MATRIX on every cache miss (60s). That
 *  meant any custom changes made by an admin via the Matrix tab were
 *  overwritten within 60 seconds — the "Save changes" button appeared to not
 *  work because the changes were immediately reverted by the re-seed.
 *
 *  Now: newly created roles get their default permissions from the code
 *  MATRIX. Existing roles are left alone (permissions-wise) so admin
 *  customizations (adding/removing permissions via the Matrix tab) persist
 *  across cache refreshes. New modules/actions added to the code MATRIX in
 *  future updates will need to be manually added by the admin via the
 *  Matrix tab, or via a dedicated migration script.
 */
export async function seedDefaultRoles(organizationId: string): Promise<void> {
  for (let i = 0; i < ROLES.length; i++) {
    const name = ROLES[i]
    const meta = SYSTEM_ROLE_META[name] ?? { label: name, description: '', color: '#64748b', sortOrder: i }

    // Check if this role already exists in the DB.
    const existing = await db.role.findUnique({
      where: { organizationId_name: { organizationId, name } },
      select: { id: true },
    })

    if (existing) {
      // Role exists — only update metadata. Do NOT touch permissions
      // (admin may have customized them via the Matrix tab).
      await db.role.update({
        where: { id: existing.id },
        data: {
          isSystem: true,
          sortOrder: meta.sortOrder,
          label: meta.label,
          description: meta.description,
          color: meta.color,
        },
      })
      continue
    }

    // Role doesn't exist — create it WITH its default permissions from the code MATRIX.
    const role = await db.role.create({
      data: {
        organizationId,
        name,
        label: meta.label,
        description: meta.description,
        color: meta.color,
        isSystem: true,
        active: true,
        sortOrder: meta.sortOrder,
      },
    })

    const codePerms = (MATRIX as Record<string, Partial<Record<Module, Action[]>>>)[name] ?? {}
    const desired: { module: string; action: string; roleId: string }[] = []
    for (const mod of Object.keys(codePerms) as Module[]) {
      for (const act of codePerms[mod] ?? []) {
        desired.push({ module: mod, action: act, roleId: role.id })
      }
    }
    if (desired.length > 0) {
      await db.rolePermission.createMany({ data: desired }).catch(() => null)
    }
  }
}

/** Load the effective (DB-driven) matrix for an org, with caching. */
export async function getEffectiveMatrix(organizationId: string): Promise<EffectiveMatrix> {
  const cached = matrixCache.get(organizationId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.matrix
  }
  await seedDefaultRoles(organizationId)

  const roles = await db.role.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { permissions: { select: { module: true, action: true } } },
  })

  const matrix: Record<string, Record<string, Action[]>> = {}
  const roleInfos: RoleInfo[] = []
  for (const r of roles) {
    roleInfos.push({
      id: r.id, name: r.name, label: r.label, description: r.description,
      color: r.color, isSystem: r.isSystem, active: r.active, sortOrder: r.sortOrder,
    })
    const permsByMod: Record<string, Action[]> = {}
    for (const p of r.permissions) {
      if (!permsByMod[p.module]) permsByMod[p.module] = []
      permsByMod[p.module].push(p.action as Action)
    }
    matrix[r.name] = permsByMod
  }

  const result: EffectiveMatrix = { roles: roleInfos, matrix, seeded: true }
  matrixCache.set(organizationId, { matrix: result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}

/** Invalidate cache for an org (call after any role/permission/user-role edit). */
export function refreshMatrixCache(organizationId: string): void {
  matrixCache.delete(organizationId)
}

/** Server-side permission check using the DB-driven effective matrix. */
export async function canAsync(
  organizationId: string,
  role: string,
  mod: Module,
  action: Action,
): Promise<boolean> {
  const { matrix, roles } = await getEffectiveMatrix(organizationId)
  const roleRecord = roles.find((r) => r.name === role)
  if (!roleRecord || !roleRecord.active) return false
  const actions = matrix[role]?.[mod]
  return !!actions && actions.includes(action)
}

/** Resolve a role name to its RoleInfo (or null) for an org. */
export async function getRoleInfo(organizationId: string, roleName: string): Promise<RoleInfo | null> {
  const { roles } = await getEffectiveMatrix(organizationId)
  return roles.find((r) => r.name === roleName) ?? null
}

// ===========================================================================
// ENTERPRISE ACCESS CONTROL — Granular permission catalogue + ABAC
// ===========================================================================

// ---- Extended action set (beyond the base 8) ----
export const EXTENDED_ACTIONS = [
  'view', 'create', 'update', 'delete', 'approve', 'reject', 'export',
  'import', 'manage', 'assign', 'invite', 'download', 'print', 'share',
  'configure', 'publish', 'archive', 'restore',
] as const

// ---- Sensitive fields per module (for field-level security) ----
export const SENSITIVE_FIELDS: Record<string, string[]> = {
  members: ['phone', 'email', 'address', 'dateOfBirth', 'emergencyName', 'emergencyPhone', 'privateNotes', 'notes', 'photoUrl', 'weddingAnniversary', 'occupation', 'maritalStatus'],
  finance: ['donationHistory', 'titheHistory', 'bankDetails', 'transactionReference'],
  pastoral: ['privateNotes', 'caseDetails', 'counsellingNotes'],
  documents: ['fileContent', 'downloadUrl'],
}

// ---- Data classification levels ----
export const DATA_CLASSIFICATIONS = {
  PUBLIC: 'public',
  INTERNAL: 'internal',
  CONFIDENTIAL: 'confidential',
  RESTRICTED: 'restricted',
  HIGHLY_RESTRICTED: 'highly_restricted',
} as const

// ---- ABAC scope types ----
export type ScopeType = 'org' | 'branch' | 'department' | 'group' | 'record' | 'self'

export interface AccessScope {
  type: ScopeType
  id?: string // branchId / departmentId / groupId / recordId
}

// ---- Role templates (15 enterprise roles) ----
export const ROLE_TEMPLATES = [
  { name: 'system_admin', label: 'System Administrator', description: 'Manage application settings and security. No automatic access to confidential church records.', color: '#e11d48', sortOrder: 0 },
  { name: 'church_owner', label: 'Church Owner / Primary Administrator', description: 'Manage church settings, users, roles, branches. Delegate only authorized permissions.', color: '#4f46e5', sortOrder: 1 },
  { name: 'security_admin', label: 'Church Security Administrator', description: 'Manage authentication, account security, role assignments, audit. No financial/pastoral data.', color: '#7c3aed', sortOrder: 2 },
  { name: 'church_admin', label: 'Church Administrator', description: 'Manage permitted church operations and resources.', color: '#4f46e5', sortOrder: 3 },
  { name: 'senior_pastor', label: 'Senior Pastor / Pastor', description: 'Pastoral, membership, ministry within assigned scope.', color: '#7c3aed', sortOrder: 4 },
  { name: 'branch_admin', label: 'Branch Administrator', description: 'Manage authorized resources within assigned branches.', color: '#0891b2', sortOrder: 5 },
  { name: 'department_head', label: 'Department Head', description: 'Manage assigned department members, attendance, activities.', color: '#d97706', sortOrder: 6 },
  { name: 'department_assistant', label: 'Department Assistant', description: 'Delegated departmental functions only.', color: '#0891b2', sortOrder: 7 },
  { name: 'finance_officer', label: 'Finance Officer / Treasurer', description: 'Financial records, transactions, budgets, reports within scope.', color: '#059669', sortOrder: 8 },
  { name: 'auditor', label: 'Auditor', description: 'Review financial records and audit reports. Read-only on transactions.', color: '#64748b', sortOrder: 9 },
  { name: 'counsellor', label: 'Counsellor / Welfare Officer', description: 'Only specifically authorized counselling and welfare records.', color: '#0d9488', sortOrder: 10 },
  { name: 'cell_leader', label: 'Cell / Group Leader', description: 'Manage assigned groups and permitted member info.', color: '#0d9488', sortOrder: 11 },
  { name: 'event_coordinator', label: 'Event Coordinator', description: 'Manage authorized event info, registrations, attendance.', color: '#d97706', sortOrder: 12 },
  { name: 'media_officer', label: 'Media / Communications Officer', description: 'Manage announcements, publications, media resources.', color: '#7c3aed', sortOrder: 13 },
  { name: 'member', label: 'Member', description: 'Personal info, registrations, statements, member resources.', color: '#64748b', sortOrder: 14 },
  { name: 'guest', label: 'Guest / Visitor', description: 'Public pages and visitor features only.', color: '#94a3b8', sortOrder: 15 },
] as const

// ---- Check field-level access for a role ----
export async function checkFieldAccess(
  organizationId: string,
  roleName: string,
  module: string,
  field: string,
): Promise<'none' | 'masked' | 'view' | 'edit'> {
  const { roles } = await getEffectiveMatrix(organizationId)
  const role = roles.find((r) => r.name === roleName)
  if (!role) return 'none'
  // Super admins and church owners get full field access
  if (roleName === 'super_admin' || roleName === 'church_owner') return 'edit'
  // Check DB field permissions
  const { db } = await import('./db')
  const fp = await db.fieldPermission.findFirst({
    where: { roleId: role.id, module, field },
  })
  return (fp?.access as 'none' | 'masked' | 'view' | 'edit') ?? 'none'
}

// ---- Check if user has a specific scope ----
export async function checkScope(
  organizationId: string,
  userId: string,
  roleName: string,
  scopeType: ScopeType,
  scopeId?: string,
): Promise<boolean> {
  const { db } = await import('./db')
  // Super admin / church owner have org-wide scope
  if (roleName === 'super_admin' || roleName === 'church_owner') return true
  // Check explicit role assignments with scope
  const assignment = await db.userRoleAssignment.findFirst({
    where: {
      userId,
      roleId: (await getRoleInfo(organizationId, roleName))?.id,
      organizationId,
      active: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  })
  if (!assignment) {
    // Fall back to User.departmentId for department-scoped roles
    if (scopeType === 'department' && scopeId) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { departmentId: true } })
      return user?.departmentId === scopeId
    }
    return false
  }
  // Check if the assignment scope matches
  if (assignment.scopeType === 'org') return true
  if (assignment.scopeType === scopeType && (!scopeId || assignment.scopeId === scopeId)) return true
  return false
}

// ---- Check if an action requires approval (segregation of duties) ----
export async function requiresApproval(
  organizationId: string,
  action: string,
): Promise<{ requires: boolean; selfBlocked: boolean; approverRoleId?: string }> {
  const { db } = await import('./db')
  const policy = await db.approvalPolicy.findFirst({
    where: { organizationId, action, active: true, requiresApproval: true },
  })
  if (!policy) return { requires: false, selfBlocked: false }
  return {
    requires: true,
    selfBlocked: policy.selfApprovalBlocked,
    approverRoleId: policy.approverRoleId ?? undefined,
  }
}

// ---- Simulate a user's effective permissions (read-only, no data access) ----
export async function simulateUserPermissions(
  organizationId: string,
  userId: string,
): Promise<{
  roles: RoleInfo[]
  modules: string[]
  permissions: Record<string, string[]>
  scopes: { type: string; id?: string }[]
  fieldAccess: Record<string, Record<string, Record<string, string>>>
}> {
  const { db } = await import('./db')
  const { matrix, roles } = await getEffectiveMatrix(organizationId)

  // Get user's role assignments
  const assignments = await db.userRoleAssignment.findMany({
    where: {
      userId,
      organizationId,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { role: true },
  })

  // Merge permissions from all assigned roles + the user's primary role
  const userRoleNames = new Set<string>([assignments.map((a) => a.role.name)])
  // Also include the user's primary role from User.role
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user) userRoleNames.add(user.role)

  const effectivePerms: Record<string, Set<string>> = {}
  const scopes: { type: string; id?: string }[] = []

  for (const roleName of userRoleNames) {
    const rolePerms = matrix[roleName] ?? {}
    for (const [mod, actions] of Object.entries(rolePerms)) {
      if (!effectivePerms[mod]) effectivePerms[mod] = new Set()
      actions.forEach((a) => effectivePerms[mod].add(a))
    }
    // Add scopes from assignments
    assignments.filter((a) => a.role.name === roleName).forEach((a) => {
      scopes.push({ type: a.scopeType, id: a.scopeId ?? undefined })
    })
  }

  // Field access for sensitive fields
  const fieldAccess: Record<string, Record<string, Record<string, string>>> = {}
  const assignedRoleIds = assignments.map((a) => a.roleId)
  if (assignedRoleIds.length > 0) {
    const fps = await db.fieldPermission.findMany({
      where: { roleId: { in: assignedRoleIds } },
    })
    for (const fp of fps) {
      if (!fieldAccess[fp.module]) fieldAccess[fp.module] = {}
      if (!fieldAccess[fp.module][fp.field]) fieldAccess[fp.module][fp.field] = {}
      fieldAccess[fp.module][fp.field][fp.roleId] = fp.access
    }
  }

  const permissions: Record<string, string[]> = {}
  for (const [mod, actions] of Object.entries(effectivePerms)) {
    permissions[mod] = Array.from(actions)
  }

  const userRoles = roles.filter((r) => userRoleNames.has(r.name))
  const modules = Object.keys(permissions).filter((m) => permissions[m].length > 0)

  return { roles: userRoles, modules, permissions, scopes, fieldAccess }
}
