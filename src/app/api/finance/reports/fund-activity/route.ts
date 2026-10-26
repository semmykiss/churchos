// ChurchOS — Fund Activity Report
// GET /api/finance/reports/fund-activity?fundId=&fromDate=&toDate=
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

function round(n: number): number { return Math.round(n * 100) / 100 }

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const fundId = sp.get('fundId') ?? ''
  const fromDate = sp.get('fromDate') ? new Date(sp.get('fromDate')!) : undefined
  const toDate = sp.get('toDate') ? new Date(sp.get('toDate')!) : undefined

  const funds = await db.fund.findMany({
    where: { organizationId: ctx.organizationId, ...(fundId ? { id: fundId } : {}) },
    orderBy: { name: 'asc' },
  })

  const result: {
    fund: { id: string; name: string; code: string | null; balance: number }
    contributions: number
    expenditure: number
    netActivity: number
    availableBalance: number
  }[] = []
  for (const fund of funds) {
    const where: any = {
      organizationId: ctx.organizationId,
      fundId: fund.id,
      journalEntry: { status: 'posted' },
    }
    if (fromDate || toDate) {
      where.journalEntry = {
        status: 'posted',
        transactionDate: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) },
      }
    }
    const entries = await db.ledgerEntry.findMany({
      where,
      select: { debit: true, credit: true },
    })
    const contributions = round(entries.reduce((s, e) => s + e.credit - e.debit, 0))
    const expenditure = round(entries.reduce((s, e) => s + e.debit - e.credit, 0))
    const netActivity = round(contributions - expenditure)
    result.push({
      fund: { id: fund.id, name: fund.name, code: fund.code, balance: fund.balance },
      contributions,
      expenditure,
      netActivity,
      availableBalance: round(fund.balance + netActivity),
    })
  }

  return NextResponse.json({ funds: result })
})
