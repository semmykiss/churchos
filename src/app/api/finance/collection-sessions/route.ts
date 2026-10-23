// ChurchOS — Collection Sessions API (offering collection + counting workflow)
// GET   /api/finance/collection-sessions               — list sessions (finance:view)
// POST  /api/finance/collection-sessions               — create session (finance:create — usher+)
//
// Workflow: open → counted → verified → handed_over → deposited → posted → cancelled
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))
  const where: any = { organizationId: ctx.organizationId }
  if (status) where.status = status
  const sessions = await db.collectionSession.findMany({
    where,
    orderBy: { sessionDate: 'desc' },
    take: limit,
    include: {
      countSheets: { select: { id: true, counterName: true, status: true, totalAmount: true, submittedAt: true } },
    },
  })
  return NextResponse.json({ sessions })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'create')
  const body = await req.json().catch(() => ({}))
  const { serviceId, branchId, sessionDate, counters, notes } = body
  if (!sessionDate) {
    return NextResponse.json({ error: 'sessionDate is required.' }, { status: 400 })
  }
  const session = await db.collectionSession.create({
    data: {
      organizationId: ctx.organizationId,
      serviceId: serviceId ?? null,
      branchId: branchId ?? null,
      sessionDate: new Date(sessionDate),
      counters: counters ? JSON.stringify(counters) : null,
      notes: notes ?? null,
      createdBy: ctx.user.id,
      status: 'open',
    },
  })
  await audit(ctx, 'finance.collection.create', 'collectionSession', session.id, { sessionDate })
  return NextResponse.json(session, { status: 201 })
})
