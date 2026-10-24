// ChurchOS — Expense Request detail API (workflow transitions + payment + reversal)
// GET    /api/finance/expense-requests/[id]   — single request
// PATCH  /api/finance/expense-requests/[id]   — transition: submit, approve, reject, return, pay, reconcile, reverse
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'
import { postJournal } from '@/lib/finance/accounting'

export const dynamic = 'force-dynamic'

const PRIVILEGED_FINANCE_ROLES = new Set(['super_admin', 'church_admin', 'finance_officer', 'finance_committee'])

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'view')
  const { id } = await params
  const request = await db.expenseRequest.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Department heads can only see their own department's requests
  if (ctx.role === 'department_head' && request.departmentId && request.departmentId !== ctx.departmentId) {
    throw new ForbiddenError('You can only view expense requests for your own department.')
  }
  return NextResponse.json({ request })
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'update')
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { action } = body
  const request = await db.expenseRequest.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ---- SUBMIT (draft → submitted) ----
  if (action === 'submit') {
    if (request.status !== 'draft') {
      return NextResponse.json({ error: `Cannot submit a ${request.status} request.` }, { status: 400 })
    }
    await db.expenseRequest.update({ where: { id }, data: { status: 'submitted' } })
    await audit(ctx, 'finance.expense.submit', 'expenseRequest', id, {})
    return NextResponse.json({ ok: true, status: 'submitted' })
  }

  // ---- APPROVE (submitted/pending_approval → approved) ----
  if (action === 'approve') {
    if (!PRIVILEGED_FINANCE_ROLES.has(ctx.role)) {
      throw new ForbiddenError('Only finance staff can approve expense requests.')
    }
    // Segregation of duty: the requester cannot approve their own request
    if (request.requestedById === ctx.user.id) {
      throw new ForbiddenError('Segregation of duty: you cannot approve your own expense request.')
    }
    if (request.status !== 'submitted' && request.status !== 'pending_approval') {
      return NextResponse.json({ error: `Cannot approve a ${request.status} request.` }, { status: 400 })
    }
    const approvedAmount = body.approvedAmount ? Number(body.approvedAmount) : request.amount
    await db.expenseRequest.update({
      where: { id },
      data: {
        status: 'approved',
        approvedAmount,
        approvedById: ctx.user.id,
        approvedAt: new Date(),
        approvalComment: body.comment ?? null,
      },
    })
    await audit(ctx, 'finance.expense.approve', 'expenseRequest', id, { approvedAmount })
    return NextResponse.json({ ok: true, status: 'approved', approvedAmount })
  }

  // ---- REJECT (submitted/pending_approval → rejected) ----
  if (action === 'reject') {
    if (!PRIVILEGED_FINANCE_ROLES.has(ctx.role)) {
      throw new ForbiddenError('Only finance staff can reject expense requests.')
    }
    await db.expenseRequest.update({
      where: { id },
      data: { status: 'rejected', rejectionReason: body.reason ?? null, approvedById: ctx.user.id, approvedAt: new Date() },
    })
    await audit(ctx, 'finance.expense.reject', 'expenseRequest', id, { reason: body.reason })
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  // ---- RETURN (submitted/pending_approval → returned) ----
  if (action === 'return') {
    if (!PRIVILEGED_FINANCE_ROLES.has(ctx.role)) {
      throw new ForbiddenError('Only finance staff can return expense requests.')
    }
    await db.expenseRequest.update({
      where: { id },
      data: { status: 'returned', approvalComment: body.reason ?? null },
    })
    await audit(ctx, 'finance.expense.return', 'expenseRequest', id, { reason: body.reason })
    return NextResponse.json({ ok: true, status: 'returned' })
  }

  // ---- PAY (approved → paid) — posts the expense to the GL ----
  if (action === 'pay') {
    if (!PRIVILEGED_FINANCE_ROLES.has(ctx.role)) {
      throw new ForbiddenError('Only finance staff can execute payments.')
    }
    // Segregation of duty: the approver cannot also be the payer
    if (request.approvedById === ctx.user.id) {
      throw new ForbiddenError('Segregation of duty: you cannot pay a request you approved. Ask another finance officer to execute the payment.')
    }
    if (request.status !== 'approved' && request.status !== 'payment_authorized') {
      return NextResponse.json({ error: `Cannot pay a ${request.status} request.` }, { status: 400 })
    }
    const paymentMethod = body.paymentMethod ?? 'transfer'
    const paymentReference = body.paymentReference ?? null
    const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date()
    const amount = request.approvedAmount ?? request.amount

    // Map expense category to expenditure account code
    const CATEGORY_TO_ACCOUNT: Record<string, string> = {
      utilities: '5100',
      maintenance: '5200',
      salaries: '5000',
      administration: '5300',
      evangelism: '5400',
      welfare: '5500',
      youth: '5600',
      media: '5700',
      events: '5800',
      capital: '5900',
      professional_services: '5950',
    }
    const expenseAccountCode = CATEGORY_TO_ACCOUNT[request.category] ?? '5300'

    try {
      const entry = await postJournal(ctx, {
        description: `Payment: ${request.purpose} (${request.requestNumber})`,
        transactionDate: paymentDate,
        source: 'expense',
        sourceRefId: id,
        lines: [
          { accountCode: expenseAccountCode, debit: amount, credit: 0, fundId: request.fundId ?? undefined, departmentId: request.departmentId ?? undefined },
          { accountCode: '1010', debit: 0, credit: amount }, // Credit Operating Bank
        ],
      })
      await db.expenseRequest.update({
        where: { id },
        data: {
          status: 'paid',
          paymentMethod,
          paymentReference,
          paymentDate,
          paidById: ctx.user.id,
          paidByName: ctx.user.name,
          journalEntryId: entry.id,
        },
      })
      await audit(ctx, 'finance.expense.pay', 'expenseRequest', id, { journalEntryRef: entry.reference, amount })
      return NextResponse.json({ ok: true, status: 'paid', journalEntryRef: entry.reference })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // ---- RECONCILE (paid → reconciled) ----
  if (action === 'reconcile') {
    if (!PRIVILEGED_FINANCE_ROLES.has(ctx.role)) {
      throw new ForbiddenError('Only finance staff can reconcile expenses.')
    }
    if (request.status !== 'paid') {
      return NextResponse.json({ error: `Cannot reconcile a ${request.status} request.` }, { status: 400 })
    }
    await db.expenseRequest.update({
      where: { id },
      data: { status: 'reconciled', reconciledAt: new Date() },
    })
    await audit(ctx, 'finance.expense.reconcile', 'expenseRequest', id, {})
    return NextResponse.json({ ok: true, status: 'reconciled' })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
})
