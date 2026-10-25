// ChurchOS — Access Control · Role detail (Task ID 26)
// GET    /api/access/roles/[id] — role detail with permissions grouped by module
//                                  + field permissions + assigned users count.
// PATCH  /api/access/roles/[id] — update label/description/color/active.
//                                  System roles cannot be deleted but can be retired.
//                                  Cannot change name.
// DELETE /api/access/roles/[id] — delete a CUSTOM role only. Before deleting,
//                                  reassign users to 'member' role. System roles → 403.
//
// Permission: can('access','manage') for PATCH/DELETE, can('access','view') for GET.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import {
  ForbiddenError, MODULES, ACTIONS, type Module, type Action,
} from '@/lib/permissions'
import { refreshMatrixCache } from '@/lib/permissions-db'

export const dynamic = 'force-dynamic'

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/

// Lockout protection: these (role, module, action) tuples can never be removed.
// Without them, super_admin could lock themselves out of the access-control module.
const LOCKED_PERMISSIONS: { roleName: string; module: string; action: string }[] = [
  { roleName: 'super_admin', module: 'access', action: 'manage' },
  { roleName: 'super_admin', module: 'access', action: 'view' },
  { roleName: 'super_admin', module: 'dashboard', action: 'view' },
]

// GET — role detail (grouped permissions + fields + assignments count)
export const GET = apiHandler(async (_req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'view')
  const { id } = await ctx2.params

  const role = await db.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      permissions: true,
      fieldPermissions: true,
      assignments: {
        where: { active: true },
        include: {
          user: {
            select: {
              id: true, name: true, email: true, role: true,
              avatarUrl: true, active: true, lastLoginAt: true,
              department: { select: { id: true, name: true, color: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  // Group permissions by module
  const permissionsByModule: Record<string, string[]> = {}
  for (const p of role.permissions) {
    if (!permissionsByModule[p.module]) permissionsByModule[p.module] = []
    permissionsByModule[p.module].push(p.action)
  }

  // Group field permissions by module
  const fieldsByModule: Record<string, { field: string; access: string }[]> = {}
  for (const f of role.fieldPermissions) {
    if (!fieldsByModule[f.module]) fieldsByModule[f.module] = []
    fieldsByModule[f.module].push({ field: f.field, access: f.access })
  }

  return NextResponse.json({
    role: {
      id: role.id,
      name: role.name,
      label: role.label,
      description: role.description,
      color: role.color,
      isSystem: role.isSystem,
      active: role.active,
      sortOrder: role.sortOrder,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    },
    permissions: permissionsByModule,
    fieldPermissions: fieldsByModule,
    permissionCount: role.permissions.length,
    fieldPermissionCount: role.fieldPermissions.length,
    assignments: role.assignments.map((a) => ({
      id: a.id,
      scopeType: a.scopeType,
      scopeId: a.scopeId,
      expiresAt: a.expiresAt,
      reason: a.reason,
      createdAt: a.createdAt,
      active: a.active,
      user: a.user,
    })),
    assignedUsersCount: role.assignments.length,
  })
})

// PATCH — update label/description/color/active. System roles can be retired but not deleted.
export const PATCH = apiHandler(async (req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'manage')
  const { id } = await ctx2.params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const role = await db.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, name: true, isSystem: true, active: true, label: true, description: true, color: true },
  })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  // Prevent self-demotion: super_admin cannot retire super_admin (lockout protection)
  if (role.name === 'super_admin' && body.active === false && ctx.role === 'super_admin') {
    // Super admins can retire their own role ONLY if at least one other active super_admin remains
    const superCount = await db.user.count({
      where: { organizationId: ctx.organizationId, role: 'super_admin', active: true },
    })
    // Count active assignments to super_admin role
    const activeAssignments = await db.userRoleAssignment.count({
      where: { roleId: role.id, organizationId: ctx.organizationId, active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    })
    if (superCount <= 1 || activeAssignments <= 1) {
      throw new ForbiddenError('Cannot retire super_admin — at least one active Super Admin is required.')
    }
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.label === 'string' && body.label.trim()) updates.label = body.label.trim()
  if (typeof body.description === 'string') updates.description = body.description.trim() || null
  if (typeof body.color === 'string') {
    const c = body.color.trim()
    if (c && !HEX_RE.test(c)) {
      return NextResponse.json({ error: 'color must be a hex string like #0891b2' }, { status: 400 })
    }
    updates.color = c || null
  }
  if (typeof body.active === 'boolean') updates.active = body.active

  // Name changes are not allowed — the role name is the durable identifier
  if (typeof body.name === 'string' && body.name.trim() && body.name !== role.name) {
    return NextResponse.json({ error: 'Role name cannot be changed.' }, { status: 400 })
  }

  // Optional permission matrix update (used by the Matrix tab "Save changes" button).
  // Body shape: { permissions: Record<module, action[]> } — the FULL desired state.
  // We diff against the current permissions and apply the delta (insert/delete RolePermission rows).
  let permissionDelta: { added: { module: string; action: string }[]; removed: { module: string; action: string }[] } | null = null
  if (body.permissions && typeof body.permissions === 'object' && !Array.isArray(body.permissions)) {
    // Validate the incoming shape against the known module/action catalogue
    const incoming: { module: string; action: string }[] = []
    for (const [mod, actions] of Object.entries(body.permissions as Record<string, unknown>)) {
      if (!MODULES.includes(mod as Module) && mod !== 'search' && mod !== 'access') {
        return NextResponse.json({ error: `Unknown module "${mod}"` }, { status: 400 })
      }
      if (!Array.isArray(actions)) {
        return NextResponse.json({ error: `permissions["${mod}"] must be an array of actions` }, { status: 400 })
      }
      for (const a of actions) {
        if (typeof a !== 'string' || !ACTIONS.includes(a as Action)) {
          return NextResponse.json({ error: `Unknown action "${a}" on module "${mod}"` }, { status: 400 })
        }
        incoming.push({ module: mod, action: a })
      }
    }

    // Lockout protection: ensure no locked permission is being removed from super_admin
    if (role.name === 'super_admin') {
      for (const locked of LOCKED_PERMISSIONS) {
        if (locked.roleName !== role.name) continue
        const stillPresent = incoming.some(
          (p) => p.module === locked.module && p.action === locked.action,
        )
        if (!stillPresent) {
          throw new ForbiddenError(
            `Lockout protection: cannot remove ${locked.module}:${locked.action} from super_admin.`,
          )
        }
      }
    }

    // Load current permissions for diffing
    const current = await db.rolePermission.findMany({
      where: { roleId: role.id },
      select: { module: true, action: true },
    })
    const currentSet = new Set(current.map((p) => `${p.module}::${p.action}`))
    const incomingSet = new Set(incoming.map((p) => `${p.module}::${p.action}`))
    const added: { module: string; action: string }[] = []
    const removed: { module: string; action: string }[] = []
    for (const p of incoming) if (!currentSet.has(`${p.module}::${p.action}`)) added.push(p)
    for (const p of current) if (!incomingSet.has(`${p.module}::${p.action}`)) {
      // Re-check lockout at apply time (defense in depth)
      if (role.name === 'super_admin' && LOCKED_PERMISSIONS.some(
        (L) => L.module === p.module && L.action === p.action,
      )) continue
      removed.push(p)
    }
    permissionDelta = { added, removed }
  }

  if (Object.keys(updates).length === 0 && !permissionDelta) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // Apply metadata + permission delta in a transaction
  await db.$transaction(async (tx) => {
    if (Object.keys(updates).length > 0) {
      await tx.role.update({ where: { id: role.id }, data: updates })
    }
    if (permissionDelta) {
      if (permissionDelta.removed.length) {
        // Delete each removed permission individually (Prisma can't OR on two columns easily)
        for (const r of permissionDelta.removed) {
          await tx.rolePermission.deleteMany({
            where: { roleId: role.id, module: r.module, action: r.action },
          })
        }
      }
      if (permissionDelta.added.length) {
        await tx.rolePermission.createMany({
          data: permissionDelta.added.map((p) => ({ roleId: role.id, module: p.module, action: p.action })),
        })
      }
    }
  })

  const updated = await db.role.findUniqueOrThrow({ where: { id: role.id } })

  await audit(ctx, 'access.role.update', 'role', role.id, {
    name: role.name,
    before: { label: role.label, description: role.description, color: role.color, active: role.active },
    after: updates,
    permissionChanges: permissionDelta
      ? { added: permissionDelta.added.length, removed: permissionDelta.removed.length }
      : null,
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    label: updated.label,
    description: updated.description,
    color: updated.color,
    isSystem: updated.isSystem,
    active: updated.active,
    sortOrder: updated.sortOrder,
  })
})

// DELETE — delete a custom role only. Reassign users to 'member' before deleting.
export const DELETE = apiHandler(async (_req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'manage')
  const { id } = await ctx2.params

  const role = await db.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { _count: { select: { assignments: { where: { active: true } } } } },
  })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }
  if (role.isSystem) {
    return NextResponse.json(
      { error: 'System roles cannot be deleted. Use PATCH {active:false} to retire instead.' },
      { status: 403 },
    )
  }

  // Reassign active assignments to 'member' role
  const memberRole = await db.role.findFirst({
    where: { organizationId: ctx.organizationId, name: 'member' },
    select: { id: true },
  })
  if (!memberRole) {
    return NextResponse.json({ error: 'Cannot delete role: default "member" role not found.' }, { status: 500 })
  }

  await db.$transaction(async (tx) => {
    // Deactivate all current assignments to this role
    await tx.userRoleAssignment.updateMany({
      where: { roleId: role.id, active: true },
      data: { active: false },
    })
    // For each user who had this role as their primary User.role, downgrade to 'member'
    const usersWithPrimary = await tx.user.findMany({
      where: { role: role.name, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (usersWithPrimary.length) {
      await tx.user.updateMany({
        where: { id: { in: usersWithPrimary.map((u) => u.id) } },
        data: { role: 'member' },
      })
      // Grant them an active 'member' role assignment using upsert to respect the
      // unique constraint [userId, roleId, scopeType, scopeId]. A user may already
      // have an inactive 'member' assignment that we re-activate.
      for (const u of usersWithPrimary) {
        await tx.userRoleAssignment.upsert({
          where: {
            userId_roleId_scopeType_scopeId: {
              userId: u.id, roleId: memberRole.id, scopeType: 'org', scopeId: '',
            },
          },
          update: { active: true, grantedById: ctx.user.id, reason: `Re-activated after deletion of role "${role.name}"` },
          create: {
            organizationId: ctx.organizationId,
            userId: u.id, roleId: memberRole.id, scopeType: 'org',
            grantedById: ctx.user.id, active: true,
            reason: `Auto-assigned after deletion of role "${role.name}"`,
          },
        })
      }
    }
    // Finally, delete the role (cascades permissions + fieldPermissions + assignments)
    await tx.role.delete({ where: { id: role.id } })
  })

  await audit(ctx, 'access.role.delete', 'role', role.id, {
    name: role.name, label: role.label,
    reassignedUsersToRole: 'member',
    affectedAssignments: role._count.assignments,
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({ ok: true, id: role.id, name: role.name, deleted: true })
})
