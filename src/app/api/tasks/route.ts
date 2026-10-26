// ChurchOS — Tasks & Approvals API
// GET  /api/tasks?status=&departmentId=&page=&approvals=1  — list tasks (Kanban) OR approvals
// POST /api/tasks                                           — create task (scoped for dept roles)
// PATCH /api/tasks  {id, status, assigneeId, ...}          — quick update (tasks:update)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { can, isScopedRole, ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['todo', 'in_progress', 'done', 'blocked'] as const
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

interface TaskListItem {
  id: string
  title: string
  description?: string | null
  status: string
  priority: string
  // Date fields widened to `Date | string`: the list handler maps Prisma rows
  // (Date) straight into this shape, which is JSON-serialized on the way out.
  dueDate?: Date | string | null
  assigneeId?: string | null
  assigneeName?: string | null
  departmentId?: string | null
  department?: { id: string; name: string; color?: string | null } | null
  labels?: string | null
  estimatedHours?: number | null
  loggedHours?: number | null
  parentTaskId?: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

function scopedWhere(ctx: AuthContext, extra: Record<string, unknown> = {}) {
  const where: Record<string, unknown> = { organizationId: ctx.organizationId, ...extra }
  if (isScopedRole(ctx.role) && ctx.departmentId) {
    where.departmentId = ctx.departmentId
  }
  return where
}

// ---- GET list of tasks OR pending approvals ----
export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('tasks', 'view')
  const sp = req.nextUrl.searchParams
  const mode = sp.get('approvals')

