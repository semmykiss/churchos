// ChurchOS — Access Control · Role assignments (Task ID 26)
// GET    /api/access/roles/[id]/assignments — users assigned to this role (scopes + expiry).
// POST   /api/access/roles/[id]/assignments — assign role to user (multi-role + scope + expiry).
//        Body: { userId, scopeType?, scopeId?, expiresAt?, reason? }
// DELETE /api/access/roles/[id]/assignments — unassign.
//        Body: { assignmentId }
//
// Permission: can('access','manage') for POST/DELETE (church_admin + super_admin),
//             can('access','view')  for GET.
// Note: spec calls for `access:assign` but church_admin only has `access:manage` (not
// `access:assign`). To keep administrators functional, we use `access:manage` — the
// same gate the existing PATCH /api/access/assign endpoint uses.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'
import { refreshMatrixCache } from '@/lib/permissions-db'

export const dynamic = 'force-dynamic'

const VALID_SCOPE_TYPES = new Set(['org', 'branch', 'department', 'group', 'record', 'self'])

// GET — list users assigned to this role with scopes + expiry
export const GET = apiHandler(async (_req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'view')
  const { id } = await ctx2.params

  const role = await db.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, name: true, label: true },
  })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  const assignments = await db.userRoleAssignment.findMany({
    where: { roleId: role.id, organizationId: ctx.organizationId },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, role: true, avatarUrl: true,
          active: true, lastLoginAt: true,
          department: { select: { id: true, name: true, color: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
  })

  return NextResponse.json({
    role: { id: role.id, name: role.name, label: role.label },
    assignments: assignments.map((a) => ({
      id: a.id,
      userId: a.userId,
      // Required by ManageAccessDialog: it flattens assignments across ALL
      // roles into one list, so each entry must carry its own roleId — both
      // to resolve the role label and to build the DELETE target URL.
      // (Missing roleId rendered every assignment as "Unknown role" and made
      // unassign DELETE hit /roles/undefined/assignments → 404.)
      roleId: a.roleId,
      scopeType: a.scopeType,
      scopeId: a.scopeId,
      expiresAt: a.expiresAt,
      reason: a.reason,
      active: a.active,
      createdAt: a.createdAt,
      user: a.user,
    })),
    total: assignments.length,
    activeCount: assignments.filter((a) => a.active && (!a.expiresAt || new Date(a.expiresAt) > new Date())).length,
  })
})

// POST — assign role to user
export const POST = apiHandler(async (req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'manage')
  const { id: roleId } = await ctx2.params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const userId = String(body.userId ?? '').trim()
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  // Prevent self-assignment to super_admin (lockout protection / segregation of duties)
  if (userId === ctx.user.id) {
    throw new ForbiddenError('You cannot assign roles to yourself. Ask another administrator.')
  }

  const scopeType = body.scopeType ? String(body.scopeType).trim() : 'org'
  if (!VALID_SCOPE_TYPES.has(scopeType)) {
    return NextResponse.json({ error: `Invalid scopeType "${scopeType}"` }, { status: 400 })
  }
  const scopeId = body.scopeId ? String(body.scopeId).trim() : null
  const expiresAt = body.expiresAt ? new Date(body.expiresAt as string) : null
  if (expiresAt && isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: 'Invalid expiresAt date' }, { status: 400 })
  }
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'expiresAt must be in the future' }, { status: 400 })
  }
  const reason = body.reason ? String(body.reason).trim() : null

  // Validate role + user both belong to this org
  const [role, user] = await Promise.all([
    db.role.findFirst({
      where: { id: roleId, organizationId: ctx.organizationId },
      select: { id: true, name: true, label: true, active: true },
    }),
    db.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId },
      select: { id: true, name: true, email: true, role: true },
    }),
  ])
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!role.active) {
    return NextResponse.json({ error: 'Cannot assign an inactive role.' }, { status: 400 })
  }

  // super_admin requires super_admin ctx (defense in depth)
  if (role.name === 'super_admin' && ctx.role !== 'super_admin') {
    throw new ForbiddenError('Only Super Admins can assign the Super Admin role.')
  }

  // Enforce the unique constraint by upserting (userId+roleId+scopeType+scopeId)
  const assignment = await db.userRoleAssignment.upsert({
    where: {
      userId_roleId_scopeType_scopeId: {
        userId, roleId: role.id, scopeType,
        scopeId: scopeId ?? '',
      },
    },
    update: {
      active: true,
      expiresAt,
      reason,
      grantedById: ctx.user.id,
    },
    create: {
      organizationId: ctx.organizationId,
      userId,
      roleId: role.id,
      scopeType,
      scopeId,
      grantedById: ctx.user.id,
      expiresAt,
      reason,
      active: true,
    },
  })

  await audit(ctx, 'access.role.assign', 'user', user.id, {
    userId, roleName: role.name, scopeType, scopeId,
    expiresAt: expiresAt ? expiresAt.toISOString() : null, reason,
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({
    ok: true,
    assignment: {
      id: assignment.id,
      userId: assignment.userId,
      roleId: assignment.roleId,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      expiresAt: assignment.expiresAt,
      reason: assignment.reason,
      active: assignment.active,
      createdAt: assignment.createdAt,
    },
    user: { id: user.id, name: user.name, email: user.email },
    role: { id: role.id, name: role.name, label: role.label },
  }, { status: 201 })
})

// DELETE — unassign (deactivate by assignmentId)
export const DELETE = apiHandler(async (req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'manage')
  const { id: roleId } = await ctx2.params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const assignmentId = String(body.assignmentId ?? '').trim()
  if (!assignmentId) {
    return NextResponse.json({ error: 'assignmentId is required' }, { status: 400 })
  }

  const assignment = await db.userRoleAssignment.findFirst({
    where: { id: assignmentId, roleId, organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true, email: true } }, role: { select: { id: true, name: true } } },
  })
  if (!assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  // Lockout: don't allow removing the last super_admin assignment
  if (assignment.role.name === 'super_admin' && assignment.active) {
    const activeSuper = await db.userRoleAssignment.count({
      where: {
        organizationId: ctx.organizationId,
        role: { name: 'super_admin' },
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    })
    if (activeSuper <= 1) {
      throw new ForbiddenError('Cannot remove the last active Super Admin assignment.')
    }
  }

  await db.userRoleAssignment.update({
    where: { id: assignment.id },
    data: { active: false },
  })

  await audit(ctx, 'access.role.unassign', 'user', assignment.user.id, {
    assignmentId: assignment.id,
    roleName: assignment.role.name,
    userId: assignment.user.id,
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({
    ok: true,
    assignmentId: assignment.id,
    deactivated: true,
  })
})
