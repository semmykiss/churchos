// ChurchOS — Attendance Repository
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const AttendanceRepo = {
  async listServices(orgId: string) {
    return db.service.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } })
  },
  async createService(orgId: string, data: Prisma.ServiceCreateInput) {
    return db.service.create({ data: { ...data, organizationId: orgId } })
  },
  async listSessions(orgId: string, opts: { serviceId?: string; from?: Date; to?: Date; page?: number; pageSize?: number } = {}) {
    const { serviceId, from, to, page = 1, pageSize = 20 } = opts
    const where: Prisma.AttendanceSessionWhereInput = { service: { organizationId: orgId } }
    if (serviceId) where.serviceId = serviceId
    if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) }
    const [items, total] = await Promise.all([
      db.attendanceSession.findMany({ where, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { service: true, _count: { select: { records: true } } } }),
      db.attendanceSession.count({ where }),
    ])
    return { items, total, page, pageSize }
  },
  async createSession(data: Prisma.AttendanceSessionCreateInput) {
    return db.attendanceSession.create({ data })
  },
  async checkIn(sessionId: string, memberId: string, method: string) {
    return db.attendanceRecord.create({ data: { sessionId, memberId, checkInMethod: method } })
  },
  async getSession(orgId: string, id: string) {
    return db.attendanceSession.findFirst({ where: { id, service: { organizationId: orgId } }, include: { service: true, records: { include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } } } } } })
  },
  async stats(orgId: string) {
    const total = await db.attendanceRecord.count({ where: { session: { service: { organizationId: orgId } } } })
    const lastSession = await db.attendanceSession.findFirst({ where: { service: { organizationId: orgId } }, orderBy: { date: 'desc' }, include: { _count: { select: { records: true } } } })
    return { totalRecords: total, lastSessionCount: lastSession?._count.records ?? 0 }
  },
}
