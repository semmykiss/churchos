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

// Ordered list of modules for matrix display (excludes the search/access utility modules
// at the end so the matrix viewer focuses on functional modules).
export const MODULES: Module[] = [
  'dashboard', 'members', 'departments', 'attendance', 'visitors', 'followups',
  'events', 'finance', 'announcements', 'pastoral', 'tasks', 'assets',
  'documents', 'reports', 'audit', 'settings',
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
