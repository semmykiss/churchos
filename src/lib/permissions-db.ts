// ChurchOS — Server-only DB-driven permission layer (Access Control module)
//
// Split from lib/permissions.ts so the client-safe pure matrix (types, ROLES,
// MATRIX, SYSTEM_ROLE_META, can/visibleModules) never pulls Prisma/fs into the
// client bundle (Vercel Turbopack build failed with "Can't resolve 'fs'"
// because app-shell.tsx -> permissions.ts -> db.ts is a client component chain).
//
// Everything in here requires a Node.js runtime. Import ONLY from server code
// (API routes, src/lib/api.ts, AI context, repositories).
import { db } from './db'
import {
  ROLES, MATRIX, SYSTEM_ROLE_META,
  type Module, type Action,
  type RoleInfo, type EffectiveMatrix,
} from './permissions'

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
  scopeType: 'org' | 'branch' | 'department' | 'group' | 'record' | 'self',
  scopeId?: string,
): Promise<boolean> {
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
