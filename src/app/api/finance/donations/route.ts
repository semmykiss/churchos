// ChurchOS — Donations API
import { rateLimit } from '@/lib/rate-limiter'
// GET  /api/finance/donations — list w/ filters (fund, method, date range, search, pagination)
// POST /api/finance/donations — create (audit finance.donation.create)
//
// Member role:
//   - GET: filtered to memberId === ctx.memberId (their own donations only).
//   - POST: allowed (status forced to 'pending' for staff approval, memberId = own).
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_METHODS = ['cash', 'transfer', 'card', 'online'] as const
const VALID_STATUSES = ['pending', 'confirmed', 'failed', 'refunded'] as const

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader',
])

async function resolveSelfMemberId(ctx: AuthContext): Promise<string | null> {
  if (ctx.memberId) {
    const ok = await db.member.findFirst({
      where: { id: ctx.memberId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    return ok?.id ?? null
  }
  const m = await db.member.findFirst({
    where: { account: { id: ctx.user.id }, organizationId: ctx.organizationId },
    select: { id: true },
  })
  return m?.id ?? null
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  if (!rateLimit(ctx.user.id, 'donations', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
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

  // Member role: only their own donations.
  const isStaff = STAFF_ROLES.has(ctx.role) || (ctx.user as any).isPartnerAdmin
  if (!isStaff) {
    const selfId = await resolveSelfMemberId(ctx)
    if (!selfId) {
      return NextResponse.json({ items: [], total: 0, page, pageSize, sum: 0 })
    }
    where.memberId = selfId
  } else {
    // Staff may optionally filter by memberId.
    const memberIdParam = sp.get('memberId')
    if (memberIdParam) where.memberId = memberIdParam
  }

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
    isPersonalView: !isStaff,
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
  const ctx = await requirePermission('finance', 'view')
  if (!rateLimit(ctx.user.id, 'donations', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  const isStaff = STAFF_ROLES.has(ctx.role) || (ctx.user as any).isPartnerAdmin

  // Member: force memberId = own, status = 'pending' (awaiting staff approval).
  // Staff: must provide memberId OR donorName; status may be set explicitly.
  let memberId: string | null = null
  let donorName = body.donorName?.trim() || null
  let status: string

  if (!isStaff) {
    const selfId = await resolveSelfMemberId(ctx)
    if (!selfId) {
      return NextResponse.json(
        { error: 'Your account is not linked to a member profile.' },
        { status: 400 },
      )
    }
    memberId = selfId
    // Look up the member's name for donorName if not provided.
    if (!donorName) {
      const m = await db.member.findUnique({
        where: { id: selfId },
        select: { firstName: true, lastName: true },
      })
      donorName = m ? `${m.firstName} ${m.lastName}`.trim() : null
    }
    // Members can ONLY submit pending donations (staff must approve).
    status = 'pending'
  } else {
    // Staff path — validate as before.
    if (!body.memberId && !donorName) {
      return NextResponse.json({ error: 'donorName or memberId is required' }, { status: 400 })
    }
    status =
      body.status && VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])
        ? body.status!
        : 'confirmed'
  }

  const method =
    body.method && VALID_METHODS.includes(body.method as (typeof VALID_METHODS)[number])
      ? body.method
      : 'cash'

  // Validate fund + member belong to org
  let fund: { id: string } | null = null
  if (body.fundId) {
    fund = await db.fund.findFirst({
      where: { id: body.fundId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!fund) return NextResponse.json({ error: 'Invalid fund' }, { status: 400 })
  }
  if (isStaff && body.memberId) {
    const m = await db.member.findFirst({
      where: { id: body.memberId, organizationId: ctx.organizationId },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!m) return NextResponse.json({ error: 'Invalid member' }, { status: 400 })
    memberId = m.id
    if (!donorName) donorName = `${m.firstName} ${m.lastName}`.trim()
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
        donorName,
        amount: body.amount as number,
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
        data: { balance: { increment: body.amount as number } },
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
    selfSubmitted: !isStaff,
  })

  return NextResponse.json(created, { status: 201 })
})
