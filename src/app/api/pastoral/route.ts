// ChurchOS — Pastoral Care & Welfare API (cases)
// GET  /api/pastoral         — list cases (filter by status/type; privateNotes gated to pastor/super_admin)
// POST /api/pastoral         — create case (audit; members create with status 'open')
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { broadcastEvent } from '@/lib/ai-events'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_TYPES = [
  'prayer', 'counselling', 'visitation', 'bereavement', 'hospital', 'welfare',
] as const
type CaseType = (typeof VALID_TYPES)[number]
const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
type CaseStatus = (typeof VALID_STATUSES)[number]
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
type Priority = (typeof VALID_PRIORITIES)[number]

// Roles permitted to view full case notes (not just description)
const PRIVATE_NOTE_ROLES = ['pastor', 'super_admin']

interface ListResponse {
  items: any[]
  total: number
  stats: { total: number; open: number; inProgress: number; resolved: number; urgent: number }
  staff?: { id: string; name: string; role: string }[]
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('pastoral', 'view')
  const { organizationId, role } = ctx
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const type = sp.get('type') ?? ''
  const priority = sp.get('priority') ?? ''
  const assignedToId = sp.get('assignedToId') ?? ''
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

  const where: any = { organizationId }
  if (status && VALID_STATUSES.includes(status as CaseStatus)) where.status = status
  if (type && VALID_TYPES.includes(type as CaseType)) where.type = type
  if (priority && VALID_PRIORITIES.includes(priority as Priority)) where.priority = priority
  if (assignedToId) where.assignedToId = assignedToId
  if (q) {
    where.OR = [
      { description: { contains: q } },
      { member: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }] } },
    ]
  }

  const canSeePrivate = PRIVATE_NOTE_ROLES.includes(role)

  const [items, total, statusGroups, priorityGroups] = await Promise.all([
    db.pastoralCase.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, memberId: true, phone: true, email: true },
        },
      },
    }),
    db.pastoralCase.count({ where }),
    db.pastoralCase.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
    db.pastoralCase.groupBy({ by: ['priority'], where: { organizationId }, _count: true }),
  ])

  // Resolve assignedToId → user manually (no relation defined in schema for assignedTo)
  const assigneeIds = Array.from(
    new Set(items.map((c) => c.assignedToId).filter(Boolean) as string[]),
  )
  const assignees = assigneeIds.length
    ? await db.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true, role: true },
      })
    : []
  const assigneeMap = new Map(assignees.map((u) => [u.id, u]))

  // Privacy best practice: audit sensitive case list views
  await audit(ctx, 'pastoral.case.view', 'pastoralCase', undefined, {
    filters: { status, type, priority, assignedToId, q },
    count: total,
  })

  const stats = {
    total: statusGroups.reduce((s, g) => s + g._count, 0),
    open: statusGroups.find((g) => g.status === 'open')?._count ?? 0,
    inProgress: statusGroups.find((g) => g.status === 'in_progress')?._count ?? 0,
    resolved: statusGroups.find((g) => g.status === 'resolved')?._count ?? 0,
    urgent: priorityGroups.find((g) => g.priority === 'urgent')?._count ?? 0,
  }

  const body: ListResponse = {
    items: items.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      priority: c.priority,
      description: c.description,
      // privateNotes only for pastor/super_admin — stripped for everyone else
      privateNotes: canSeePrivate ? c.privateNotes : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      memberId: c.memberId,
      member: c.member
        ? {
            id: c.member.id,
            name: `${c.member.firstName} ${c.member.lastName}`,
            memberId: c.member.memberId,
            phone: c.member.phone,
            email: c.member.email,
          }
        : null,
      assignedToId: c.assignedToId,
      assignedTo: c.assignedToId ? assigneeMap.get(c.assignedToId) ?? null : null,
    })),
    total,
    stats,
    staff: await db.user.findMany({
      where: {
        organizationId,
        active: true,
        role: { in: ['pastor', 'super_admin', 'church_admin', 'department_head'] },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  }
  return NextResponse.json(body)
})

interface CreateBody {
  memberId?: string | null
  type?: string
  priority?: string
  status?: string
  description?: string
  privateNotes?: string | null
  assignedToId?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('pastoral', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.description || typeof body.description !== 'string' || !body.description.trim()) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }

  const type: CaseType =
    body.type && VALID_TYPES.includes(body.type as CaseType) ? (body.type as CaseType) : 'prayer'
  const priority: Priority =
    body.priority && VALID_PRIORITIES.includes(body.priority as Priority)
      ? (body.priority as Priority)
      : 'normal'
  const status: CaseStatus =
    body.status && VALID_STATUSES.includes(body.status as CaseStatus)
      ? (body.status as CaseStatus)
      : 'open'

  // Validate memberId belongs to org if provided
  let memberId: string | null = null
  if (body.memberId) {
    const m = await db.member.findFirst({
      where: { id: body.memberId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!m) {
      return NextResponse.json({ error: 'Invalid member' }, { status: 400 })
    }
    memberId = m.id
  }

  // Validate assignee
  let assignedToId: string | null = null
  if (body.assignedToId) {
    const u = await db.user.findFirst({
      where: { id: body.assignedToId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!u) {
      return NextResponse.json({ error: 'Invalid assignedTo user' }, { status: 400 })
    }
    assignedToId = u.id
  }

  // privateNotes — only pastor/super_admin can set on create
  const canSeePrivate = PRIVATE_NOTE_ROLES.includes(ctx.role)
  const privateNotes = canSeePrivate ? body.privateNotes?.trim() || null : null

  const created = await db.pastoralCase.create({
    data: {
      organizationId: ctx.organizationId,
      memberId,
      type,
      status,
      priority,
      description: body.description.trim(),
      privateNotes,
      assignedToId,
    },
    include: {
      member: { select: { id: true, firstName: true, lastName: true, memberId: true } },
    },
  })

  // Resolve assignee separately (no relation on PastoralCase for assignedTo)
  const assignee = assignedToId
    ? await db.user.findUnique({ where: { id: assignedToId }, select: { id: true, name: true, role: true } })
    : null

  await audit(ctx, 'pastoral.case.create', 'pastoralCase', created.id, {
    type, status, priority, memberId, assignedToId,
  })

  // Notify the assigned pastoral worker
  if (assignedToId && assignedToId !== ctx.user.id) {
    await db.notification.create({
      data: {
        userId: assignedToId,
        title: 'New pastoral case assigned',
        message: `A ${type} case${created.member ? ` for ${created.member.firstName} ${created.member.lastName}` : ''} has been assigned to you.`,
        link: `pastoral:${created.id}`,
      },
    }).catch(() => {})
  }

  // Broadcast to the AI assistant live events feed
  await broadcastEvent(ctx, {
    module: 'pastoral',
    action: 'create',
    title: 'New pastoral case',
    message: `A ${type} case${created.member ? ` for ${created.member.firstName} ${created.member.lastName}` : ''} was opened${assignedToId ? ' and assigned' : ''}.`,
    refId: created.id,
    refType: 'pastoralCase',
  })

  return NextResponse.json(
    {
      id: created.id,
      type: created.type,
      status: created.status,
      priority: created.priority,
      description: created.description,
      privateNotes: canSeePrivate ? created.privateNotes : null,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      memberId: created.memberId,
      member: created.member,
      assignedToId: created.assignedToId,
      assignedTo: assignee,
    },
    { status: 201 },
  )
})
