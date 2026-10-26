// ChurchOS — Events Repository
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const EventsRepo = {
  async list(orgId: string, opts: { from?: Date; to?: Date; departmentId?: string; page?: number; pageSize?: number } = {}) {
    const { from, to, departmentId, page = 1, pageSize = 20 } = opts
    const where: Prisma.EventWhereInput = { organizationId: orgId }
    if (departmentId) where.departmentId = departmentId
    if (from || to) where.startDate = { ...(from && { gte: from }), ...(to && { lte: to }) }
    const [items, total] = await Promise.all([
      db.event.findMany({ where, orderBy: { startDate: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { registrations: true } } } }),
      db.event.count({ where }),
    ])
    return { items, total, page, pageSize }
  },
  async getById(orgId: string, id: string) {
    return db.event.findFirst({ where: { id, organizationId: orgId }, include: { registrations: true, department: true } })
  },
  async create(orgId: string, data: Prisma.EventUncheckedCreateInput) {
    return db.event.create({ data: { ...data, organizationId: orgId } })
  },
  async update(id: string, data: Prisma.EventUpdateInput) {
    return db.event.update({ where: { id }, data })
  },
  async delete(id: string) {
    return db.event.delete({ where: { id } })
  },
  async register(eventId: string, data: { name: string; email: string; phone?: string }) {
    return db.registration.create({ data: { eventId, ...data } })
  },
}