  // ---- Approvals sub-endpoint: queue of pending approvals + history of resolved approvals ----
  if (mode === '1') {
    // Permission: tasks:view OR finance:approve OR events:approve
    const canApproveFinance = can(ctx.role, 'finance', 'approve')
    const canApproveEvents = can(ctx.role, 'events', 'approve')
    const canManageTasks = can(ctx.role, 'tasks', 'update')
    if (!canApproveFinance && !canApproveEvents && !canManageTasks) {
      throw new ForbiddenError('You do not have approval authority on any module.')
    }
    const statusFilter = sp.get('status') ?? 'pending'
    const type = sp.get('type') ?? ''
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

    // Approval model only stores *resolved* approvals (finance Task 5 creates them on approve/reject).
    // Pending approvals are inferred from the source records themselves:
    //  - Pending expenses with status='pending' are virtual approval requests.
    // When the user requests status=pending we synthesize them; otherwise we read historical Approval rows.
    type ApprovalRow = {
      id: string
      type: string
      refId: string
      status: string
      comment: string | null
      createdAt: Date
      resolvedAt: Date | null
      requesterId: string | null
      approverId: string | null
    }
    let rows: ApprovalRow[] = []
    let total = 0

    if (statusFilter === 'pending') {
      // Synthesize pending approvals from source records.
      const wantExpenses = (!type || type === 'expense') && (canApproveFinance || canManageTasks)
      const wantEvents = (!type || type === 'event') && canApproveEvents
      const [pendingExpenses, pendingEvents] = await Promise.all([
        wantExpenses
          ? db.expense.findMany({
              where: { organizationId: ctx.organizationId, status: 'pending' },
              orderBy: { incurredAt: 'desc' },
              select: {
                id: true, category: true, description: true, amount: true,
                status: true, incurredAt: true,
              },
            })
          : Promise.resolve([]),
        wantEvents
          ? db.event.findMany({
              where: { organizationId: ctx.organizationId, status: 'scheduled' },
              orderBy: { startDate: 'asc' },
              select: { id: true, title: true, startDate: true, status: true },
            })
          : Promise.resolve([]),
      ])

      const synthExpenses: ApprovalRow[] = pendingExpenses.map((e) => ({
        id: `synth-expense-${e.id}`,
        type: 'expense',
        refId: e.id,
        status: 'pending',
        comment: null,
        createdAt: e.incurredAt,
        resolvedAt: null,
        requesterId: null,
        approverId: null,
      }))
      const synthEvents: ApprovalRow[] = pendingEvents.map((e) => ({
        id: `synth-event-${e.id}`,
        type: 'event',
        refId: e.id,
        status: 'pending',
        comment: null,
        createdAt: e.startDate,
        resolvedAt: null,
        requesterId: null,
        approverId: null,
      }))
      rows = [...synthExpenses, ...synthEvents].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      total = rows.length
      rows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
    } else {
      // Historical resolved Approval records.
      const where: Record<string, unknown> = { organizationId: ctx.organizationId }
      if (['approved', 'rejected'].includes(statusFilter)) where.status = statusFilter
      if (type) where.type = type
      const [items, count] = await Promise.all([
        db.approval.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.approval.count({ where }),
      ])
      rows = items
      total = count
    }

    // Resolve requester & approver names + referenced record summary
    const requesterIds = Array.from(
      new Set(rows.map((a) => a.requesterId).filter(Boolean) as string[]),
    )
    const approverIds = Array.from(
      new Set(rows.map((a) => a.approverId).filter(Boolean) as string[]),
    )
    const users = (requesterIds.length || approverIds.length)
      ? await db.user.findMany({
          where: { id: { in: [...requesterIds, ...approverIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = new Map(users.map((u) => [u.id, u]))

    // Resolve referenced records (expense title etc.)
    const expenseIds = rows.filter((i) => i.type === 'expense').map((i) => i.refId)
    const expenses = expenseIds.length
      ? await db.expense.findMany({
          where: { id: { in: expenseIds } },
          select: { id: true, category: true, description: true, amount: true, status: true },
        })
      : []
    const expenseMap = new Map(expenses.map((e) => [e.id, e]))

    const eventIds = rows.filter((i) => i.type === 'event').map((i) => i.refId)
    const events = eventIds.length
      ? await db.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, title: true, startDate: true, status: true },
        })
      : []
    const eventMap = new Map(events.map((e) => [e.id, e]))

    return NextResponse.json({
      items: rows.map((a) => ({
        id: a.id,
        type: a.type,
        refId: a.refId,
        status: a.status,
        comment: a.comment,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        requester: a.requesterId ? userMap.get(a.requesterId) ?? null : null,
        approver: a.approverId ? userMap.get(a.approverId) ?? null : null,
        ref:
          a.type === 'expense'
            ? expenseMap.get(a.refId)
              ? {
                  kind: 'expense' as const,
                  label: expenseMap.get(a.refId)!.description,
                  subtitle: expenseMap.get(a.refId)!.category,
                  amount: expenseMap.get(a.refId)!.amount,
                  status: expenseMap.get(a.refId)!.status,
                }
              : null
            : a.type === 'event'
              ? eventMap.get(a.refId)
                ? {
                    kind: 'event' as const,
                    label: eventMap.get(a.refId)!.title,
                    subtitle: 'Event',
                    startDate: eventMap.get(a.refId)!.startDate,
                    status: eventMap.get(a.refId)!.status,
                  }
                : null
              : null,
      })),
      total,
      page,
      pageSize,
      canApproveFinance,
      canApproveEvents,
    })
  }

  // ---- Tasks list (Kanban) ----
  const statusParam = sp.get('status') ?? ''
  const departmentId = sp.get('departmentId') ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '200', 10) || 200))

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (statusParam && VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])) {
    where.status = statusParam
  }
  if (departmentId) where.departmentId = departmentId
  if (isScopedRole(ctx.role) && ctx.departmentId) {
    where.departmentId = ctx.departmentId
  }
  // Member role: only their own assigned tasks.
  if (ctx.role === 'member' && !(ctx.user as any).isPartnerAdmin) {
    where.assigneeId = ctx.user.id
  }

  const [items, total, statusGroups, priorityGroups] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        department: { select: { id: true, name: true, color: true } },
      },
    }),
    db.task.count({ where }),
    db.task.groupBy({ by: ['status'], where, _count: true }),
    db.task.groupBy({ by: ['priority'], where, _count: true }),
  ])

  // Resolve assignees (Task has assigneeId scalar referencing User.id)
  const assigneeIds = Array.from(
    new Set(items.map((t) => t.assigneeId).filter(Boolean) as string[]),
  )
  const assignees = assigneeIds.length
    ? await db.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true, email: true, avatarUrl: true },
      })
    : []
  const assigneeMap = new Map(assignees.map((u) => [u.id, u]))

  const out: TaskListItem[] = items.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeId ? assigneeMap.get(t.assigneeId)?.name ?? null : null,
    departmentId: t.departmentId,
    department: t.department,
    labels: t.labels ?? null,
    estimatedHours: t.estimatedHours ?? null,
    loggedHours: t.loggedHours ?? 0,
    parentTaskId: t.parentTaskId ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }))

  // Side-channel: departments list for filter dropdown
  const departments = isScopedRole(ctx.role)
    ? ctx.departmentId
      ? await db.department.findMany({
          where: { id: ctx.departmentId },
          select: { id: true, name: true, color: true },
        })
      : []
    : await db.department.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true, color: true },
        orderBy: { name: 'asc' },
      })

  return NextResponse.json({
    items: out,
    total,
    page,
    pageSize,
    stats: {
      todo: statusGroups.find((s) => s.status === 'todo')?._count ?? 0,
      in_progress: statusGroups.find((s) => s.status === 'in_progress')?._count ?? 0,
      done: statusGroups.find((s) => s.status === 'done')?._count ?? 0,
      blocked: statusGroups.find((s) => s.status === 'blocked')?._count ?? 0,
      urgent: priorityGroups.find((p) => p.priority === 'urgent')?._count ?? 0,
      overdue: items.filter(
        (t) => t.dueDate && new Date(t.dueDate).getTime() < Date.now() && t.status !== 'done',
      ).length,
    },
    departments,
  })
})

