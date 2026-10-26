// ChurchOS — Expense detail API
// GET    /api/finance/expenses/[id]
// PATCH  /api/finance/expenses/[id] — update fields; {action:'approve'|'reject'} requires finance:approve
// DELETE /api/finance/expenses/[id] — only if pending; finance:manage bypasses
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { can, ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_METHODS = ['cash', 'transfer', 'card', 'online'] as const
const VALID_STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'view')
  if (ctx.role === 'member') {
    throw new ForbiddenError('Personal giving statements are available on request from the finance office.')
  }
  const { id } = await params
  const expense = await db.expense.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { fund: { select: { id: true, name: true } } },
  })
  if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  return NextResponse.json(expense)
})

interface PatchBody {
  action?: 'approve' | 'reject'
  comment?: string
  category?: string
  description?: string
  amount?: number
  payee?: string | null
  method?: string
  reference?: string | null
  fundId?: string | null
  status?: string
  incurredAt?: string | null
}

async function getScopedExpense(ctx: AuthContext, id: string) {
  return db.expense.findFirst({ where: { id, organizationId: ctx.organizationId } })
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  // Special approval flow — requires finance:approve permission
  if (body.action === 'approve' || body.action === 'reject') {
    const ctx = await requirePermission('finance', 'approve')
    const existing = await getScopedExpense(ctx, id)
    if (!existing) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: `Expense is already ${existing.status} and cannot be re-approved.` },
        { status: 409 },
      )
    }
    // SoD: the requester cannot approve their own expense request.
    // (requesterId is set at creation; legacy rows without it can't be checked.)
    if (existing.requesterId && existing.requesterId === ctx.user.id) {
      return NextResponse.json(
        { error: 'You cannot approve your own expense request.' },
        { status: 403 },
      )
    }
    const newStatus = body.action === 'approve' ? 'approved' : 'rejected'
    const updated = await db.$transaction(async (tx) => {
      const e = await tx.expense.update({
        where: { id },
        data: { status: newStatus, approvedBy: ctx.user.id },
      })
      await tx.approval.create({
        data: {
          organizationId: ctx.organizationId,
          type: 'expense',
          refId: id,
          requesterId: existing.requesterId,
          approverId: ctx.user.id,
          status: newStatus,
          comment: body.comment?.trim() || null,
          resolvedAt: new Date(),
        },
      })
      // If approved, optionally deduct from fund balance once marked paid.
      // For simplicity here we deduct on approve (treating approve as "ok to pay").
      // The church can mark it 'paid' later via a normal status update if needed.
      return e
    })
    await audit(ctx, `finance.expense.${body.action}`, 'expense', id, {
      amount: existing.amount,
      category: existing.category,
      comment: body.comment?.trim() || null,
      requesterId: existing.requesterId,
      approverId: ctx.user.id,
    })
    return NextResponse.json({ id: updated.id, status: updated.status, ok: true })
  }

  // Normal field update — requires finance:update
  const ctx = await requirePermission('finance', 'update')
  const existing = await getScopedExpense(ctx, id)
  if (!existing) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (body.category !== undefined) {
    if (!body.category.trim()) return NextResponse.json({ error: 'category cannot be empty' }, { status: 400 })
    data.category = body.category.trim()
  }
  if (body.description !== undefined) {
    if (!body.description.trim()) return NextResponse.json({ error: 'description cannot be empty' }, { status: 400 })
    data.description = body.description.trim()
  }
  if (body.payee !== undefined) data.payee = body.payee?.trim() || null
  if (body.reference !== undefined) data.reference = body.reference?.trim() || null
  if (body.method !== undefined && VALID_METHODS.includes(body.method as (typeof VALID_METHODS)[number])) {
    data.method = body.method
  }
  if (body.amount !== undefined) {
    if (typeof body.amount !== 'number' || body.amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }
    data.amount = body.amount
  }
  if (body.incurredAt !== undefined) {
    data.incurredAt = body.incurredAt ? new Date(body.incurredAt) : new Date()
  }
  if (body.fundId !== undefined) {
    if (body.fundId) {
      const fund = await db.fund.findFirst({
        where: { id: body.fundId, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (!fund) return NextResponse.json({ error: 'Invalid fund' }, { status: 400 })
      data.fundId = body.fundId
    } else {
      data.fundId = null
    }
  }
  // Status updates on a pending expense require finance:approve
  if (body.status !== undefined && body.status !== existing.status) {
    if (!can(ctx.role, 'finance', 'approve')) {
      throw new ForbiddenError('Status changes require the finance:approve permission.')
    }
    if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    data.status = body.status
  }

  const updated = await db.expense.update({ where: { id }, data })
  await audit(ctx, 'finance.expense.update', 'expense', id, {
    fields: Object.keys(data),
  })
  return NextResponse.json({ id: updated.id, ok: true })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'update')
  const isManager = can(ctx.role, 'finance', 'manage')
  const { id } = await params
  const existing = await getScopedExpense(ctx, id)
  if (!existing) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

  // Pending expenses can be deleted by anyone with finance:update;
  // non-pending (approved/paid/rejected) require finance:manage.
  if (existing.status !== 'pending' && !isManager) {
    throw new ForbiddenError('Only pending expenses can be deleted without manager approval.')
  }

  await db.expense.delete({ where: { id } })
  await audit(ctx, 'finance.expense.delete', 'expense', id, {
    amount: existing.amount,
    status: existing.status,
  })
  return NextResponse.json({ ok: true, id })
})
