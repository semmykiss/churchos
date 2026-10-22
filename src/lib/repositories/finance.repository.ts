// ChurchOS — Finance Repository
// Single source of truth for all finance-related DB operations.
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const FinanceRepo = {
  // ---- Funds ----
  async listFunds(orgId: string) {
    return db.fund.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } })
  },
  async createFund(orgId: string, data: Prisma.FundCreateInput) {
    return db.fund.create({ data: { ...data, organizationId: orgId } })
  },

  // ---- Donations ----
  async listDonations(orgId: string, opts: {
    fundId?: string; method?: string; status?: string; from?: Date; to?: Date;
    memberId?: string; page?: number; pageSize?: number
  } = {}) {
    const { fundId, method, status, from, to, memberId, page = 1, pageSize = 20 } = opts
    const where: Prisma.DonationWhereInput = { organizationId: orgId }
    if (fundId) where.fundId = fundId
    if (method) where.method = method
    if (status) where.status = status
    if (memberId) where.memberId = memberId
    if (from || to) where.donatedAt = { ...(from && { gte: from }), ...(to && { lte: to }) }
    const [items, total] = await Promise.all([
      db.donation.findMany({ where, orderBy: { donatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { member: { select: { id: true, firstName: true, lastName: true } }, fund: { select: { id: true, name: true } } } }),
      db.donation.count({ where }),
    ])
    return { items, total, page, pageSize }
  },
  async createDonation(orgId: string, data: Prisma.DonationCreateInput) {
    return db.donation.create({ data: { ...data, organizationId: orgId } })
  },
  async updateDonation(id: string, data: Prisma.DonationUpdateInput) {
    return db.donation.update({ where: { id }, data })
  },
  async deleteDonation(id: string) {
    return db.donation.delete({ where: { id } })
  },

  // ---- Tithes ----
  async listTithes(orgId: string, opts: {
    memberId?: string; status?: string; from?: Date; to?: Date; page?: number; pageSize?: number
  } = {}) {
    const { memberId, status, from, to, page = 1, pageSize = 20 } = opts
    const where: Prisma.TitheWhereInput = { organizationId: orgId }
    if (memberId) where.memberId = memberId
    if (status) where.status = status
    if (from || to) where.titheMonth = { ...(from && { gte: from }), ...(to && { lte: to }) }
    const [items, total] = await Promise.all([
      db.tithe.findMany({ where, orderBy: { titheMonth: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } } } }),
      db.tithe.count({ where }),
    ])
    return { items, total, page, pageSize }
  },
  async createTithe(orgId: string, data: Prisma.TitheCreateInput) {
    return db.tithe.create({ data: { ...data, organizationId: orgId } })
  },
  async updateTithe(id: string, data: Prisma.TitheUpdateInput) {
    return db.tithe.update({ where: { id }, data })
  },

  // ---- Expenses ----
  async listExpenses(orgId: string, opts: { status?: string; category?: string; page?: number; pageSize?: number } = {}) {
    const { status, category, page = 1, pageSize = 20 } = opts
    const where: Prisma.ExpenseWhereInput = { organizationId: orgId }
    if (status) where.status = status
    if (category) where.category = category
    const [items, total] = await Promise.all([
      db.expense.findMany({ where, orderBy: { incurredAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { fund: { select: { id: true, name: true } } } }),
      db.expense.count({ where }),
    ])
    return { items, total, page, pageSize }
  },
  async createExpense(orgId: string, data: Prisma.ExpenseCreateInput) {
    return db.expense.create({ data: { ...data, organizationId: orgId } })
  },
  async updateExpense(id: string, data: Prisma.ExpenseUpdateInput) {
    return db.expense.update({ where: { id }, data })
  },

  // ---- Budgets ----
  async listBudgets(orgId: string) {
    return db.budget.findMany({ where: { organizationId: orgId }, orderBy: [{ fiscalYear: 'desc' }, { period: 'asc' }], include: { fund: { select: { id: true, name: true, code: true } } } })
  },
  async createBudget(orgId: string, data: Prisma.BudgetCreateInput) {
    return db.budget.create({ data: { ...data, organizationId: orgId } })
  },
  async updateBudget(id: string, data: Prisma.BudgetUpdateInput) {
    return db.budget.update({ where: { id }, data })
  },
  async deleteBudget(id: string) {
    return db.budget.delete({ where: { id } })
  },

  // ---- Overview / Stats ----
  async overview(orgId: string) {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const [income, expenses, pendingExpenses, funds, pendingDonations, pendingTithes] = await Promise.all([
      db.donation.aggregate({ where: { organizationId: orgId, status: 'confirmed', donatedAt: { gte: startOfMonth } }, _sum: { amount: true }, _count: true }),
      db.expense.aggregate({ where: { organizationId: orgId, status: { in: ['approved', 'paid'] }, incurredAt: { gte: startOfMonth } }, _sum: { amount: true } }),
      db.expense.count({ where: { organizationId: orgId, status: 'pending' } }),
      db.fund.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, balance: true, code: true } }),
      db.donation.count({ where: { organizationId: orgId, status: 'pending' } }),
      db.tithe.count({ where: { organizationId: orgId, status: 'pending' } }),
    ])
    return {
      incomeThisMonth: income._sum.amount ?? 0,
      incomeCountThisMonth: income._count,
      expensesThisMonth: expenses._sum.amount ?? 0,
      pendingApprovals: pendingExpenses,
      funds,
      pendingSubmissions: { donations: pendingDonations, tithes: pendingTithes, total: pendingDonations + pendingTithes },
    }
  },

  // ---- Pending submissions (for staff approval) ----
  async pendingSubmissions(orgId: string) {
    const [donations, tithes] = await Promise.all([
      db.donation.findMany({ where: { organizationId: orgId, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 100, include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } }, fund: { select: { id: true, name: true } } } }),
      db.tithe.findMany({ where: { organizationId: orgId, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 100, include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } } } }),
    ])
    return { donations, tithes, counts: { donations: donations.length, tithes: tithes.length, total: donations.length + tithes.length } }
  },
}
