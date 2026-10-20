// ChurchOS — Donations API
// GET  /api/finance/donations — list w/ filters (fund, method, date range, search, pagination)
// POST /api/finance/donations — create (audit finance.donation.create)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_METHODS = ['cash', 'transfer', 'card', 'online'] as const
const VALID_STATUSES = ['pending', 'confirmed', 'failed', 'refunded'] as const

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  if (ctx.role === 'member') {
    throw new ForbiddenError('Personal giving statements are available on request from the finance office.')
  }
  const { organizationId } = ctx
  const sp = req.nextUrl.searchParams
  const fundId = sp.get('fundId') ?? ''
  const method = sp.get('method') ?? ''
  const status = sp.get('status') ?? ''
  const fromStr = sp.get('from') ?? ''
  const toStr = sp.get('to') ?? ''
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '20', 10) || 20))

  const where: any = { organizationId }
  if (fundId) where.fundId = fundId
  if (method && VALID_METHODS.includes(method as (typeof VALID_METHODS)[number])) {
    where.method = method
  }
  if (status && VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    where.status = status
  }
  const dateRange: { gte?: Date; lte?: Date } = {}
  if (fromStr) {
    const d = new Date(fromStr)
    if (!isNaN(d.getTime())) dateRange.gte = d
  }
  if (toStr) {
    const d = new Date(toStr)
    if (!isNaN(d.getTime())) {
      // include the whole end day
      d.setHours(23, 59, 59, 999)
      dateRange.lte = d
    }
  }
  if (Object.keys(dateRange).length) where.donatedAt = dateRange
  if (q) {
    where.OR = [
      { donorName: { contains: q } },
      { reference: { contains: q } },
      { member: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }] } },
    ]
  }

  const [items, total, sumAgg] = await Promise.all([
    db.donation.findMany({
      where,
      orderBy: { donatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        fund: { select: { id: true, name: true, code: true } },
        member: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    db.donation.count({ where }),
    db.donation.aggregate({ where, _sum: { amount: true } }),
  ])

  return NextResponse.json({
    items: items.map((d) => ({
      id: d.id,
      donorName: d.donorName,
      memberId: d.memberId,
      member: d.member
        ? { id: d.member.id, name: `${d.member.firstName} ${d.member.lastName}`.trim() }
        : null,
      fundId: d.fundId,
      fund: d.fund,
      amount: d.amount,
      currency: d.currency,
      method: d.method,
      reference: d.reference,
      status: d.status,
      donatedAt: d.donatedAt,
      createdAt: d.createdAt,
    })),
    total,
    page,
    pageSize,
    sum: sumAgg._sum.amount ?? 0,
  })
})

interface CreateBody {
  donorName?: string | null
  memberId?: string | null
  fundId?: string | null
  amount?: number
  method?: string
  reference?: string | null
  status?: string
  donatedAt?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }
  // donorName OR memberId required
  if (!body.memberId && (!body.donorName || !body.donorName.trim())) {
    return NextResponse.json({ error: 'donorName or memberId is required' }, { status: 400 })
  }
  const method =
    body.method && VALID_METHODS.includes(body.method as (typeof VALID_METHODS)[number])
      ? body.method
      : 'cash'
  const status =
    body.status && VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])
      ? body.status
      : 'confirmed'

  // Validate fund + member belong to org
  let fund: { id: string } | null = null
  if (body.fundId) {
    fund = await db.fund.findFirst({
      where: { id: body.fundId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!fund) return NextResponse.json({ error: 'Invalid fund' }, { status: 400 })
  }
  let memberId: string | null = null
  if (body.memberId) {
    const m = await db.member.findFirst({
      where: { id: body.memberId, organizationId: ctx.organizationId },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!m) return NextResponse.json({ error: 'Invalid member' }, { status: 400 })
    memberId = m.id
    if (!body.donorName?.trim()) {
      body.donorName = `${m.firstName} ${m.lastName}`.trim()
    }
  }

  const donatedAt = body.donatedAt ? new Date(body.donatedAt) : new Date()
  if (isNaN(donatedAt.getTime())) {
    return NextResponse.json({ error: 'Invalid donatedAt date' }, { status: 400 })
  }

  const created = await db.$transaction(async (tx) => {
    const donation = await tx.donation.create({
      data: {
        organizationId: ctx.organizationId,
        fundId: fund?.id ?? null,
        memberId,
        donorName: body.donorName?.trim() || null,
        amount: body.amount,
        currency: 'NGN',
        method,
        reference: body.reference?.trim() || null,
        status,
        donatedAt,
      },
      include: { fund: { select: { id: true, name: true } } },
    })
    // Update fund balance for confirmed donations
    if (status === 'confirmed' && fund) {
      await tx.fund.update({
        where: { id: fund.id },
        data: { balance: { increment: body.amount } },
      })
    }
    return donation
  })

  await audit(ctx, 'finance.donation.create', 'donation', created.id, {
    donorName: created.donorName,
    memberId,
    fundId: created.fundId,
    amount: created.amount,
    method: created.method,
    status: created.status,
  })

  return NextResponse.json(created, { status: 201 })
})
