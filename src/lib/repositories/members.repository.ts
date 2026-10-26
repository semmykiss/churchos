// ChurchOS — Members Repository
// Single source of truth for all Member-related database operations.
// All queries are tenant-scoped (organizationId) and support ABAC filtering.
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const MembersRepo = {
  // ---- List with filters + pagination ----
  async list(orgId: string, opts: {
    q?: string; status?: string; branchId?: string; departmentId?: string
    maritalStatus?: string; isWorker?: string; gender?: string
    page?: number; pageSize?: number
  } = {}) {
    const { q, status, branchId, departmentId, maritalStatus, isWorker, gender,
            page = 1, pageSize = 10 } = opts

    const where: Prisma.MemberWhereInput = { organizationId: orgId }
    if (status) where.status = status
    if (branchId) where.branchId = branchId
    if (maritalStatus) where.maritalStatus = maritalStatus
    if (gender) where.gender = gender
    if (departmentId) where.departmentMemberships = { some: { departmentId } }
    if (isWorker === 'true') where.departmentMemberships = { some: {} }
    if (isWorker === 'false') where.departmentMemberships = { none: {} }
    if (q) {
      where.OR = [
        { firstName: { contains: q } }, { lastName: { contains: q } },
        { preferredName: { contains: q } }, { email: { contains: q } },
        { phone: { contains: q } }, { memberId: { contains: q } },
      ]
    }

    const [items, total] = await Promise.all([
      db.member.findMany({
        where,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize,
        include: {
          branch: { select: { id: true, name: true } },
          departmentMemberships: { include: { department: { select: { id: true, name: true, color: true } } } },
          household: { select: { id: true, name: true } },
        },
      }),
      db.member.count({ where }),
    ])
    return { items, total, page, pageSize }
  },

  // ---- Get by ID (with scoped access check) ----
  async getById(orgId: string, id: string) {
    return db.member.findFirst({
      where: { id, organizationId: orgId },
      include: {
        branch: true, household: { include: { members: { select: { id: true, firstName: true, lastName: true, status: true } } } },
        relationshipsFrom: { include: { toMember: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } } },
        relationshipsTo: { include: { fromMember: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } } },
        dependants: true,
        departmentMemberships: { include: { department: true } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
        _count: { select: { attendance: true, donations: true, tithes: true, pastoralCases: true, prayers: true } },
      },
    })
  },

  // ---- Create ----
  async create(orgId: string, data: Prisma.MemberUncheckedCreateInput) {
    return db.member.create({ data: { ...data, organizationId: orgId } })
  },

  // ---- Update ----
  async update(id: string, data: Prisma.MemberUpdateInput) {
    return db.member.update({ where: { id }, data })
  },

  // ---- Delete ----
  async delete(id: string) {
    return db.member.delete({ where: { id } })
  },

  // ---- Stats ----
  async stats(orgId: string) {
    const [total, byStatus] = await Promise.all([
      db.member.count({ where: { organizationId: orgId } }),
      db.member.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: true }),
    ])
    return { total, byStatus }
  },

  // ---- Celebrations (birthdays + anniversaries) ----
  async birthdays(orgId: string, month?: number) {
    const where: Prisma.MemberWhereInput = {
      organizationId: orgId, dateOfBirth: { not: null },
    }
    const members = await db.member.findMany({
      where, select: { id: true, firstName: true, lastName: true, dateOfBirth: true, photoUrl: true, branchId: true, memberId: true },
    })
    return members.filter(m => {
      if (!m.dateOfBirth) return false
      if (month !== undefined) return m.dateOfBirth.getMonth() === month
      return true
    })
  },

  async anniversaries(orgId: string, month?: number) {
    const members = await db.member.findMany({
      where: { organizationId: orgId, weddingAnniversary: { not: null } },
      select: { id: true, firstName: true, lastName: true, weddingAnniversary: true, photoUrl: true, branchId: true, memberId: true },
    })
    return members.filter(m => {
      if (!m.weddingAnniversary) return false
      if (month !== undefined) return m.weddingAnniversary.getMonth() === month
      return true
    })
  },
}
