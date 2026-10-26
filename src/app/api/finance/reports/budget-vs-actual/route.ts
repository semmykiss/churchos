// ChurchOS — Budget vs Actual Report
// GET /api/finance/reports/budget-vs-actual?fiscalYear=
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

function round(n: number): number { return Math.round(n * 100) / 100 }

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const fiscalYear = parseInt(sp.get('fiscalYear') ?? String(new Date().getFullYear()), 10)

  const budgets = await db.budget.findMany({
    where: { organizationId: ctx.organizationId, fiscalYear },
    include: { fund: { select: { id: true, name: true, code: true } } },
  })

  const yearStart = new Date(fiscalYear, 0, 1)
  const yearEnd = new Date(fiscalYear, 11, 31, 23, 59, 59)

  const result: {
    budget: { id: string; fiscalYear: number; period: string; amount: number; fund: { id: string; name: string; code: string | null } | null }
    actualIncome: number
    actualExpenditure: number
    incomeVariance: number
    expenditureVariance: number
    remaining: number
  }[] = []
  for (const budget of budgets) {
    const where: any = {
      organizationId: ctx.organizationId,
      journalEntry: { status: 'posted', transactionDate: { gte: yearStart, lte: yearEnd } },
    }
    if (budget.fundId) where.fundId = budget.fundId
    const entries = await db.ledgerEntry.findMany({
      where,
      select: { debit: true, credit: true, account: { select: { accountType: true } } },
    })
    const actualIncome = round(entries.filter((e) => e.account.accountType === 'income').reduce((s, e) => s + e.credit - e.debit, 0))
    const actualExpenditure = round(entries.filter((e) => e.account.accountType === 'expenditure').reduce((s, e) => s + e.debit - e.credit, 0))
    result.push({
      budget: { id: budget.id, fiscalYear: budget.fiscalYear, period: budget.period, amount: budget.amount, fund: budget.fund },
      actualIncome,
      actualExpenditure,
      incomeVariance: round(actualIncome - budget.amount),
      expenditureVariance: round(actualExpenditure - budget.amount),
      remaining: round(budget.amount - actualExpenditure),
    })
  }

  return NextResponse.json({ fiscalYear, budgets: result })
})
