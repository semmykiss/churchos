// ChurchOS — Access Control users list
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// GET /api/access/users — list all org users for the assignment table
export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('access', 'view')
  // Only church_admin and super_admin can list users
  if (ctx.role !== 'church_admin' && ctx.role !== 'super_admin') {
    throw new ForbiddenError('Only administrators can list users.')
  }
  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const role = sp.get('role') ?? ''

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (role) where.role = role
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
    ]
  }

  const [users, roles] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      include: { department: { select: { id: true, name: true, color: true } } },
    }),
    db.role.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, label: true, color: true, isSystem: true, active: true, sortOrder: true },
    }),
  ])

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone,
      avatarUrl: u.avatarUrl, active: u.active, departmentId: u.departmentId,
      department: u.department, lastLoginAt: u.lastLoginAt,
    })),
    roles,
  })
})
