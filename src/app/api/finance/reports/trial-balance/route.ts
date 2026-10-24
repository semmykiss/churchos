// ChurchOS — Trial Balance report
// GET /api/finance/reports/trial-balance?fromDate=&toDate=
import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission, apiHandler } from '@/lib/api'
import { trialBalance } from '@/lib/finance/accounting'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const fromDate = sp.get('fromDate') ? new Date(sp.get('fromDate')!) : undefined
  const toDate = sp.get('toDate') ? new Date(sp.get('toDate')!) : undefined
  const result = await trialBalance(ctx.organizationId, { fromDate, toDate })
  return NextResponse.json(result)
})
