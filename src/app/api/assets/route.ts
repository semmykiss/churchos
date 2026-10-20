// ChurchOS — Assets & Facilities API
// GET  /api/assets?category=&condition=&q=   — list with summary stats
// POST /api/assets                            — create asset. assets:create.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = [
  'equipment', 'instrument', 'furniture', 'vehicle', 'building', 'it',
] as const
const VALID_CONDITIONS = ['good', 'fair', 'damaged', 'retired'] as const

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('assets', 'view')
  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const category = sp.get('category') ?? ''
  const condition = sp.get('condition') ?? ''
  const bookingsMode = sp.get('bookings') === '1'

  // ---- Bookings sub-resource: existing room/resource bookings ----
  if (bookingsMode) {
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '25', 10) || 25))
    const where: Record<string, unknown> = { organizationId: ctx.organizationId }
    const status = sp.get('status')
    if (status) where.status = status
    const [items, total] = await Promise.all([
      db.booking.findMany({
        where,
        orderBy: { startAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.booking.count({ where }),
    ])
    return NextResponse.json({ items, total, page, pageSize })
  }

  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '200', 10) || 200))

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (category && VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    where.category = category
  }
  if (condition && VALID_CONDITIONS.includes(condition as (typeof VALID_CONDITIONS)[number])) {
    where.condition = condition
  }
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { tag: { contains: q } },
      { location: { contains: q } },
      { custodian: { contains: q } },
    ]
  }

  const [items, total, categoryGroups, conditionGroups, valueAgg] = await Promise.all([
    db.asset.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.asset.count({ where }),
    db.asset.groupBy({ by: ['category'], where: { organizationId: ctx.organizationId }, _count: true }),
    db.asset.groupBy({ by: ['condition'], where: { organizationId: ctx.organizationId }, _count: true }),
    db.asset.aggregate({
      where: { organizationId: ctx.organizationId },
      _sum: { value: true },
      _count: true,
    }),
  ])

  const stats = {
    total: valueAgg._count,
    totalValue: valueAgg._sum.value ?? 0,
    byCategory: Object.fromEntries(
      categoryGroups.map((g) => [g.category, g._count]),
    ) as Record<string, number>,
    byCondition: Object.fromEntries(
      conditionGroups.map((g) => [g.condition, g._count]),
    ) as Record<string, number>,
  }

  return NextResponse.json({
    items: items.map((a) => ({
      id: a.id,
      tag: a.tag,
      name: a.name,
      category: a.category,
      location: a.location,
      custodian: a.custodian,
      condition: a.condition,
      acquiredAt: a.acquiredAt,
      value: a.value,
      createdAt: a.createdAt,
    })),
    total,
    page,
    pageSize,
    stats,
  })
})

interface CreateBody {
  name?: string
  tag?: string | null
  category?: string
  location?: string | null
  custodian?: string | null
  condition?: string
  acquiredAt?: string | null
  value?: number | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('assets', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const category =
    body.category && VALID_CATEGORIES.includes(body.category as (typeof VALID_CATEGORIES)[number])
      ? body.category!
      : 'equipment'
  const condition =
    body.condition && VALID_CONDITIONS.includes(body.condition as (typeof VALID_CONDITIONS)[number])
      ? body.condition!
      : 'good'

  const created = await db.asset.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name.trim(),
      tag: body.tag?.trim() || null,
      category,
      location: body.location?.trim() || null,
      custodian: body.custodian?.trim() || null,
      condition,
      acquiredAt: body.acquiredAt ? new Date(body.acquiredAt) : null,
      value: typeof body.value === 'number' && body.value >= 0 ? body.value : null,
    },
  })

  await audit(ctx, 'assets.create', 'asset', created.id, {
    name: created.name,
    category: created.category,
    value: created.value,
  })

  return NextResponse.json(created, { status: 201 })
})
