// ChurchOS — Expense Requests API (full workflow)
// GET   /api/finance/expense-requests               — list requests (finance:view)
// POST  /api/finance/expense-requests               — create request (finance:create)
//
// Workflow: draft → submitted → finance_review → pending_approval → approved/rejected/returned
//           → payment_prepared → payment_authorized → paid → reconciled
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { postJournal } from '@/lib/finance/accounting'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))
  const where: any = { organizationId: ctx.organizationId }
  if (status) where.status = status
  const requests = await db.expenseRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ requests })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'create')
  const body = await req.json().catch(() => ({}))
  const { departmentId, branchId, fundId, category, purpose, description, amount, currency, requestedPaymentDate, payee, payeeAccount } = body
  if (!purpose || !amount || !category) {
    return NextResponse.json({ error: 'purpose, amount, category are required.' }, { status: 400 })
  }
  // Generate a unique request number
  const year = new Date().getFullYear()
  const count = await db.expenseRequest.count({
    where: { organizationId: ctx.organizationId, requestNumber: { startsWith: `EXP-${year}-` } },
  })
  const requestNumber = `EXP-${year}-${String(count + 1).padStart(5, '0')}`

  const request = await db.expenseRequest.create({
    data: {
      organizationId: ctx.organizationId,
      requestNumber,
      departmentId: departmentId ?? null,
      branchId: branchId ?? null,
      fundId: fundId ?? null,
      category: String(category),
      purpose: String(purpose),
      description: description ?? null,
      amount: Number(amount),
      currency: currency ?? 'NGN',
      requestedPaymentDate: requestedPaymentDate ? new Date(requestedPaymentDate) : null,
      payee: payee ?? null,
      payeeAccount: payeeAccount ?? null,
      status: 'draft',
      requestedById: ctx.user.id,
      requestedByName: ctx.user.name,
    },
  })
  await audit(ctx, 'finance.expense.create', 'expenseRequest', request.id, { requestNumber, amount })
  return NextResponse.json(request, { status: 201 })
})
