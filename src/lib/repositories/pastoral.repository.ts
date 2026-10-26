// ChurchOS — Pastoral Care Repository
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const PastoralRepo = {
  async listCases(orgId: string, opts: { status?: string; type?: string; priority?: string; assignedToId?: string; page?: number; pageSize?: number } = {}) {
    const { status, type, priority, assignedToId, page = 1, pageSize = 50 } = opts
    const where: Prisma.PastoralCaseWhereInput = { organizationId: orgId }
    if (status) where.status = status
    if (type) where.type = type
    if (priority) where.priority = priority
    if (assignedToId) where.assignedToId = assignedToId
    const [items, total] = await Promise.all([
      db.pastoralCase.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } } } }),
      db.pastoralCase.count({ where }),
    ])
    return { items, total, page, pageSize }
  },
  async getCase(orgId: string, id: string) {
    return db.pastoralCase.findFirst({ where: { id, organizationId: orgId }, include: { member: true } })
  },
  async createCase(orgId: string, data: Prisma.PastoralCaseUncheckedCreateInput) {
    return db.pastoralCase.create({ data: { ...data, organizationId: orgId } })
  },
  async updateCase(id: string, data: Prisma.PastoralCaseUpdateInput) {
    return db.pastoralCase.update({ where: { id }, data })
  },
  async listPrayers(orgId: string, opts: { status?: string; memberId?: string; page?: number; pageSize?: number } = {}) {
    const { status, memberId, page = 1, pageSize = 50 } = opts
    const where: Prisma.PrayerRequestWhereInput = { organizationId: orgId }
    if (status) where.status = status
    if (memberId) where.memberId = memberId
    const [items, total] = await Promise.all([
      db.prayerRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      db.prayerRequest.count({ where }),
    ])
    return { items, total, page, pageSize }
  },
  async createPrayer(orgId: string, data: Prisma.PrayerRequestUncheckedCreateInput) {
    return db.prayerRequest.create({ data: { ...data, organizationId: orgId } })
  },
  async updatePrayer(id: string, data: Prisma.PrayerRequestUpdateInput) {
    return db.prayerRequest.update({ where: { id }, data })
  },
}
