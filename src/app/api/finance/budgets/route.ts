// ChurchOS — Budgets API
// GET  /api/finance/budgets — list budgets per fund per fiscal year
// POST /api/finance/budgets — create budget (finance:create)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  if (ctx.role === 'member') {
    throw new ForbiddenError('Personal giving statements are available on request from the finance office.')
  }
  const sp = req.nextUrl.searchParams
  const fundId = sp.get('fundId') ?? ''
  const fiscalYear = sp.get('fiscalYear')

  const where: any = { organizationId: ctx.organizationId }
  if (fundId) where.fundId = fundId
  if (fiscalYear) {
    const y = parseInt(fiscalYear, 10)
    if (!isNaN(y)) where.fiscalYear = y
  }

  const budgets = await db.budget.findMany({
    where,
    orderBy: [{ fiscalYear: 'desc' }, { period: 'asc' }],
    include: { fund: { select: { id: true, name: true, code: true } } },
  })

  // For each budget, compute actual income (donations) + expenses for the fiscal year
  const yearMap = new Map<number, { income: number; expense: number }>()
  for (const b of budgets) {
    if (!yearMap.has(b.fiscalYear)) {
      const start = new Date(b.fiscalYear, 0, 1)
      const end = new Date(b.fiscalYear + 1, 0, 1)
      const [inc, exp] = await Promise.all([
        db.donation.aggregate({
          where: {
            organizationId: ctx.organizationId,
            status: 'confirmed',
            donatedAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        }),
        db.expense.aggregate({
          where: {
            organizationId: ctx.organizationId,
            status: { in: ['approved', 'paid'] },
            incurredAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        }),
      ])
      yearMap.set(b.fiscalYear, {
        income: inc._sum.amount ?? 0,
        expense: exp._sum.amount ?? 0,
      })
    }
  }

  return NextResponse.json({
    items: budgets.map((b) => {
      const actuals = yearMap.get(b.fiscalYear)!
      return {
        id: b.id,
        fundId: b.fundId,
        fund: b.fund,
        fiscalYear: b.fiscalYear,
        period: b.period,
        amount: b.amount,
        actualIncome: actuals.income,
        actualExpense: actuals.expense,
        utilization: b.amount > 0 ? Math.min(100, Math.round((actuals.expense / b.amount) * 100)) : 0,
        createdAt: b.createdAt,
      }
    }),
  })
})

interface CreateBody {
  fundId?: string | null
  fiscalYear?: number
  period?: string
  amount?: number
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (typeof body.fiscalYear !== 'number' || body.fiscalYear < 2000 || body.fiscalYear > 2100) {
    return NextResponse.json({ error: 'fiscalYear must be a valid year' }, { status: 400 })
  }
  if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount < 0) {
    return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 })
  }
  if (body.fundId) {
    const fund = await db.fund.findFirst({
      where: { id: body.fundId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!fund) return NextResponse.json({ error: 'Invalid fund' }, { status: 400 })
  }
  const period =
    body.period && typeof body.period === 'string' && body.period.trim()
      ? body.period.trim()
      : 'annual'

  const created = await db.budget.create({
    data: {
      organizationId: ctx.organizationId,
      fundId: body.fundId || null,
      fiscalYear: body.fiscalYear,
      period,
      amount: body.amount,
    },
    include: { fund: { select: { id: true, name: true } } },
  })

  await audit(ctx, 'finance.budget.create', 'budget', created.id, {
    fiscalYear: created.fiscalYear,
    period: created.period,
    amount: created.amount,
    fundId: created.fundId,
  })

  return NextResponse.json(created, { status: 201 })
})
