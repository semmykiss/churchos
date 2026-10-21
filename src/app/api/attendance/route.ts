// ChurchOS — Attendance & Services API
// GET  /api/attendance              — list sessions (filter by service/date, stats option)
// POST /api/attendance             — create session OR record check-in (action: 'checkin' | 'session')
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_METHODS = ['manual', 'qr'] as const

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('attendance', 'view')
  const { organizationId } = ctx

  const sp = req.nextUrl.searchParams
  const serviceId = sp.get('serviceId') ?? ''
  const fromStr = sp.get('from')
  const toStr = sp.get('to')
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '20', 10) || 20))
  const statsOnly = sp.get('stats') === '1'

  // Optional service filter scoped to org
  let serviceFilter: { id?: string } = {}
  if (serviceId) {
    const svc = await db.service.findFirst({
      where: { id: serviceId, organizationId },
      select: { id: true },
    })
    if (!svc) return NextResponse.json({ error: 'Invalid serviceId' }, { status: 400 })
    serviceFilter = { id: serviceId }
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

  // Stats-only response for trends tab
  if (statsOnly) {
    const where = {
      service: { organizationId, ...serviceFilter },
      ...(Object.keys(dateRange).length ? { date: dateRange } : {}),
    }
    const [totalRecords, sessions, lastSession] = await Promise.all([
      db.attendanceRecord.count({ where: { session: where } }),
      db.attendanceSession.findMany({
        where,
        orderBy: { date: 'desc' },
        take: 12,
        include: { _count: { select: { records: true } }, service: { select: { id: true, name: true } } },
      }),
      db.attendanceSession.findFirst({
        where,
        orderBy: { date: 'desc' },
        include: { _count: { select: { records: true } }, service: { select: { name: true } } },
      }),
    ])
    const totalSessions = sessions.length
    const avgPerSession = totalSessions > 0 ? Math.round(totalRecords / Math.max(1, sessions.length)) : 0
    return NextResponse.json({
      totalRecords,
      avgPerSession,
      lastSessionCount: lastSession?._count.records ?? 0,
      lastSessionLabel: lastSession
        ? `${lastSession.service.name} · ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(lastSession.date)}`
        : null,
      trend: sessions
        .reverse()
        .map((s) => ({
          id: s.id,
          serviceId: s.service.id,
          serviceName: s.service.name,
          date: s.date,
          label: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(s.date),
          count: s._count.records,
        })),
    })
  }

  const where = {
    service: { organizationId, ...serviceFilter },
    ...(Object.keys(dateRange).length ? { date: dateRange } : {}),
  }

  const [items, total, services] = await Promise.all([
    db.attendanceSession.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        service: { select: { id: true, name: true, serviceType: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { records: true } },
      },
    }),
    db.attendanceSession.count({ where }),
    db.service.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, serviceType: true, dayOfWeek: true,
        startTime: true, endTime: true, active: true,
        branch: { select: { id: true, name: true } },
        _count: { select: { sessions: true } },
      },
    }),
  ])

  return NextResponse.json({
    items: items.map((s) => ({
      id: s.id,
      date: s.date,
      notes: s.notes,
      createdAt: s.createdAt,
      records: s._count.records,
      service: s.service,
      branch: s.branch,
    })),
    total,
    page,
    pageSize,
    services: services.map((s) => ({
      id: s.id, name: s.name, serviceType: s.serviceType,
      dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
      active: s.active, branch: s.branch, sessions: s._count.sessions,
    })),
  })
})

interface SessionBody {
  action?: 'session' | 'checkin'
  // session create fields
  serviceId?: string
  date?: string
  notes?: string
  branchId?: string | null
  // check-in fields
  sessionId?: string
  memberId?: string
  visitorName?: string | null
  checkInMethod?: string
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('attendance', 'create')
  const body = (await req.json().catch(() => ({}))) as SessionBody
  const action = body.action ?? 'session'

  if (action === 'checkin') {
    return recordCheckIn(ctx, body)
  }

