// ChurchOS — Access Control · Permission simulation (Task ID 26)
// GET /api/access/simulate?userId= — read-only simulation of a user's effective
// permissions (modules, actions, scopes, field access).
//
// Permission: can('access','view')
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { simulateUserPermissions } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('access', 'view')
  const userId = req.nextUrl.searchParams.get('userId') ?? ''

  if (!userId) {
    return NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 })
  }

  // Validate user exists in the same org
  const target = await db.user.findFirst({
    where: { id: userId, organizationId: ctx.organizationId },
    select: {
      id: true, name: true, email: true, role: true, active: true, departmentId: true,
      avatarUrl: true,
      department: { select: { id: true, name: true } },
    },
  })
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const simulation = await simulateUserPermissions(ctx.organizationId, userId)

  await audit(ctx, 'access.simulate.view', 'user', userId, {
    targetUser: target.email,
    roleCount: simulation.roles.length,
    moduleCount: simulation.modules.length,
  })

  return NextResponse.json({
    user: target,
    simulation,
    readOnly: true,
    notice: 'This is a read-only simulation. No data is accessed.',
  })
})
