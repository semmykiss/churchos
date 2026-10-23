// ChurchOS — Event registration API (public-ish — requires auth, members can self-register)
// POST /api/events/[id]/register  body {name, email, phone?}
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { broadcastEvent } from '@/lib/ai-events'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

interface RegisterBody {
  name?: string
  email?: string | null
  phone?: string | null
}

export const POST = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('events', 'view')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as RegisterBody

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const ev = await db.event.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, title: true, capacity: true, status: true, _count: { select: { registrations: true } } },
    })
    if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    if (ev.status === 'cancelled') {
      return NextResponse.json({ error: 'This event has been cancelled.' }, { status: 400 })
    }

    // Capacity check (only if capacity > 0)
    if (ev.capacity && ev.capacity > 0 && ev._count.registrations >= ev.capacity) {
      return NextResponse.json(
        { error: 'Event is at full capacity', atCapacity: true },
        { status: 409 },
      )
    }

    const email = body.email?.trim() || null
    const phone = body.phone?.trim() || null

    // Duplicate email check (unique [eventId, email])
    if (email) {
      const dup = await db.registration.findFirst({
        where: { eventId: id, email },
        select: { id: true },
      })
      if (dup) {
        return NextResponse.json(
          { error: 'This email is already registered for this event', duplicate: true },
          { status: 409 },
        )
      }
    }

    try {
      const reg = await db.registration.create({
        data: {
          eventId: id,
          name: body.name.trim(),
          email,
          phone,
        },
      })
      await audit(ctx, 'events.register', 'registration', reg.id, {
        eventId: id,
        eventTitle: ev.title,
        email,
      })

      // Notify church admins of a new registration
      const admins = await db.user.findMany({
        where: { organizationId: ctx.organizationId, role: { in: ['church_admin', 'super_admin'] }, active: true },
        select: { id: true },
      })
      if (admins.length > 0) {
        await db.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            title: 'New event registration',
            message: `${body.name.trim()} registered for "${ev.title}".`,
            link: `event:${ev.id}`,
          })),
        }).catch(() => {})
      }

      // Broadcast to the AI assistant live events feed
      await broadcastEvent(ctx, {
        module: 'events',
        action: 'register',
        title: 'New event registration',
        message: `${body.name.trim()} registered for "${ev.title}".`,
        refId: ev.id,
        refType: 'event',
      })

      return NextResponse.json({
        id: reg.id,
        eventId: reg.eventId,
        name: reg.name,
        email: reg.email,
        phone: reg.phone,
        createdAt: reg.createdAt,
      }, { status: 201 })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === 'P2002') {
        return NextResponse.json(
          { error: 'This email is already registered for this event', duplicate: true },
          { status: 409 },
        )
      }
      throw e
    }
  },
)
