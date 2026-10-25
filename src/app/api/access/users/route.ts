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
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '100', 10) || 100))

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (role) where.role = role
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
      // Also match against the linked Member profile so searching a member
      // number / member name finds the user even when User.name has drifted.
      { memberProfile: { is: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { memberId: { contains: q } }] } } },
    ]
  }

  const [users, total, roles] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        department: { select: { id: true, name: true, color: true } },
        memberProfile: { select: { id: true, memberId: true, firstName: true, lastName: true, photoUrl: true } },
      },
    }),
    db.user.count({ where }),
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
      // Linked Member profile (memberId = Member record id, memberNumber = business no.)
      memberId: u.memberId ?? null,
      memberNumber: u.memberProfile?.memberId ?? null,
      memberFirstName: u.memberProfile?.firstName ?? null,
      memberLastName: u.memberProfile?.lastName ?? null,
      memberPhotoUrl: u.memberProfile?.photoUrl ?? null,
      displayName: u.memberProfile ? `${u.memberProfile.firstName} ${u.memberProfile.lastName}`.trim() : u.name,
      photoUrl: u.memberProfile?.photoUrl ?? u.avatarUrl,
    })),
    total,
    page,
    pageSize,
    roles,
  })
})
