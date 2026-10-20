// ChurchOS — Pastoral Case detail API
// GET    /api/pastoral/[id]   — single case (privateNotes gated)
// PATCH  /api/pastoral/[id]   — update status/assignee/privateNotes (appendNote helper)
// DELETE /api/pastoral/[id]   — delete case (audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_TYPES = ['prayer', 'counselling', 'visitation', 'bereavement', 'hospital', 'welfare'] as const
const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

const PRIVATE_NOTE_ROLES = ['pastor', 'super_admin']

type Ctx = Awaited<ReturnType<typeof requirePermission>>

async function getScoped(id: string, ctx: Ctx) {
  const c = await db.pastoralCase.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      member: {
        select: { id: true, firstName: true, lastName: true, memberId: true, phone: true, email: true },
      },
    },
  })
  if (!c) return null
  // Resolve assignedTo manually (no relation defined in schema)
  let assignedTo: { id: string; name: string; role: string } | null = null
  if (c.assignedToId) {
    const u = await db.user.findUnique({
      where: { id: c.assignedToId },
      select: { id: true, name: true, role: true },
    })
    assignedTo = u
  }
  return { ...c, assignedTo }
}

export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('pastoral', 'view')
    const { id } = await params
    const c = await getScoped(id, ctx)
    if (!c) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    // Audit sensitive single-case views
    await audit(ctx, 'pastoral.case.view', 'pastoralCase', c.id, {
      type: c.type,
      status: c.status,
    })

    const canSeePrivate = PRIVATE_NOTE_ROLES.includes(ctx.role)
    return NextResponse.json({
      id: c.id,
      type: c.type,
      status: c.status,
      priority: c.priority,
      description: c.description,
      privateNotes: canSeePrivate ? c.privateNotes : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      memberId: c.memberId,
      member: c.member,
      assignedToId: c.assignedToId,
      assignedTo: c.assignedTo,
    })
  },
)

interface PatchBody {
  type?: string
  status?: string
  priority?: string
  description?: string
  assignedToId?: string | null
  appendNote?: string
  privateNotes?: string | null
}

export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('pastoral', 'update')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody
    const existing = await getScoped(id, ctx)
    if (!existing) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (body.type !== undefined) {
      if (!VALID_TYPES.includes(body.type as (typeof VALID_TYPES)[number])) {
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
      }
      data.type = body.type
    }
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      data.status = body.status
    }
    if (body.priority !== undefined) {
      if (!VALID_PRIORITIES.includes(body.priority as (typeof VALID_PRIORITIES)[number])) {
        return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
      }
      data.priority = body.priority
    }
    if (body.description !== undefined) {
      data.description = typeof body.description === 'string' ? body.description.trim() : null
    }
    if (body.assignedToId !== undefined) {
      if (body.assignedToId) {
        const u = await db.user.findFirst({
          where: { id: body.assignedToId, organizationId: ctx.organizationId },
          select: { id: true },
        })
        if (!u) {
          return NextResponse.json({ error: 'Invalid assignedTo user' }, { status: 400 })
        }
        data.assignedToId = u.id
      } else {
        data.assignedToId = null
      }
    }

    const canSeePrivate = PRIVATE_NOTE_ROLES.includes(ctx.role)
    if (body.privateNotes !== undefined && canSeePrivate) {
      // Direct overwrite of privateNotes
      data.privateNotes = body.privateNotes?.trim() || null
    }

    // Append a note (timestamped) — only pastor/super_admin
    let appendedNote = false
    if (body.appendNote && typeof body.appendNote === 'string' && body.appendNote.trim()) {
      if (!canSeePrivate) {
        return NextResponse.json(
          { error: 'You are not authorized to add private case notes.' },
          { status: 403 },
        )
      }
      const stamp = new Date().toISOString()
      const actor = ctx.user.name ?? ctx.user.email
      const note = `[${stamp}] ${actor}: ${body.appendNote.trim()}`
      const existingNotes = existing.privateNotes ? existing.privateNotes + '\n' : ''
      data.privateNotes = existingNotes + note
      appendedNote = true
    }

    const updated = await db.pastoralCase.update({ where: { id }, data })

    await audit(ctx, 'pastoral.case.update', 'pastoralCase', id, {
      fields: Object.keys(data),
      appendedNote,
    })

    return NextResponse.json({
      id: updated.id,
      ok: true,
      privateNotes: canSeePrivate ? updated.privateNotes : null,
    })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('pastoral', 'delete')
    const { id } = await params
    const existing = await getScoped(id, ctx)
    if (!existing) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }
    await db.pastoralCase.delete({ where: { id } })
    await audit(ctx, 'pastoral.case.delete', 'pastoralCase', id, {
      type: existing.type,
      status: existing.status,
    })
    return NextResponse.json({ ok: true, id })
  },
)
