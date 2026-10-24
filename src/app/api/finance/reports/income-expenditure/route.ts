// ChurchOS — Income & Expenditure Statement
// GET /api/finance/reports/income-expenditure?fromDate=&toDate=
//
// Computes total income + total expenditure for the period from posted ledger entries.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

function round(n: number): number { return Math.round(n * 100) / 100 }

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const fromDate = sp.get('fromDate') ? new Date(sp.get('fromDate')!) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const toDate = sp.get('toDate') ? new Date(sp.get('toDate')!) : new Date()

  const entries = await db.ledgerEntry.findMany({
    where: {
      organizationId: ctx.organizationId,
      journalEntry: {
        status: 'posted',
        transactionDate: { gte: fromDate, lte: toDate },
      },
    },
    select: {
      debit: true,
      credit: true,
      account: { select: { code: true, name: true, accountType: true } },
    },
  })

  const income: Record<string, { code: string; name: string; amount: number }> = {}
  const expenditure: Record<string, { code: string; name: string; amount: number }> = {}
  let totalIncome = 0
  let totalExpenditure = 0

  for (const e of entries) {
    if (e.account.accountType === 'income') {
      // Income accounts are credited (credit increases income)
      const amount = round(e.credit - e.debit)
      if (amount === 0) continue
      if (!income[e.account.code]) income[e.account.code] = { code: e.account.code, name: e.account.name, amount: 0 }
      income[e.account.code].amount = round(income[e.account.code].amount + amount)
      totalIncome = round(totalIncome + amount)
    } else if (e.account.accountType === 'expenditure') {
      // Expenditure accounts are debited (debit increases expense)
      const amount = round(e.debit - e.credit)
      if (amount === 0) continue
      if (!expenditure[e.account.code]) expenditure[e.account.code] = { code: e.account.code, name: e.account.name, amount: 0 }
      expenditure[e.account.code].amount = round(expenditure[e.account.code].amount + amount)
      totalExpenditure = round(totalExpenditure + amount)
    }
  }

  return NextResponse.json({
    period: { fromDate, toDate },
    income: Object.values(income).sort((a, b) => a.code.localeCompare(b.code)),
    expenditure: Object.values(expenditure).sort((a, b) => a.code.localeCompare(b.code)),
    totalIncome,
    totalExpenditure,
    netSurplus: round(totalIncome - totalExpenditure),
  })
})
