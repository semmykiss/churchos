// ChurchOS — Funds API
// GET  /api/finance/funds — list funds
// POST /api/finance/funds — create fund (manage)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('finance', 'view')
  if (ctx.role === 'member') {
    throw new ForbiddenError('Personal giving statements are available on request from the finance office.')
  }
  const funds = await db.fund.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { donations: true, expenses: true } },
    },
  })
  return NextResponse.json({
    items: funds.map((f) => ({
      id: f.id,
      name: f.name,
      code: f.code,
      description: f.description,
      balance: f.balance,
      createdAt: f.createdAt,
      donationCount: f._count.donations,
      expenseCount: f._count.expenses,
    })),
  })
})

interface CreateBody {
  name?: string
  code?: string | null
  description?: string | null
  balance?: number
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'manage')
  const body = (await req.json().catch(() => ({}))) as CreateBody
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (body.code && typeof body.code !== 'string') {
    return NextResponse.json({ error: 'code must be a string' }, { status: 400 })
  }
  const openingBalance =
    typeof body.balance === 'number' && !isNaN(body.balance) ? body.balance : 0

  const fund = await db.fund.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name.trim(),
      code: body.code?.trim() || null,
      description: body.description?.trim() || null,
      balance: openingBalance,
    },
  })

  await audit(ctx, 'finance.fund.create', 'fund', fund.id, {
    name: fund.name,
    code: fund.code,
    openingBalance,
  })

  return NextResponse.json(fund, { status: 201 })
})
