// ChurchOS — Finance overview API
// GET /api/finance — overview:
//   - Staff: funds w/ balances, last-6-months income/expense, recent donations+expenses,
//     pending expense count, top donors.
//   - Member: PERSONAL view (no org-wide totals) — own donations + own tithes summary.
// Permission: can(role,'finance','view'). Member role no longer 403s.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler, type AuthContext } from '@/lib/api'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader',
])

async function resolveSelfMemberId(ctx: AuthContext): Promise<string | null> {
  if (ctx.memberId) {
    const ok = await db.member.findFirst({
      where: { id: ctx.memberId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    return ok?.id ?? null
  }
  // Fallback: resolve via the User.memberProfile relation.
  const m = await db.member.findFirst({
    where: { account: { id: ctx.user.id }, organizationId: ctx.organizationId },
    select: { id: true },
  })
  return m?.id ?? null
}

function last6MonthRanges(now: Date): { key: string; label: string; gte: Date; lt: Date }[] {
  const out: { key: string; label: string; gte: Date; lt: Date }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const label = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(d)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ key, label, gte: d, lt: end })
  }
  return out
}

// ---- Member personal view ----
async function buildPersonalView(ctx: AuthContext) {
  const memberId = await resolveSelfMemberId(ctx)
  if (!memberId) {
    return {
      isPersonalView: true,
      myDonations: { total: 0, count: 0, byFund: [], last6months: [] },
      myTithes: { total: 0, count: 0, last6months: [] },
    }
  }
  const now = new Date()
  const ranges = last6MonthRanges(now)

  const [donAgg, titheAgg, donationByFundRaw, donationMonthly, titheMonthly] = await Promise.all([
    db.donation.aggregate({
      where: { memberId, status: 'confirmed' },
      _sum: { amount: true },
      _count: true,
    }),
    db.tithe.aggregate({
      where: { memberId, status: 'confirmed' },
      _sum: { amount: true },
      _count: true,
    }),
    db.donation.groupBy({
      by: ['fundId'],
      where: { memberId, status: 'confirmed' },
      _sum: { amount: true },
      _count: true,
    }),
    Promise.all(
      ranges.map((r) =>
        db.donation.aggregate({
          where: { memberId, status: 'confirmed', donatedAt: { gte: r.gte, lt: r.lt } },
          _sum: { amount: true },
          _count: true,
        }).then((a) => ({ key: r.key, label: r.label, amount: a._sum.amount ?? 0, count: a._count })),
      ),
    ),
    Promise.all(
      ranges.map((r) =>
        db.tithe.aggregate({
          where: {
            memberId,
            status: 'confirmed',
            titheMonth: { gte: r.gte, lt: r.lt },
          },
          _sum: { amount: true },
          _count: true,
        }).then((a) => ({ key: r.key, label: r.label, amount: a._sum.amount ?? 0, count: a._count })),
      ),
    ),
  ])

  // Resolve fund names for byFund.
  const fundIds = donationByFundRaw.map((d) => d.fundId).filter(Boolean) as string[]
  const funds = fundIds.length
    ? await db.fund.findMany({ where: { id: { in: fundIds } }, select: { id: true, name: true } })
    : []
  const fundMap = new Map(funds.map((f) => [f.id, f.name]))
  const byFund = donationByFundRaw.map((d) => ({
    fundId: d.fundId,
    fundName: (d.fundId && fundMap.get(d.fundId)) || 'Unspecified',
    total: d._sum.amount ?? 0,
    count: d._count,
  }))

  return {
    isPersonalView: true,
    myDonations: {
      total: donAgg._sum.amount ?? 0,
      count: donAgg._count,
      byFund,
      last6months: donationMonthly,
    },
    myTithes: {
      total: titheAgg._sum.amount ?? 0,
      count: titheAgg._count,
      last6months: titheMonthly,
    },
  }
}

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('finance', 'view')

  // Member role gets a PERSONAL view — no org-wide totals.
  if (!STAFF_ROLES.has(ctx.role) && !(ctx.user as any).isPartnerAdmin) {
    const personal = await buildPersonalView(ctx)
    return NextResponse.json({ role: ctx.role, ...personal })
  }

  const { organizationId } = ctx
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [income, expenses, pendingExpenses, funds] = await Promise.all([
    db.donation.aggregate({
      where: { organizationId, status: 'confirmed', donatedAt: { gte: startOfMonth } },
      _sum: { amount: true },
      _count: true,
    }),
    db.expense.aggregate({
      where: {
        organizationId,
        status: { in: ['approved', 'paid'] },
        incurredAt: { gte: startOfMonth },
      },
      _sum: { amount: true },
      _count: true,
    }),
    db.expense.count({ where: { organizationId, status: 'pending' } }),
    db.fund.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, balance: true, description: true },
    }),
  ])

  // Last 6 months income/expense trend
  const months: { label: string; key: string; income: number; expense: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const label = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(d)
    months.push({
      label,
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      income: 0,
      expense: 0,
    })
    // capture range
    ;(months[months.length - 1] as any)._range = { gte: d, lt: end }
  }

  const monthRanges = months.map((m) => (m as any)._range as { gte: Date; lt: Date })
  const monthAggs = await Promise.all(
    monthRanges.map((r, idx) =>
      Promise.all([
        db.donation.aggregate({
          where: { organizationId, status: 'confirmed', donatedAt: { gte: r.gte, lt: r.lt } },
          _sum: { amount: true },
        }),
        db.expense.aggregate({
          where: {
            organizationId,
            status: { in: ['approved', 'paid'] },
            incurredAt: { gte: r.gte, lt: r.lt },
          },
          _sum: { amount: true },
        }),
      ]).then(([inc, exp]) => {
        months[idx].income = inc._sum.amount ?? 0
        months[idx].expense = exp._sum.amount ?? 0
        delete (months[idx] as any)._range
      }),
    ),
  )
  await Promise.all(monthAggs)

  // Recent transactions (last 10 mixed donations + expenses)
  const [recentDonations, recentExpenses] = await Promise.all([
    db.donation.findMany({
      where: { organizationId },
      orderBy: { donatedAt: 'desc' },
      take: 10,
      include: {
        fund: { select: { id: true, name: true } },
        member: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    db.expense.findMany({
      where: { organizationId },
      orderBy: { incurredAt: 'desc' },
      take: 10,
      include: { fund: { select: { id: true, name: true } } },
    }),
  ])

  const recent = [
    ...recentDonations.map((d) => ({
      id: d.id,
      kind: 'donation' as const,
      date: d.donatedAt,
      description: d.donorName || d.member
        ? `${d.member ? `${d.member.firstName} ${d.member.lastName}`.trim() : d.donorName}`
        : 'Anonymous',
      fund: d.fund?.name ?? 'Unspecified',
      amount: d.amount,
      status: d.status,
      method: d.method,
    })),
    ...recentExpenses.map((e) => ({
      id: e.id,
      kind: 'expense' as const,
      date: e.incurredAt,
      description: e.description,
      fund: e.fund?.name ?? 'General',
      amount: -e.amount, // negative for display
      status: e.status,
      method: e.method,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10)

  // Top donors (last 90 days, confirmed only)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000)
  const topDonorsRaw = await db.donation.findMany({
    where: { organizationId, status: 'confirmed', donatedAt: { gte: ninetyDaysAgo } },
    select: { donorName: true, memberId: true, amount: true },
    take: 500,
  })
  const donorMap = new Map<string, { name: string; total: number; count: number }>()
  for (const d of topDonorsRaw) {
    const key = d.memberId ?? d.donorName ?? 'anonymous'
    const name = d.donorName ?? 'Anonymous'
    const entry = donorMap.get(key) ?? { name, total: 0, count: 0 }
    entry.total += d.amount
    entry.count += 1
    donorMap.set(key, entry)
  }
  const topDonors = Array.from(donorMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  return NextResponse.json({
    role: ctx.role,
    incomeThisMonth: income._sum.amount ?? 0,
    incomeCountThisMonth: income._count,
    expensesThisMonth: expenses._sum.amount ?? 0,
    expenseCountThisMonth: expenses._count,
    netThisMonth: (income._sum.amount ?? 0) - (expenses._sum.amount ?? 0),
    pendingApprovals: pendingExpenses,
    funds: funds.map((f) => ({
      id: f.id,
      name: f.name,
      code: f.code,
      balance: f.balance,
      description: f.description,
    })),
    trend: months,
    recent,
    topDonors,
  })
})
