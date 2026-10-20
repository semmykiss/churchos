// ChurchOS — Finance overview API
// GET /api/finance — overview: funds w/ balances, last-6-months income/expense,
//                    recent donations+expenses, pending expense count.
// Permission: can(role,'finance','view'). Member role is restricted (see below).
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('finance', 'view')
  // Member role has finance:view in the matrix, but should NOT see aggregate
  // church finance totals. They get a personal giving statement on request.
  if (ctx.role === 'member') {
    throw new ForbiddenError(
      'Personal giving statements are available on request from the finance office.',
    )
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
