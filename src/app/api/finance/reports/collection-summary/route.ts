// ChurchOS — Collection Summary Report
// GET /api/finance/reports/collection-summary?fromDate=&toDate=
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const fromDate = sp.get('fromDate') ? new Date(sp.get('fromDate')!) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const toDate = sp.get('toDate') ? new Date(sp.get('toDate')!) : new Date()

  const sessions = await db.collectionSession.findMany({
    where: {
      organizationId: ctx.organizationId,
      sessionDate: { gte: fromDate, lte: toDate },
    },
    orderBy: { sessionDate: 'desc' },
    include: { countSheets: { include: { lines: true } } },
  })

  const summary = sessions.map((s) => {
    const byCategory: Record<string, number> = {}
    for (const cs of s.countSheets) {
      for (const line of cs.lines) {
        byCategory[line.category] = (byCategory[line.category] ?? 0) + line.amount
      }
    }
    return {
      id: s.id,
      sessionDate: s.sessionDate,
      status: s.status,
      totalAmount: s.totalAmount,
      counters: s.counters,
      categories: byCategory,
      countSheetCount: s.countSheets.length,
    }
  })

  const grandTotal = summary.reduce((s, r) => s + r.totalAmount, 0)

  return NextResponse.json({
    period: { fromDate, toDate },
    sessions: summary,
    grandTotal,
    sessionCount: summary.length,
  })
})
