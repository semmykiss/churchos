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
// Role metadata types + system role display info (client-safe, pure data)
// ===========================================================================
// The code MATRIX above is the immutable seed/default. Admins can edit roles +
// permissions at runtime via the Access Control module — those edits are persisted
// in the Role + RolePermission tables and take precedence on the SERVER side
// (requirePermission / canAsync — see lib/permissions-db.ts). Client-side can()
// + visibleModules() read the code matrix; the client also receives the effective
// matrix via /api/me.

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
