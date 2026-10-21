// ChurchOS — Event detail API
// GET    /api/events/[id]  — single event with registrations
// PATCH  /api/events/[id]  — update fields (scoped dept_head verified)
// DELETE /api/events/[id]  — delete (cascade registrations)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { isScopedRole } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_EVENT_TYPES = [
  'service', 'conference', 'meeting', 'retreat', 'outreach', 'training', 'special',
] as const
const VALID_STATUSES = ['scheduled', 'approved', 'cancelled', 'completed'] as const

type Ctx = Awaited<ReturnType<typeof requirePermission>>

async function getScopedEvent(ctx: Ctx, id: string) {
  return db.event.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: {
      id: true, title: true, description: true, eventType: true, venue: true,
      capacity: true, startDate: true, endDate: true, status: true,
      departmentId: true, branchId: true, organizationId: true, createdBy: true,
    },
  })
}

export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('events', 'view')
    const { id } = await params

    // Scoped roles can only view their own department's events (or no department)
    const ev = await db.event.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        department: { select: { id: true, name: true, color: true } },
        branch: { select: { id: true, name: true } },
        registrations: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    if (isScopedRole(ctx.role) && ctx.departmentId && ev.departmentId && ev.departmentId !== ctx.departmentId) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

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
      createdAt: ev.createdAt,
      updatedAt: ev.updatedAt,
      departmentId: ev.departmentId,
      branchId: ev.branchId,
      department: ev.department,
      branch: ev.branch,
      registrations: ev.registrations.map((r) => ({
        id: r.id, name: r.name, email: r.email, phone: r.phone, createdAt: r.createdAt,
      })),
      registrationsCount: ev.registrations.length,
    })
  },
)

interface PatchBody {
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

export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('events', 'update')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody

    const existing = await getScopedEvent(ctx, id)
    if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // Scoped role enforcement
    if (isScopedRole(ctx.role) && ctx.departmentId && existing.departmentId && existing.departmentId !== ctx.departmentId) {
      return NextResponse.json(
        { error: 'You can only update events in your own department.' },
        { status: 403 },
      )
    }

    const data: Record<string, unknown> = {}
    if (body.title !== undefined) {
      if (!body.title.trim()) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
      data.title = body.title.trim()
    }
    if (body.description !== undefined) data.description = body.description?.trim() || null
    if (body.venue !== undefined) data.venue = body.venue?.trim() || null
    if (body.eventType !== undefined) {
      if (!VALID_EVENT_TYPES.includes(body.eventType as (typeof VALID_EVENT_TYPES)[number])) {
        return NextResponse.json({ error: 'Invalid eventType' }, { status: 400 })
      }
      data.eventType = body.eventType
    }
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      data.status = body.status
    }
    if (body.capacity !== undefined) {
      data.capacity =
        typeof body.capacity === 'number' && body.capacity >= 0
          ? Math.min(100000, Math.floor(body.capacity))
          : null
    }
    if (body.startDate !== undefined) {
      const d = new Date(body.startDate)
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })
      data.startDate = d
    }
    if (body.endDate !== undefined) {
      data.endDate = body.endDate ? new Date(body.endDate) : null
    }
    if (body.departmentId !== undefined) {
      // Scoped roles cannot change departmentId
      if (isScopedRole(ctx.role)) {
        // ignore change for scoped roles
      } else if (body.departmentId) {
        const d = await db.department.findFirst({
          where: { id: body.departmentId, organizationId: ctx.organizationId },
          select: { id: true },
        })
        if (!d) return NextResponse.json({ error: 'Invalid departmentId' }, { status: 400 })
        data.departmentId = body.departmentId
      } else {
        data.departmentId = null
      }
    }
    if (body.branchId !== undefined) {
      if (body.branchId) {
        const b = await db.branch.findFirst({
          where: { id: body.branchId, organizationId: ctx.organizationId },
          select: { id: true },
        })
        if (!b) return NextResponse.json({ error: 'Invalid branchId' }, { status: 400 })
        data.branchId = body.branchId
      } else {
        data.branchId = null
      }
    }

    const updated = await db.event.update({ where: { id }, data })
    await audit(ctx, 'events.update', 'event', id, { fields: Object.keys(data) })

    return NextResponse.json({ id: updated.id, ok: true })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('events', 'delete')
    const { id } = await params
    const existing = await getScopedEvent(ctx, id)
    if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    if (isScopedRole(ctx.role) && ctx.departmentId && existing.departmentId && existing.departmentId !== ctx.departmentId) {
      return NextResponse.json(
        { error: 'You can only delete events in your own department.' },
        { status: 403 },
      )
    }

    // Cascade registrations
    await db.registration.deleteMany({ where: { eventId: id } })
    await db.event.delete({ where: { id } })

    await audit(ctx, 'events.delete', 'event', id, {
      title: existing.title,
    })
    return NextResponse.json({ ok: true, id })
  },
)
