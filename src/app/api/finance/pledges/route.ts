// ChurchOS — Pledges API
// GET   /api/finance/pledges    — list (finance:view)
// POST  /api/finance/pledges    — create (finance:create)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const where: any = { organizationId: ctx.organizationId }
  if (status) where.status = status
  const pledges = await db.pledge.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ pledges })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'create')
  const body = await req.json().catch(() => ({}))
  const { memberId, donorName, fundId, pledgedAmount, currency, dueDate, notes } = body
  if (!pledgedAmount) return NextResponse.json({ error: 'pledgedAmount required' }, { status: 400 })
  const year = new Date().getFullYear()
  const count = await db.pledge.count({
    where: { organizationId: ctx.organizationId, pledgeNumber: { startsWith: `PLG-${year}-` } },
  })
  const pledgeNumber = `PLG-${year}-${String(count + 1).padStart(5, '0')}`
  const pledge = await db.pledge.create({
    data: {
      organizationId: ctx.organizationId,
      pledgeNumber,
      memberId: memberId ?? null,
      donorName: donorName ?? null,
      fundId: fundId ?? null,
      pledgedAmount: Number(pledgedAmount),
      currency: currency ?? 'NGN',
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes ?? null,
      status: 'open',
    },
  })
  await audit(ctx, 'finance.pledge.create', 'pledge', pledge.id, { pledgeNumber, pledgedAmount })
  return NextResponse.json(pledge, { status: 201 })
})
