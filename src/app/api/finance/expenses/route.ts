// ChurchOS — Expenses API
// GET  /api/finance/expenses — list w/ filters (status, category, date range, pagination)
// POST /api/finance/expenses — create (defaults to pending; high-value >= 100k flagged)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_METHODS = ['cash', 'transfer', 'card', 'online'] as const
const VALID_STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const
const HIGH_VALUE_THRESHOLD = 100_000

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  if (ctx.role === 'member') {
    throw new ForbiddenError('Personal giving statements are available on request from the finance office.')
  }
  const { organizationId } = ctx
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const category = sp.get('category') ?? ''
  const fromStr = sp.get('from') ?? ''
  const toStr = sp.get('to') ?? ''
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '20', 10) || 20))

  const where: any = { organizationId }
  if (status && VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    where.status = status
  }
  if (category) where.category = { contains: category }
  const dateRange: { gte?: Date; lte?: Date } = {}
  if (fromStr) {
    const d = new Date(fromStr)
    if (!isNaN(d.getTime())) dateRange.gte = d
  }
  if (toStr) {
    const d = new Date(toStr)
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999)
      dateRange.lte = d
    }
  }
  if (Object.keys(dateRange).length) where.incurredAt = dateRange
  if (q) {
    where.OR = [
      { description: { contains: q } },
      { payee: { contains: q } },
      { category: { contains: q } },
      { reference: { contains: q } },
    ]
  }

  const [items, total, sumAgg] = await Promise.all([
    db.expense.findMany({
      where,
      orderBy: { incurredAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { fund: { select: { id: true, name: true } } },
    }),
    db.expense.count({ where }),
    db.expense.aggregate({ where, _sum: { amount: true } }),
  ])

  return NextResponse.json({
    items: items.map((e) => ({
      id: e.id,
      category: e.category,
      description: e.description,
      amount: e.amount,
      payee: e.payee,
      method: e.method,
      reference: e.reference,
      status: e.status,
      approvedBy: e.approvedBy,
      fundId: e.fundId,
      fund: e.fund,
      incurredAt: e.incurredAt,
      createdAt: e.createdAt,
      needsApproval: e.status === 'pending' && e.amount >= HIGH_VALUE_THRESHOLD,
    })),
    total,
    page,
    pageSize,
    sum: sumAgg._sum.amount ?? 0,
    highValueThreshold: HIGH_VALUE_THRESHOLD,
  })
})

interface CreateBody {
  category?: string
  description?: string
  amount?: number
  payee?: string | null
  method?: string
  reference?: string | null
  status?: string
  fundId?: string | null
  incurredAt?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.category || typeof body.category !== 'string' || !body.category.trim()) {
    return NextResponse.json({ error: 'category is required' }, { status: 400 })
  }
  if (!body.description || typeof body.description !== 'string' || !body.description.trim()) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }
  if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  const method =
    body.method && VALID_METHODS.includes(body.method as (typeof VALID_METHODS)[number])
      ? body.method
      : 'cash'
  // SoD: expenses ALWAYS start as pending. body.status is ignored — moving to
  // approved/paid goes through PATCH /api/finance/expenses/[id]
  // {action:'approve'} which requires finance:approve (and blocks self-approval).
  const status: (typeof VALID_STATUSES)[number] = 'pending'

  let fund: { id: string } | null = null
  if (body.fundId) {
    fund = await db.fund.findFirst({
      where: { id: body.fundId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!fund) return NextResponse.json({ error: 'Invalid fund' }, { status: 400 })
  }

  const incurredAt = body.incurredAt ? new Date(body.incurredAt) : new Date()
  if (isNaN(incurredAt.getTime())) {
    return NextResponse.json({ error: 'Invalid incurredAt date' }, { status: 400 })
  }

  const created = await db.expense.create({
    data: {
      organizationId: ctx.organizationId,
      fundId: fund?.id ?? null,
      category: body.category.trim(),
      description: body.description.trim(),
      amount: body.amount,
      payee: body.payee?.trim() || null,
      method,
      reference: body.reference?.trim() || null,
      status,
      requesterId: ctx.user.id,
      incurredAt,
    },
  })

  await audit(ctx, 'finance.expense.create', 'expense', created.id, {
    category: created.category,
    amount: created.amount,
    status: created.status,
    needsApproval: created.amount >= HIGH_VALUE_THRESHOLD,
  })

  return NextResponse.json(created, { status: 201 })
})
