// ChurchOS — Expense Register Report
// GET /api/finance/reports/expense-register?fromDate=&toDate=&status=
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const fromDate = sp.get('fromDate') ? new Date(sp.get('fromDate')!) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const toDate = sp.get('toDate') ? new Date(sp.get('toDate')!) : new Date()
  const status = sp.get('status') ?? ''

  const where: any = {
    organizationId: ctx.organizationId,
    createdAt: { gte: fromDate, lte: toDate },
  }
  if (status) where.status = status

  const requests = await db.expenseRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const totalApproved = requests.filter((r) => ['approved', 'paid', 'reconciled'].includes(r.status)).reduce((s, r) => s + (r.approvedAmount ?? r.amount), 0)
  const totalPaid = requests.filter((r) => ['paid', 'reconciled'].includes(r.status)).reduce((s, r) => s + (r.approvedAmount ?? r.amount), 0)
  const pendingCount = requests.filter((r) => ['submitted', 'pending_approval', 'finance_review'].includes(r.status)).length

  return NextResponse.json({
    period: { fromDate, toDate },
    requests,
    totalApproved,
    totalPaid,
    pendingCount,
    requestCount: requests.length,
  })
})
