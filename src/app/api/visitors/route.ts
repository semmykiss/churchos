// ChurchOS — Visitors API
// GET  /api/visitors   — list visitors (search, pagination, follow-up summary)
// POST /api/visitors   — register a visitor (audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

interface VisitorListResponse {
  items: any[]
  total: number
  page: number
  pageSize: number
  stats: { total: number; converted: number; pendingFollowUp: number; active: number }
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('visitors', 'view')
  const { organizationId } = ctx

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '10', 10) || 10))

  const where: any = { organizationId }
  if (q) {
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
      { referralSource: { contains: q } },
    ]
  }

  const [items, total, statusGroups, convertedCount] = await Promise.all([
    db.visitor.findMany({
      where,
      orderBy: [{ firstVisitDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { followUps: true } },
        followUps: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { id: true, status: true, dueDate: true, ownerId: true },
        },
      },
    }),
    db.visitor.count({ where }),
    db.followUpTask.groupBy({
      by: ['status'],
      where: { organizationId, visitorId: { not: null } },
      _count: true,
    }),
    db.visitor.count({ where: { organizationId, convertedMemberId: { not: null } } }),
  ])

  const totalVisitors = await db.visitor.count({ where: { organizationId } })
  const pending = statusGroups
    .filter((g) => g.status === 'pending' || g.status === 'in_progress')
    .reduce((s, g) => s + g._count, 0)

  const body: VisitorListResponse = {
    items: items.map((v) => ({
      id: v.id,
      firstName: v.firstName,
      lastName: v.lastName,
      phone: v.phone,
      email: v.email,
      address: v.address,
      referralSource: v.referralSource,
      firstVisitDate: v.firstVisitDate,
      consent: v.consent,
      convertedMemberId: v.convertedMemberId,
      createdAt: v.createdAt,
      followUpsCount: v._count.followUps,
      latestFollowUp: v.followUps[0] ?? null,
    })),
    total,
    page,
    pageSize,
    stats: {
      total: totalVisitors,
      converted: convertedCount,
      pendingFollowUp: pending,
      active: totalVisitors - convertedCount,
    },
  }
  return NextResponse.json(body)
})

interface CreateBody {
  firstName?: string
  lastName?: string
  phone?: string | null
  email?: string | null
  address?: string | null
  referralSource?: string | null
  consent?: boolean
  firstVisitDate?: string | null
  // optional: also create initial follow-up task
  createFollowUp?: boolean
  ownerId?: string | null
  dueDate?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('visitors', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.firstName || typeof body.firstName !== 'string' || !body.firstName.trim()) {
    return NextResponse.json({ error: 'firstName is required' }, { status: 400 })
  }
  if (!body.lastName || typeof body.lastName !== 'string' || !body.lastName.trim()) {
    return NextResponse.json({ error: 'lastName is required' }, { status: 400 })
  }

  // Email uniqueness check (if provided)
  if (body.email && body.email.trim()) {
    const dup = await db.visitor.findFirst({
      where: { email: body.email.trim(), organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (dup) {
      return NextResponse.json(
        { error: 'A visitor with this email already exists.' },
        { status: 409 },
      )
    }
  }

  const visitor = await db.visitor.create({
    data: {
      organizationId: ctx.organizationId,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      address: body.address?.trim() || null,
      referralSource: body.referralSource?.trim() || null,
      consent: body.consent !== false,
      firstVisitDate: body.firstVisitDate ? new Date(body.firstVisitDate) : new Date(),
    },
  })

  // Optional initial follow-up task
  if (body.createFollowUp) {
    let ownerId = body.ownerId?.trim() || null
    if (ownerId) {
      const u = await db.user.findFirst({
        where: { id: ownerId, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (!u) ownerId = null
    }
    await db.followUpTask.create({
      data: {
        organizationId: ctx.organizationId,
        visitorId: visitor.id,
        ownerId,
        status: 'pending',
        dueDate: body.dueDate ? new Date(body.dueDate) : new Date(Date.now() + 3 * 86400000),
      },
    })
  }

  await audit(ctx, 'visitors.create', 'visitor', visitor.id, {
    name: `${visitor.firstName} ${visitor.lastName}`,
  })

  return NextResponse.json(visitor, { status: 201 })
})
