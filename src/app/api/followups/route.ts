// ChurchOS — Follow-up Tasks API
// GET  /api/followups   — list tasks (filter by status, pagination)
// POST /api/followups   — create task (audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['pending', 'in_progress', 'done', 'lost'] as const
const VALID_METHODS = ['call', 'sms', 'email', 'visit'] as const

interface FollowUpListResponse {
  items: any[]
  total: number
  page: number
  pageSize: number
  stats: { total: number; pending: number; inProgress: number; done: number }
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('followups', 'view')
  const { organizationId } = ctx

  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const ownerId = sp.get('ownerId') ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

  const where: any = { organizationId }
  if (status && VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    where.status = status
  }
  if (ownerId) where.ownerId = ownerId

  const [items, total, statusGroups, owners] = await Promise.all([
    db.followUpTask.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        visitor: {
          select: { id: true, firstName: true, lastName: true, phone: true, email: true, convertedMemberId: true },
        },
        _count: { select: { interactions: true } },
      },
    }),
    db.followUpTask.count({ where }),
    db.followUpTask.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: true,
    }),
    db.user.findMany({
      where: { organizationId, active: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
      take: 50,
    }),
  ])

  const canSeeNotes = can(ctx.role, 'followups', 'update')

  const body: FollowUpListResponse = {
    items: items.map((t) => ({
      id: t.id,
      status: t.status,
      dueDate: t.dueDate,
      outcome: t.outcome,
      notes: canSeeNotes ? t.notes : null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      visitorId: t.visitorId,
      memberId: t.memberId,
      ownerId: t.ownerId,
      visitor: t.visitor,
      owner: owners.find((u) => u.id === t.ownerId) ?? null,
      interactions: t._count.interactions,
    })),
    total,
    page,
    pageSize,
    stats: {
      total: statusGroups.reduce((s, g) => s + g._count, 0),
      pending: statusGroups.find((g) => g.status === 'pending')?._count ?? 0,
      inProgress: statusGroups.find((g) => g.status === 'in_progress')?._count ?? 0,
      done: statusGroups.find((g) => g.status === 'done')?._count ?? 0,
    },
  }
  // attach owners list as side-channel
  ;(body as any).owners = owners
  return NextResponse.json(body)
})

interface CreateBody {
  visitorId?: string | null
  memberId?: string | null
  ownerId?: string | null
  status?: string
  dueDate?: string | null
  notes?: string | null
  outcome?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('followups', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.visitorId && !body.memberId) {
    return NextResponse.json(
      { error: 'Either visitorId or memberId is required' },
      { status: 400 },
    )
  }

  // Verify visitor belongs to org
  if (body.visitorId) {
    const v = await db.visitor.findFirst({
      where: { id: body.visitorId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!v) return NextResponse.json({ error: 'Invalid visitorId' }, { status: 400 })
  }
  if (body.memberId) {
    const m = await db.member.findFirst({
      where: { id: body.memberId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!m) return NextResponse.json({ error: 'Invalid memberId' }, { status: 400 })
  }

  // Validate owner
  let ownerId: string | null = null
  if (body.ownerId) {
    const u = await db.user.findFirst({
      where: { id: body.ownerId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!u) return NextResponse.json({ error: 'Invalid ownerId' }, { status: 400 })
    ownerId = body.ownerId
  }

  const status =
    body.status && VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])
      ? body.status!
      : 'pending'

  const task = await db.followUpTask.create({
    data: {
      organizationId: ctx.organizationId,
      visitorId: body.visitorId || null,
      memberId: body.memberId || null,
      ownerId,
      status,
      dueDate: body.dueDate ? new Date(body.dueDate) : new Date(Date.now() + 3 * 86400000),
      notes: body.notes?.trim() || null,
      outcome: body.outcome?.trim() || null,
    },
  })

  await audit(ctx, 'followups.create', 'followup', task.id, {
    visitorId: task.visitorId,
    memberId: task.memberId,
    status,
  })

  return NextResponse.json(task, { status: 201 })
})

// Re-export VALID_METHODS for use elsewhere (optional)
export const _VALID_METHODS = VALID_METHODS