  // ---- create session ----
  if (!body.serviceId || typeof body.serviceId !== 'string') {
    return NextResponse.json({ error: 'serviceId is required' }, { status: 400 })
  }
  const svc = await db.service.findFirst({
    where: { id: body.serviceId, organizationId: ctx.organizationId },
    select: { id: true, branchId: true },
  })
  if (!svc) return NextResponse.json({ error: 'Invalid service' }, { status: 400 })

  if (!body.date || typeof body.date !== 'string') {
    return NextResponse.json({ error: 'date is required' }, { status: 400 })
  }
  const d = new Date(body.date)
  if (isNaN(d.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  let branchId = body.branchId ?? svc.branchId ?? null
  if (branchId) {
    const br = await db.branch.findFirst({
      where: { id: branchId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!br) branchId = null
  }

  const session = await db.attendanceSession.create({
    data: {
      serviceId: svc.id,
      branchId,
      date: d,
      notes: body.notes?.trim() || null,
    },
    include: {
      service: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      _count: { select: { records: true } },
    },
  })

  await audit(ctx, 'attendance.create_session', 'session', session.id, {
    serviceId: svc.id, date: session.date,
  })

  return NextResponse.json({
    id: session.id,
    serviceId: session.serviceId,
    branchId: session.branchId,
    date: session.date,
    notes: session.notes,
    createdAt: session.createdAt,
    records: session._count.records,
    service: session.service,
    branch: session.branch,
  }, { status: 201 })
})

async function recordCheckIn(
  ctx: Awaited<ReturnType<typeof requirePermission>>,
  body: SessionBody,
) {
  const { organizationId } = ctx
  const sessionId = body.sessionId
  if (!sessionId || typeof sessionId !== 'string') {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  // Verify session belongs to this org (via service relation)
  const session = await db.attendanceSession.findFirst({
    where: { id: sessionId, service: { organizationId } },
    include: { service: { select: { id: true, name: true } } },
  })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const method =
    body.checkInMethod && VALID_METHODS.includes(body.checkInMethod as (typeof VALID_METHODS)[number])
      ? body.checkInMethod!
      : 'manual'

  // Either memberId or visitorName must be provided
  let memberId: string | null = null
  let visitorName: string | null = null

  if (body.memberId && typeof body.memberId === 'string' && body.memberId.trim()) {
    const m = await db.member.findFirst({
      where: { id: body.memberId.trim(), organizationId },
      select: { id: true, firstName: true, lastName: true, memberId: true },
    })
    if (!m) {
      return NextResponse.json({ error: 'Member not found in this organization' }, { status: 404 })
    }
    memberId = m.id
  } else if (body.visitorName && typeof body.visitorName === 'string' && body.visitorName.trim()) {
    visitorName = body.visitorName.trim()
  } else {
    return NextResponse.json(
      { error: 'Either memberId or visitorName is required' },
      { status: 400 },
    )
  }

  // Server-side duplicate prevention: @@unique([sessionId, memberId])
  if (memberId) {
    const existing = await db.attendanceRecord.findFirst({
      where: { sessionId, memberId },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'Already checked in', duplicate: true },
        { status: 409 },
      )
    }
  }

  try {
    const rec = await db.attendanceRecord.create({
      data: {
        sessionId,
        memberId,
        visitorName,
        checkInMethod: method,
      },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, memberId: true } },
      },
    })
    await audit(ctx, 'attendance.checkin', 'record', rec.id, {
      sessionId, memberId, visitorName, method,
    })
    return NextResponse.json({
      id: rec.id,
      sessionId: rec.sessionId,
      memberId: rec.memberId,
      visitorName: rec.visitorName,
      checkInMethod: rec.checkInMethod,
      checkInTime: rec.checkInTime,
      member: rec.member,
    }, { status: 201 })
  } catch (e: unknown) {
    // P2002 unique constraint violation
    const code = (e as { code?: string })?.code
    if (code === 'P2002') {
      return NextResponse.json(
        { error: 'Already checked in', duplicate: true },
        { status: 409 },
      )
    }
    throw e
  }
}
