// ChurchOS — Budget by-id API (edit + delete)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'update')
  if (ctx.role === 'member') throw new ForbiddenError('Access denied.')
  const { id } = await params
  const budget = await db.budget.findFirst({ where: { id, organizationId: ctx.organizationId } })
  if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof body.fundId === 'string' && body.fundId) data.fundId = body.fundId
  if (typeof body.fiscalYear === 'number') data.fiscalYear = body.fiscalYear
  if (typeof body.period === 'string') data.period = body.period
  if (typeof body.amount === 'number') data.amount = body.amount
  const updated = await db.budget.update({ where: { id }, data })
  await audit(ctx, 'finance.budget.update', 'budget', id, { changes: Object.keys(data) })
  return NextResponse.json({ ok: true, budget: updated })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'manage')
  const { id } = await params
  const budget = await db.budget.findFirst({ where: { id, organizationId: ctx.organizationId } })
  if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
  await db.budget.delete({ where: { id } })
  await audit(ctx, 'finance.budget.delete', 'budget', id, { fundId: budget.fundId, fiscalYear: budget.fiscalYear })
  return NextResponse.json({ ok: true })
})
