// ChurchOS — Budget Revisions API
// GET   /api/finance/budget-revisions   — list (finance:view)
// POST  /api/finance/budget-revisions   — create (finance:approve — finance committee+)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (_req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const revisions = await db.budgetRevision.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { budget: { include: { fund: { select: { name: true } } } } },
  })
  return NextResponse.json({ revisions })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'approve')
  const body = await req.json().catch(() => ({}))
  const { budgetId, revisedAmount, reason } = body
  if (!budgetId || !revisedAmount || !reason) {
    return NextResponse.json({ error: 'budgetId, revisedAmount, reason required' }, { status: 400 })
  }
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId: ctx.organizationId },
  })
  if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
  const count = await db.budgetRevision.count({ where: { budgetId } })
  const revision = await db.budgetRevision.create({
    data: {
      organizationId: ctx.organizationId,
      budgetId,
      revisionNumber: count + 1,
      revisedAmount: Number(revisedAmount),
      reason: String(reason),
      status: 'proposed',
    },
  })
  await audit(ctx, 'finance.budget.revision', 'budgetRevision', revision.id, { budgetId, revisedAmount })
  return NextResponse.json(revision, { status: 201 })
})
