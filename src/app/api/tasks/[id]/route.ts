// ChurchOS — Task detail API
// GET    /api/tasks/[id]   — single task with department + assignee resolved + subtasks + comments
// PATCH  /api/tasks/[id]   — update status / assignee / fields. tasks:update.
// DELETE /api/tasks/[id]   — delete. tasks:delete.
//
// Scoping:
//   - Member role: may only view/update tasks where assigneeId === ctx.user.id (their own).
//   - Scoped staff (department_head/assistant/unit_leader): limited to their department.
//   - Other staff: org-wide.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { isScopedRole } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['todo', 'in_progress', 'done', 'blocked'] as const
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

async function getScopedTask(ctx: AuthContext, id: string) {
  const where: Record<string, unknown> = { id, organizationId: ctx.organizationId }
  if (isScopedRole(ctx.role) && ctx.departmentId) {
    where.departmentId = ctx.departmentId
  }
  // Members can only see their own tasks.
  if (ctx.role === 'member' && !(ctx.user as any).isPartnerAdmin) {
    where.assigneeId = ctx.user.id
  }
  return db.task.findFirst({
    where,
    include: { department: { select: { id: true, name: true, color: true } } },
  })
}

export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('tasks', 'view')
    const { id } = await params
    const task = await getScopedTask(ctx, id)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    let assignee: { id: string; name: string; email: string } | null = null
    if (task.assigneeId) {
      const u = await db.user.findUnique({
        where: { id: task.assigneeId },
        select: { id: true, name: true, email: true },
      })
      assignee = u
    }

    // Subtasks + comments
    const [subtasks, commentsRaw] = await Promise.all([
      db.task.findMany({
        where: { parentTaskId: task.id, organizationId: ctx.organizationId },
        orderBy: { createdAt: 'asc' },
        include: { department: { select: { id: true, name: true, color: true } } },
      }),
      db.taskComment.findMany({
        where: { taskId: task.id },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    // Resolve subtask assignees
    const subAssigneeIds = Array.from(
      new Set(subtasks.map((s) => s.assigneeId).filter(Boolean) as string[]),
    )
    const subAssignees = subAssigneeIds.length
      ? await db.user.findMany({
          where: { id: { in: subAssigneeIds } },
          select: { id: true, name: true },
        })
      : []
    const subAssigneeMap = new Map(subAssignees.map((u) => [u.id, u.name]))

    return NextResponse.json({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      assigneeId: task.assigneeId,
      assignee,
      departmentId: task.departmentId,
      department: task.department,
      labels: task.labels ?? null,
      estimatedHours: task.estimatedHours ?? null,
      loggedHours: task.loggedHours ?? 0,
      parentTaskId: task.parentTaskId ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      subtasks: subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        priority: s.priority,
        assigneeId: s.assigneeId ?? null,
        assigneeName: s.assigneeId ? subAssigneeMap.get(s.assigneeId) ?? null : null,
        dueDate: s.dueDate ?? null,
        department: s.department,
      })),
      comments: commentsRaw.map((c) => ({
        id: c.id,
        body: c.body,
        authorId: c.authorId ?? null,
        authorName: c.authorName,
        createdAt: c.createdAt,
      })),
    })
  },
)

interface PatchBody {
  title?: string
  description?: string | null
  status?: string
  priority?: string
  dueDate?: string | null
  assigneeId?: string | null
  departmentId?: string | null
  labels?: string | null
  estimatedHours?: number | null
  loggedHours?: number | null
}

export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('tasks', 'update')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody

    const existing = await getScopedTask(ctx, id)
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (body.title !== undefined) {
      if (!body.title.trim()) {
        return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
      }
      data.title = body.title.trim()
    }
    if (body.description !== undefined) {
      data.description = body.description?.trim() || null
    }
    if (body.status !== undefined && body.status !== existing.status) {
      if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      data.status = body.status
    }
    if (body.priority !== undefined && body.priority !== existing.priority) {
      if (!VALID_PRIORITIES.includes(body.priority as (typeof VALID_PRIORITIES)[number])) {
        return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
      }
      data.priority = body.priority
    }
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null
    }
    if (body.assigneeId !== undefined) {
      if (body.assigneeId) {
        const u = await db.user.findFirst({
          where: { id: body.assigneeId, organizationId: ctx.organizationId },
          select: { id: true },
        })
        if (!u) {
          return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
        }
        data.assigneeId = body.assigneeId
      } else {
        data.assigneeId = null
      }
    }
    if (body.departmentId !== undefined && !isScopedRole(ctx.role)) {
      // Only non-scoped roles can change departments
      if (body.departmentId) {
        const dept = await db.department.findFirst({
          where: { id: body.departmentId, organizationId: ctx.organizationId },
          select: { id: true },
        })
        if (!dept) {
          return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
        }
        data.departmentId = body.departmentId
      } else {
        data.departmentId = null
      }
    }
    if (body.labels !== undefined) {
      data.labels = body.labels?.trim() || null
    }
    if (body.estimatedHours !== undefined) {
      data.estimatedHours =
        typeof body.estimatedHours === 'number' &&
        isFinite(body.estimatedHours) &&
        body.estimatedHours >= 0
          ? body.estimatedHours
          : null
    }
    if (body.loggedHours !== undefined) {
      data.loggedHours =
        typeof body.loggedHours === 'number' && isFinite(body.loggedHours) && body.loggedHours >= 0
          ? body.loggedHours
          : 0
    }

    const updated = await db.task.update({ where: { id }, data })
    await audit(ctx, 'tasks.update', 'task', id, {
      fields: Object.keys(data),
      statusChanged: body.status !== undefined && body.status !== existing.status,
    })

    // Notify the new assignee if the task was reassigned
    if (body.assigneeId && body.assigneeId !== existing.assigneeId && body.assigneeId !== ctx.user.id) {
      await db.notification.create({
        data: {
          userId: body.assigneeId,
          title: 'Task assigned to you',
          message: `"${updated.title}" has been assigned to you.`,
          link: 'tasks',
        },
      }).catch(() => {})
    }
    // Notify the assignee if status changed
    if (body.status && body.status !== existing.status && existing.assigneeId && existing.assigneeId !== ctx.user.id) {
      await db.notification.create({
        data: {
          userId: existing.assigneeId,
          title: `Task status: ${body.status}`,
          message: `"${existing.title}" status changed to ${body.status}.`,
          link: 'tasks',
        },
      }).catch(() => {})
    }

    return NextResponse.json({ id: updated.id, ok: true })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('tasks', 'delete')
    const { id } = await params
    const existing = await getScopedTask(ctx, id)
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    await db.task.delete({ where: { id } })
    await audit(ctx, 'tasks.delete', 'task', id, {
      title: existing.title,
      status: existing.status,
    })
    return NextResponse.json({ ok: true, id })
  },
)
