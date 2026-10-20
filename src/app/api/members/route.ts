// ChurchOS — Members CRM API
// GET  /api/members       — list members (search, filter, server-side pagination)
// POST /api/members       — create a member (+ initial MemberStatusHistory + audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = [
  'visitor', 'new_convert', 'follow_up', 'active', 'inactive', 'transferred', 'deceased',
] as const
type Status = (typeof VALID_STATUSES)[number]

const VALID_GENDERS = ['male', 'female', 'other'] as const

interface ListResponse {
  items: any[]
  total: number
  page: number
  pageSize: number
  stats: { total: number; active: number; visitors: number; followUp: number }
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('members', 'view')
  const { organizationId } = ctx

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const status = sp.get('status') ?? ''
  const branchId = sp.get('branchId') ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '10', 10) || 10))

  // Build where clause — always org-scoped
  const where: any = { organizationId }
  if (status && VALID_STATUSES.includes(status as Status)) where.status = status
  if (branchId) where.branchId = branchId
  if (q) {
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { preferredName: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
      { memberId: { contains: q } },
    ]
  }

  const [items, total, statusGroups] = await Promise.all([
    db.member.findMany({
      where,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        branch: { select: { id: true, name: true } },
        departmentMemberships: {
          include: { department: { select: { id: true, name: true, color: true } } },
        },
      },
    }),
    db.member.count({ where }),
    db.member.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
  ])

  const stats = {
    total: statusGroups.reduce((s, g) => s + g._count, 0),
    active: statusGroups.find((g) => g.status === 'active')?._count ?? 0,
    visitors: statusGroups.find((g) => g.status === 'visitor')?._count ?? 0,
    followUp: statusGroups.find((g) => g.status === 'follow_up')?._count ?? 0,
  }

  const body: ListResponse = {
    items: items.map((m) => ({
      id: m.id,
      memberId: m.memberId,
      firstName: m.firstName,
      lastName: m.lastName,
      preferredName: m.preferredName,
      email: m.email,
      phone: m.phone,
      photoUrl: m.photoUrl,
      status: m.status,
      gender: m.gender,
      dateJoined: m.dateJoined,
      baptized: m.baptized,
      branch: m.branch,
      departments: m.departmentMemberships.map((dm) => ({
        id: dm.department.id,
        name: dm.department.name,
        color: dm.department.color,
        role: dm.role,
      })),
    })),
    total,
    page,
    pageSize,
    stats,
  }
  return NextResponse.json(body)
})

interface CreateBody {
  firstName?: string
  lastName?: string
  middleName?: string
  preferredName?: string
  email?: string | null
  phone?: string | null
  gender?: string | null
  dateOfBirth?: string | null
  memberId?: string | null
  status?: string
  branchId?: string | null
  baptized?: boolean
  baptizedDate?: string | null
  address?: string | null
  emergencyName?: string | null
  emergencyPhone?: string | null
  isMinor?: boolean
  guardianName?: string | null
  dateJoined?: string | null
  notes?: string | null
  privateNotes?: string | null
  photoUrl?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('members', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  // Manual validation — keep consistent with foundation's `pick` style.
  if (!body.firstName || typeof body.firstName !== 'string' || !body.firstName.trim()) {
    return NextResponse.json({ error: 'firstName is required' }, { status: 400 })
  }
  if (!body.lastName || typeof body.lastName !== 'string' || !body.lastName.trim()) {
    return NextResponse.json({ error: 'lastName is required' }, { status: 400 })
  }
  if (body.email && typeof body.email !== 'string') {
    return NextResponse.json({ error: 'email must be a string' }, { status: 400 })
  }
  const status =
    body.status && VALID_STATUSES.includes(body.status as Status) ? body.status! : 'visitor'
  const gender =
    body.gender && VALID_GENDERS.includes(body.gender as (typeof VALID_GENDERS)[number])
      ? body.gender
      : null

  // Verify branch belongs to org if provided
  if (body.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: body.branchId, organizationId: ctx.organizationId },
    })
    if (!branch) {
      return NextResponse.json({ error: 'Invalid branch' }, { status: 400 })
    }
  }

  // Unique email check (soft — only when provided)
  if (body.email) {
    const exists = await db.member.findFirst({
      where: { email: body.email, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (exists) {
      return NextResponse.json(
        { error: 'A member with this email already exists.' },
        { status: 409 },
      )
    }
  }

  // Auto-generate memberId if not provided (GCI/000X pattern)
  let memberId = body.memberId?.trim() || null
  if (!memberId) {
    const count = await db.member.count({ where: { organizationId: ctx.organizationId } })
    memberId = `GCI/${String(1000 + count + 1).padStart(4, '0')}`
  }

  const created = await db.member.create({
    data: {
      organizationId: ctx.organizationId,
      branchId: body.branchId || null,
      memberId,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      middleName: body.middleName?.trim() || null,
      preferredName: body.preferredName?.trim() || null,
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      gender,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
      status,
      baptized: !!body.baptized,
      baptizedDate: body.baptizedDate ? new Date(body.baptizedDate) : null,
      address: body.address?.trim() || null,
      emergencyName: body.emergencyName?.trim() || null,
      emergencyPhone: body.emergencyPhone?.trim() || null,
      isMinor: !!body.isMinor,
      guardianName: body.guardianName?.trim() || null,
      dateJoined: body.dateJoined ? new Date(body.dateJoined) : new Date(),
      notes: body.notes?.trim() || null,
      privateNotes:
        can(ctx.role, 'members', 'update') ? body.privateNotes?.trim() || null : null,
      photoUrl: body.photoUrl?.trim() || null,
    },
    include: { branch: { select: { id: true, name: true } } },
  })

  // Initial status history
  await db.memberStatusHistory.create({
    data: { memberId: created.id, status, reason: 'Initial status on member creation' },
  })

  await audit(ctx, 'members.create', 'member', created.id, {
    name: `${created.firstName} ${created.lastName}`,
    memberId: created.memberId,
    status,
  })

  return NextResponse.json(created, { status: 201 })
})
