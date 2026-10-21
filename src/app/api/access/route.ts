// ChurchOS — Access Control API (Task ID 9)
// GET  /api/access  — returns the live permission matrix (from src/lib/permissions.ts)
//                      plus role-assignment counts and the users grouped by role.
//                      Requires `access:view` (church_admin + super_admin only).
//
// The matrix is CODE-DEFINED in src/lib/permissions.ts for security. This endpoint
// is a READ-ONLY viewer by design — admins can SEE exactly what each role can do.
// To change a role's permissions, the source code must be edited and the app redeployed.
// To change a user's role, use the Users & Roles endpoint (/api/settings/users).
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { MATRIX, MODULES, ROLES, ACTIONS, type Role, type Module, type Action } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// Render-safe matrix: convert the MATRIX into a plain JSON-friendly structure.
// We return role -> module -> actions[] (empty array when no entry exists).
function buildMatrixResponse() {
  const out: Record<string, Record<string, string[]>> = {}
  for (const role of ROLES) {
    out[role] = {}
    for (const mod of MODULES) {
      const actions = (MATRIX as Record<Role, Partial<Record<Module, Action[]>>>)[role]?.[mod] ?? []
      out[role][mod] = [...actions]
    }
  }
  return out
}

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('access', 'view')
  const canEdit = ctx.role === 'super_admin'

  // Fetch all users in the org (this endpoint is restricted to church_admin + super_admin,
  // so listing users is allowed). Include department for display.
  const users = await db.user.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      avatarUrl: true,
      active: true,
      departmentId: true,
      department: { select: { id: true, name: true, color: true } },
      lastLoginAt: true,
    },
  })

  // Group users by role. Include all known roles (even empty ones) so the UI can
  // show "0 users" for unassigned roles.
  const byRole: Record<string, typeof users> = {}
  for (const role of ROLES) byRole[role] = []
  for (const u of users) {
    if (!byRole[u.role]) byRole[u.role] = []
    byRole[u.role].push(u)
  }

  const roleAssignments = ROLES.map((role) => ({
    role,
    count: byRole[role].length,
    users: byRole[role].map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      phone: u.phone,
      avatarUrl: u.avatarUrl,
      active: u.active,
      departmentId: u.departmentId,
      department: u.department,
      lastLoginAt: u.lastLoginAt,
    })),
  }))

  // Audit sensitive access-control views (who inspected the permission matrix).
  await audit(ctx, 'access.matrix.view', 'organization', ctx.organizationId, {
    userCount: users.length,
  })

  return NextResponse.json({
    matrix: buildMatrixResponse(),
    modules: MODULES,
    roles: ROLES,
    actions: ACTIONS,
    roleAssignments,
    totalUsers: users.length,
    canEdit,
    currentUser: { id: ctx.user.id, role: ctx.role },
    // The matrix is code-defined for security. Documented here so the UI can
    // surface an authoritative notice to the admin.
    matrixSource: 'src/lib/permissions.ts (code-defined)',
  })
})
