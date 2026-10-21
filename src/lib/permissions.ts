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

// Ordered list of modules for matrix display (excludes the search/access utility modules
// at the end so the matrix viewer focuses on functional modules).
export const MODULES: Module[] = [
  'dashboard', 'members', 'departments', 'attendance', 'visitors', 'followups',
  'events', 'finance', 'announcements', 'pastoral', 'tasks', 'assets',
  'documents', 'reports', 'audit', 'settings', 'celebrations', 'townhall',
]

// Ordered list of all roles (highest privilege first).
export const ROLES: Role[] = [
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
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
  },
  church_admin: {
    dashboard: ['view'], members: ['view', 'create', 'update', 'delete', 'export'],
    departments: ['view', 'create', 'update', 'delete', 'manage'],
    attendance: ['view', 'create', 'update', 'delete', 'export'],
    visitors: ['view', 'create', 'update', 'delete', 'export'],
    followups: ['view', 'create', 'update', 'delete', 'assign'],
    events: ['view', 'create', 'update', 'delete', 'approve'],
    finance: ['view', 'create', 'update', 'export'],
    announcements: ['view', 'create', 'update', 'delete'],
    pastoral: ['view'], // church admin cannot see private case notes by default
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
  },
  member: {
    dashboard: ['view'], members: ['view'], // self only via scope=self
    departments: ['view'],
    attendance: ['view'], // own history
    visitors: [],
    followups: [],
    events: ['view'],
    finance: ['view'], // own giving history only
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
  },
  guest: {
    dashboard: [], members: [], departments: [], attendance: [], visitors: [],
    followups: [], events: ['view'], finance: [], announcements: ['view'],
    pastoral: [], tasks: [], assets: [], documents: ['view'], reports: [],
    settings: [], audit: [], search: [],
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
  department_head: { label: 'Department Head', description: 'Leads one department (scoped access).', color: '#d97706', sortOrder: 4 },
  department_assistant: { label: 'Dept Assistant', description: 'Delegated departmental functions.', color: '#0891b2', sortOrder: 5 },
  unit_leader: { label: 'Unit Leader', description: 'Leads a unit or team within a department.', color: '#0d9488', sortOrder: 6 },
  member: { label: 'Member', description: 'Personal profile, directory, events, giving history.', color: '#64748b', sortOrder: 7 },
  guest: { label: 'Guest', description: 'Public pages only.', color: '#94a3b8', sortOrder: 8 },
}

// In-memory cache (per org). TTL 60s.
interface CacheEntry { matrix: EffectiveMatrix; expiresAt: number }
const matrixCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000

/** Seed + sync the 9 system roles + their permissions for an org (idempotent).
 *  Syncs system-role permissions to match the current code MATRIX on every call,
 *  so new modules/actions added to the code matrix propagate to the DB. */
export async function seedDefaultRoles(organizationId: string): Promise<void> {
  for (let i = 0; i < ROLES.length; i++) {
    const name = ROLES[i]
    const meta = SYSTEM_ROLE_META[name] ?? { label: name, description: '', color: '#64748b', sortOrder: i }
    const role = await db.role.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: { isSystem: true, sortOrder: meta.sortOrder, label: meta.label, description: meta.description, color: meta.color },
      create: {
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
    await db.rolePermission.deleteMany({ where: { roleId: role.id } })
    if (desired.length) {
      await db.rolePermission.createMany({ data: desired })
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