interface CreateBody {
  title?: string
  description?: string
  departmentId?: string | null
  assigneeId?: string | null
  status?: string
  priority?: string
  dueDate?: string | null
  labels?: string | null
  estimatedHours?: number | null
  parentTaskId?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('tasks', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  const status =
    body.status && VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])
      ? body.status!
      : 'todo'
  const priority =
    body.priority && VALID_PRIORITIES.includes(body.priority as (typeof VALID_PRIORITIES)[number])
      ? body.priority!
      : 'normal'

  // Department resolution — scoped roles are forced to their own department
  let departmentId: string | null = null
  if (isScopedRole(ctx.role)) {
    departmentId = ctx.departmentId ?? null
  } else if (body.departmentId) {
    const dept = await db.department.findFirst({
      where: { id: body.departmentId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!dept) {
      return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
    }
    departmentId = body.departmentId
  }

  // Assignee validation — must be a real user in this org
  let assigneeId: string | null = null
  if (body.assigneeId) {
    const u = await db.user.findFirst({
      where: { id: body.assigneeId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!u) {
      return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
    }
    assigneeId = body.assigneeId
  }

  // Parent task validation (subtask support)
  let parentTaskId: string | null = null
  if (body.parentTaskId) {
    const parent = await db.task.findFirst({
      where: { id: body.parentTaskId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!parent) {
      return NextResponse.json({ error: 'Invalid parentTaskId' }, { status: 400 })
    }
    parentTaskId = body.parentTaskId
  }

  const created = await db.task.create({
    data: {
      organizationId: ctx.organizationId,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      departmentId,
      assigneeId,
      status,
      priority,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      labels: body.labels?.trim() || null,
      estimatedHours:
        typeof body.estimatedHours === 'number' && isFinite(body.estimatedHours) && body.estimatedHours >= 0
          ? body.estimatedHours
          : null,
      parentTaskId,
    },
    include: { department: { select: { id: true, name: true, color: true } } },
  })

  await audit(ctx, 'tasks.create', 'task', created.id, {
    title: created.title,
    status,
    priority,
    departmentId,
    parentTaskId,
  })

  return NextResponse.json(created, { status: 201 })
})
