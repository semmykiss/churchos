// ChurchOS — Task comments API
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

// GET /api/tasks/[id]/comments — list comments for a task
export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('tasks', 'view')
  const { id } = await params
  const task = await db.task.findFirst({ where: { id, organizationId: ctx.organizationId } })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  // Member scoping: only if assigned to them
  if (ctx.role === 'member' && task.assigneeId !== ctx.user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  const comments = await db.taskComment.findMany({
    where: { taskId: id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ items: comments })
})

// POST /api/tasks/[id]/comments — add a comment
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('tasks', 'view')
  const { id } = await params
  const task = await db.task.findFirst({ where: { id, organizationId: ctx.organizationId } })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (ctx.role === 'member' && task.assigneeId !== ctx.user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  if (!body.body?.trim()) return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })
  const comment = await db.taskComment.create({
    data: { taskId: id, authorId: ctx.user.id, authorName: ctx.user.name, body: body.body.trim() },
  })
  await audit(ctx, 'tasks.comment', 'task', id)
  return NextResponse.json(comment, { status: 201 })
})
