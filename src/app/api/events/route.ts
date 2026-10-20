// ChurchOS — Events API
// GET  /api/events   — list events (filter by date range, department; pagination)
// POST /api/events   — create event (audit; scoped dept_head forced to own departmentId)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { isScopedRole } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_EVENT_TYPES = [
  'service', 'conference', 'meeting', 'retreat', 'outreach', 'training', 'special',
] as const
const VALID_STATUSES = ['scheduled', 'approved', 'cancelled', 'completed'] as const

interface EventListResponse {
  items: any[]
  total: number
  page: number
  pageSize: number
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('events', 'view')
  const { organizationId, role, departmentId } = ctx

  const sp = req.nextUrl.searchParams
  const fromStr = sp.get('from')
  const toStr = sp.get('to')
  const filterDeptId = sp.get('departmentId') ?? ''
  const status = sp.get('status') ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

  const where: any = { organizationId }
  // Scoped roles only see their own department's events
  if (isScopedRole(role) && departmentId) {
    where.OR = [{ departmentId }, { departmentId: null }]
  } else if (filterDeptId) {
    where.departmentId = filterDeptId
  }

  if (status && VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    where.status = status
  }

  const dateRange: { gte?: Date; lte?: Date } = {}
  if (fromStr) {
    const d = new Date(fromStr)
    if (!isNaN(d.getTime())) dateRange.gte = d
  }
  if (toStr) {
    const d = new Date(toStr)
    if (!isNaN(d.getTime())) dateRange.lte = d
  }
  if (Object.keys(dateRange).length) where.startDate = dateRange

  const [items, total, departments] = await Promise.all([
    db.event.findMany({
      where,
      orderBy: { startDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        department: { select: { id: true, name: true, color: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { registrations: true } },
      },
    }),
    db.event.count({ where }),
    db.department.findMany({
      where: { organizationId },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const body: EventListResponse = {
    items: items.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      eventType: e.eventType,
      venue: e.venue,
      capacity: e.capacity,
      startDate: e.startDate,
      endDate: e.endDate,
      status: e.status,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      departmentId: e.departmentId,
      branchId: e.branchId,
      department: e.department,
      branch: e.branch,
      registrations: e._count.registrations,
    })),
    total,
    page,
    pageSize,
  }
  ;(body as any).departments = departments
  return NextResponse.json(body)
})

interface CreateBody {
  title?: string
  description?: string | null
  eventType?: string
  venue?: string | null
  capacity?: number | null
  startDate?: string
  endDate?: string | null
  status?: string
  departmentId?: string | null
  branchId?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('events', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.startDate || typeof body.startDate !== 'string') {
    return NextResponse.json({ error: 'startDate is required' }, { status: 400 })
  }
  const startDate = new Date(body.startDate)
  if (isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })
  }

  const eventType =
    body.eventType && VALID_EVENT_TYPES.includes(body.eventType as (typeof VALID_EVENT_TYPES)[number])
      ? body.eventType!
      : 'service'

  const status =
    body.status && VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])
      ? body.status!
      : 'scheduled'

  // Department handling — scoped roles forced to their own departmentId
  let departmentId: string | null = null
  if (isScopedRole(ctx.role) && ctx.departmentId) {
    departmentId = ctx.departmentId // forced, ignore body
  } else if (body.departmentId) {
    const d = await db.department.findFirst({
      where: { id: body.departmentId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!d) return NextResponse.json({ error: 'Invalid departmentId' }, { status: 400 })
    departmentId = body.departmentId
  }

  let branchId: string | null = null
  if (body.branchId) {
    const b = await db.branch.findFirst({
      where: { id: body.branchId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!b) return NextResponse.json({ error: 'Invalid branchId' }, { status: 400 })
    branchId = body.branchId
  }

  let endDate: Date | null = null
  if (body.endDate) {
    const d = new Date(body.endDate)
    if (!isNaN(d.getTime())) endDate = d
  }

  const capacity =
    typeof body.capacity === 'number' && body.capacity >= 0
      ? Math.min(100000, Math.floor(body.capacity))
      : null

  const ev = await db.event.create({
    data: {
      organizationId: ctx.organizationId,
      branchId,
      departmentId,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      eventType,
      venue: body.venue?.trim() || null,
      capacity,
      startDate,
      endDate,
      status,
      createdBy: ctx.user.id,
    },
    include: {
      department: { select: { id: true, name: true, color: true } },
      _count: { select: { registrations: true } },
    },
  })

  await audit(ctx, 'events.create', 'event', ev.id, {
    title: ev.title,
    eventType: ev.eventType,
    startDate: ev.startDate,
    departmentId: ev.departmentId,
  })

  return NextResponse.json({
    id: ev.id,
    title: ev.title,
    description: ev.description,
    eventType: ev.eventType,
    venue: ev.venue,
    capacity: ev.capacity,
    startDate: ev.startDate,
    endDate: ev.endDate,
    status: ev.status,
    department: ev.department,
    registrations: ev._count.registrations,
  }, { status: 201 })
})
