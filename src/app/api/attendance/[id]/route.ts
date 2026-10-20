// ChurchOS — Attendance session detail API
// GET    /api/attendance/[id]  — single session with records (member names) + service
// DELETE /api/attendance/[id]  — delete session (cascade records)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('attendance', 'view')
    const { id } = await params

    const session = await db.attendanceSession.findFirst({
      where: { id, service: { organizationId: ctx.organizationId } },
      include: {
        service: {
          select: {
            id: true, name: true, serviceType: true,
            dayOfWeek: true, startTime: true, endTime: true,
          },
        },
        branch: { select: { id: true, name: true } },
        records: {
          orderBy: { checkInTime: 'desc' },
          include: {
            member: {
              select: {
                id: true, firstName: true, lastName: true,
                preferredName: true, memberId: true, photoUrl: true,
              },
            },
          },
        },
      },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: session.id,
      serviceId: session.serviceId,
      branchId: session.branchId,
      date: session.date,
      notes: session.notes,
      createdAt: session.createdAt,
      service: session.service,
      branch: session.branch,
      records: session.records.map((r) => ({
        id: r.id,
        memberId: r.memberId,
        visitorName: r.visitorName,
        checkInMethod: r.checkInMethod,
        checkInTime: r.checkInTime,
        member: r.member
          ? {
              id: r.member.id,
              firstName: r.member.firstName,
              lastName: r.member.lastName,
              preferredName: r.member.preferredName,
              memberId: r.member.memberId,
              photoUrl: r.member.photoUrl,
            }
          : null,
      })),
      count: session.records.length,
    })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('attendance', 'delete')
    const { id } = await params

    const session = await db.attendanceSession.findFirst({
      where: { id, service: { organizationId: ctx.organizationId } },
      select: { id: true, date: true, serviceId: true, _count: { select: { records: true } } },
    })
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    // Cascade: delete records then session (Prisma onDelete Cascade already handles this
    // but explicit is safer)
    await db.attendanceRecord.deleteMany({ where: { sessionId: id } })
    await db.attendanceSession.delete({ where: { id } })

    await audit(ctx, 'attendance.delete_session', 'session', id, {
      date: session.date,
      records: session._count.records,
    })

    return NextResponse.json({ ok: true, id })
  },
)
