// ChurchOS — Access Control user assignment
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'
import { refreshMatrixCache } from '@/lib/permissions-db'

export const dynamic = 'force-dynamic'

// PATCH /api/access/assign — change a user's role
export const PATCH = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('access', 'manage')
  const body = await req.json()
  const { userId, role } = body

  if (!userId || !role) {
    return NextResponse.json({ error: 'userId and role are required' }, { status: 400 })
  }

  // Prevent self-role-change
  if (userId === ctx.user.id) {
    throw new ForbiddenError('You cannot change your own role.')
  }

  // Validate the target role exists + active in the org
  const targetRole = await db.role.findFirst({
    where: { organizationId: ctx.organizationId, name: role, active: true },
  })
  if (!targetRole) {
    return NextResponse.json({ error: 'Target role not found or inactive' }, { status: 400 })
  }

  // Prevent assigning super_admin unless ctx is super_admin
  if (role === 'super_admin' && ctx.role !== 'super_admin') {
    throw new ForbiddenError('Only Super Admins can assign the Super Admin role.')
  }

  // Prevent demoting the last active super_admin
  const targetUser = await db.user.findFirst({
    where: { id: userId, organizationId: ctx.organizationId },
  })
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (targetUser.role === 'super_admin' && role !== 'super_admin') {
    const activeSuperAdmins = await db.user.count({
      where: { organizationId: ctx.organizationId, role: 'super_admin', active: true },
    })
    if (activeSuperAdmins <= 1) {
      throw new ForbiddenError('Cannot demote the last Super Admin.')
    }
  }

  const oldRole = targetUser.role
  const updated = await db.user.update({
    where: { id: userId },
    data: { role },
  })

  await audit(ctx, 'access.role.assign', 'user', userId, { oldRole, newRole: role })
  refreshMatrixCache(ctx.organizationId)

  // Notify the user that their role changed
  await db.notification.create({
    data: {
      userId,
      title: 'Your role has been updated',
      message: `Your role was changed from ${oldRole} to ${role}.`,
      link: `user:${userId}`,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    user: { id: updated.id, name: updated.name, role: updated.role },
    changed: true,
    oldRole,
  })
})
