// ChurchOS — Tithes API (member: own only; staff: all org tithes)
// GET   /api/finance/tithes               — list (member: own; staff: optional memberId filter)
// POST  /api/finance/tithes               — create (member: status=pending; staff: any status)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader',
])

async function resolveSelfMember(ctx: AuthContext) {
  if (!ctx.user.memberId) {
    const m = await db.member.findFirst({
      where: { account: { id: ctx.user.id }, organizationId: ctx.organizationId },
      select: { id: true },
    })
    return m?.id ?? null
  }
  const ok = await db.member.findFirst({
    where: { id: ctx.user.memberId, organizationId: ctx.organizationId },
    select: { id: true },
  })
  return ok?.id ?? null
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const memberIdParam = sp.get('memberId') || undefined
  const status = sp.get('status') || undefined
  const method = sp.get('method') || undefined
  const from = sp.get('from')
  const to = sp.get('to')
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '20', 10) || 20))

  const where: any = { organizationId: ctx.organizationId }
  if (!STAFF_ROLES.has(ctx.role)) {
    const self = await resolveSelfMember(ctx)
    if (!self) return NextResponse.json({ items: [], total: 0, page, pageSize, stats: zeroStats() })
    where.memberId = self
  } else if (memberIdParam) {
    where.memberId = memberIdParam
  }
  if (status) where.status = status
  if (method) where.method = method
  if (from || to) {
    where.titheMonth = {}
    if (from) where.titheMonth.gte = new Date(from)
    if (to) where.titheMonth.lte = new Date(to)
  }

  const [items, total, statusGroups] = await Promise.all([
    db.tithe.findMany({
      where,
      orderBy: [{ titheMonth: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } } },
    }),
    db.tithe.count({ where }),
    db.tithe.groupBy({ by: ['status'], where: { organizationId: ctx.organizationId }, _sum: { amount: true }, _count: true }),
  ])

  const stats = zeroStats()
  for (const g of statusGroups) {
    if (g.status === 'confirmed') stats.confirmed = g._sum.amount ?? 0
    if (g.status === 'pending') stats.pending = g._sum.amount ?? 0
    if (g.status === 'failed') stats.failed = g._sum.amount ?? 0
  }

  return NextResponse.json({
    items: items.map((t) => ({
      id: t.id,
      memberId: t.memberId,
      member: t.member,
      amount: t.amount,
      currency: t.currency,
      method: t.method,
      reference: t.reference,
      status: t.status,
      titheMonth: t.titheMonth,
      note: t.note,
      createdAt: t.createdAt,
    })),
    total,
    page,
    pageSize,
    stats,
    canManageAny: STAFF_ROLES.has(ctx.role),
    selfMemberId: await resolveSelfMember(ctx),
  })
})

function zeroStats() {
  return { confirmed: 0, pending: 0, failed: 0, total: 0 }
}

interface CreateBody {
  memberId?: string
  amount?: number
  currency?: string
  method?: string
  reference?: string | null
  status?: string
  titheMonth?: string
  note?: string | null
}

const VALID_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'mobile_money', 'other']
const VALID_STATUSES = ['confirmed', 'pending', 'failed']

export const POST = apiHandler(async (req: NextRequest) => {
  // Member role can POST tithes too (status forced to 'pending' for staff approval).
  // We use 'view' permission (members have finance:view) rather than 'create' (which members lack).
  const ctx = await requirePermission('finance', 'view')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  const amount = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount ?? ''))
  if (!isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }
  const method = body.method && VALID_METHODS.includes(body.method) ? body.method : 'cash'
  const titheMonth = body.titheMonth ? new Date(body.titheMonth) : new Date()
  if (isNaN(titheMonth.getTime())) {
    return NextResponse.json({ error: 'Invalid titheMonth' }, { status: 400 })
  }

  let targetMemberId: string | undefined
  let status: string
  if (STAFF_ROLES.has(ctx.role)) {
    targetMemberId = body.memberId?.toString().trim()
    if (!targetMemberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    status = body.status && VALID_STATUSES.includes(body.status) ? body.status : 'confirmed'
  } else {
    const self = await resolveSelfMember(ctx)
    if (!self) return NextResponse.json({ error: 'Your account is not linked to a member profile' }, { status: 400 })
    targetMemberId = self
    status = 'pending' // members can only create pending tithes
  }

  const member = await db.member.findFirst({
    where: { id: targetMemberId, organizationId: ctx.organizationId },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const created = await db.tithe.create({
    data: {
      organizationId: ctx.organizationId,
      memberId: targetMemberId,
      amount,
      currency: body.currency || 'NGN',
      method,
      reference: body.reference?.trim() || null,
      status,
      titheMonth,
      note: body.note?.trim() || null,
    },
  })
  await audit(ctx, 'finance.tithes.create', 'tithe', created.id, {
    memberId: targetMemberId, amount, status, method,
  })
  return NextResponse.json(created, { status: 201 })
})
