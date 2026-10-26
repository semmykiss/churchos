// ChurchOS — Follow-up Task detail API
// GET    /api/followups/[id]  — task with visitor + interactions
// PATCH  /api/followups/[id]  — update fields, OR add interaction via {addInteraction: {method, notes}}
// DELETE /api/followups/[id]  — delete task (cascade interactions)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['pending', 'in_progress', 'done', 'lost'] as const
const VALID_METHODS = ['call', 'sms', 'email', 'visit'] as const

type Ctx = Awaited<ReturnType<typeof requirePermission>>

async function getScopedTask(ctx: Ctx, id: string) {
  return db.followUpTask.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, status: true, visitorId: true, ownerId: true, notes: true, outcome: true, dueDate: true }
  })
}

export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('followups', 'view')
    const { id } = await params

    const t = await db.followUpTask.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        visitor: {
          select: {
            id: true, firstName: true, lastName: true, phone: true, email: true,
            referralSource: true, convertedMemberId: true,
          },
        },
        interactions: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    })
    if (!t) return NextResponse.json({ error: 'Follow-up task not found' }, { status: 404 })

    const canSeeNotes = can(ctx.role, 'followups', 'update')

    // memberId has no FK relation in the schema — fetch the member (if any) separately
    let member: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null } | null = null
    if (t.memberId) {
      member = await db.member.findFirst({
        where: { id: t.memberId },
        select: { id: true, firstName: true, lastName: true, phone: true, email: true },
      })
    }

    // ownerId has no FK relation in the schema — fetch the owner (if any) separately
    let owner: { id: string; name: string; email: string } | null = null
    if (t.ownerId) {
      owner = await db.user.findFirst({
        where: { id: t.ownerId },
        select: { id: true, name: true, email: true },
      })
    }

    return NextResponse.json({
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
      member,
      owner,
      interactions: t.interactions,
    })
  },
)

interface PatchBody {
  status?: string
  ownerId?: string | null
  dueDate?: string | null
  notes?: string | null
  outcome?: string | null
  // Add an interaction log entry (rather than a separate sub-route per task constraints)
  addInteraction?: { method?: string; notes?: string | null } | null
}

export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('followups', 'update')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody

    const existing = await getScopedTask(ctx, id)
    if (!existing) return NextResponse.json({ error: 'Follow-up task not found' }, { status: 404 })

    // ----- addInteraction sub-action -----
    if (body.addInteraction && typeof body.addInteraction === 'object') {
      const method =
        body.addInteraction.method &&
        VALID_METHODS.includes(body.addInteraction.method as (typeof VALID_METHODS)[number])
          ? body.addInteraction.method!
          : 'call'
      const notes = body.addInteraction.notes?.trim() || null
      const interaction = await db.followUpInteraction.create({
        data: { taskId: id, method, notes },
      })
      // Also move task to in_progress if currently pending
      const data: Record<string, unknown> = {}
      if (existing.status === 'pending') data.status = 'in_progress'
      if (Object.keys(data).length) {
        await db.followUpTask.update({ where: { id }, data })
      }
      await audit(ctx, 'followups.interaction', 'interaction', interaction.id, {
        taskId: id,
        method,
      })
      return NextResponse.json({
        ok: true,
        interaction: {
          id: interaction.id,
          method: interaction.method,
          notes: interaction.notes,
          createdAt: interaction.createdAt,
        },
      })
    }

    // ----- regular field update -----
    const data: Record<string, unknown> = {}
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
        return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
      }
      data.status = body.status
      if (body.status === 'done') data.outcome = body.outcome?.trim() || existing.outcome
    }
    if (body.ownerId !== undefined) {
      if (body.ownerId) {
        const u = await db.user.findFirst({
          where: { id: body.ownerId, organizationId: ctx.organizationId },
          select: { id: true },
        })
        if (!u) return NextResponse.json({ error: 'Invalid ownerId' }, { status: 400 })
        data.ownerId = body.ownerId
      } else {
        data.ownerId = null
      }
    }
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null
    }
    if (body.notes !== undefined) data.notes = body.notes?.trim() || null
    if (body.outcome !== undefined) data.outcome = body.outcome?.trim() || null

    const updated = await db.followUpTask.update({ where: { id }, data })
    await audit(ctx, 'followups.update', 'followup', id, { fields: Object.keys(data) })

    return NextResponse.json({ id: updated.id, ok: true })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('followups', 'delete')
    const { id } = await params
    const existing = await getScopedTask(ctx, id)
    if (!existing) return NextResponse.json({ error: 'Follow-up task not found' }, { status: 404 })

    await db.followUpTask.delete({ where: { id } })
    await audit(ctx, 'followups.delete', 'followup', id, {})
    return NextResponse.json({ ok: true, id })
  },
)
