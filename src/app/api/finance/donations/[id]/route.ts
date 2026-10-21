// ChurchOS — Donation detail API
// GET    /api/finance/donations/[id] — single donation
// PATCH  /api/finance/donations/[id] — update (incl. status change → reconcile fund balance)
// DELETE /api/finance/donations/[id] — delete (only if not confirmed, OR finance:manage)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { can, ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_METHODS = ['cash', 'transfer', 'card', 'online'] as const
const VALID_STATUSES = ['pending', 'confirmed', 'failed', 'refunded'] as const

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'view')
  if (ctx.role === 'member') {
    throw new ForbiddenError('Personal giving statements are available on request from the finance office.')
  }
  const { id } = await params
  const donation = await db.donation.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      fund: { select: { id: true, name: true, code: true } },
      member: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  if (!donation) return NextResponse.json({ error: 'Donation not found' }, { status: 404 })
  return NextResponse.json(donation)
})

interface PatchBody {
  donorName?: string | null
  memberId?: string | null
  fundId?: string | null
  amount?: number
  method?: string
  reference?: string | null
  status?: string
  donatedAt?: string | null
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'update')
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const existing = await db.donation.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!existing) return NextResponse.json({ error: 'Donation not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (body.donorName !== undefined) data.donorName = body.donorName?.trim() || null
  if (body.memberId !== undefined) {
    data.memberId = body.memberId || null
  }
  if (body.reference !== undefined) data.reference = body.reference?.trim() || null
  if (body.method !== undefined && VALID_METHODS.includes(body.method as (typeof VALID_METHODS)[number])) {
    data.method = body.method
  }
  if (body.donatedAt !== undefined) {
    data.donatedAt = body.donatedAt ? new Date(body.donatedAt) : new Date()
  }
  if (body.amount !== undefined) {
    if (typeof body.amount !== 'number' || isNaN(body.amount) || body.amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }
    data.amount = body.amount
  }

  // Status change — reconcile fund balance
  let balanceDelta = 0
  let newStatus = existing.status
  if (body.status !== undefined && body.status !== existing.status) {
    if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    newStatus = body.status
    data.status = body.status
    // If transitioning to/from confirmed, adjust fund balance accordingly
    const wasConfirmed = existing.status === 'confirmed'
    const willBeConfirmed = body.status === 'confirmed'
    if (!wasConfirmed && willBeConfirmed) balanceDelta = existing.amount
    else if (wasConfirmed && !willBeConfirmed) balanceDelta = -existing.amount
  }
  // Amount change while confirmed also affects fund balance
  if (body.amount !== undefined && existing.status === 'confirmed' && body.status === undefined) {
    balanceDelta += (body.amount - existing.amount)
  }

  // Validate fundId if changing
  if (body.fundId !== undefined && body.fundId !== existing.fundId) {
    if (body.fundId) {
      const fund = await db.fund.findFirst({
        where: { id: body.fundId, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (!fund) return NextResponse.json({ error: 'Invalid fund' }, { status: 400 })
      data.fundId = body.fundId
    } else {
      data.fundId = null
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const d = await tx.donation.update({ where: { id }, data })
    if (balanceDelta !== 0 && existing.fundId) {
      await tx.fund.update({
        where: { id: existing.fundId },
        data: { balance: { increment: balanceDelta } },
      })
    }
    return d
  })

  await audit(ctx, 'finance.donation.update', 'donation', id, {
    fields: Object.keys(data),
    statusChanged: body.status !== undefined && body.status !== existing.status,
    newStatus,
  })

  return NextResponse.json({ id: updated.id, ok: true })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'update')
  const isManager = can(ctx.role, 'finance', 'manage')
  const { id } = await params
  const existing = await db.donation.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!existing) return NextResponse.json({ error: 'Donation not found' }, { status: 404 })

  // Confirmed donations can only be deleted by managers; non-confirmed by any updater.
  if (existing.status === 'confirmed' && !isManager) {
    throw new ForbiddenError('Confirmed donations can only be deleted by finance managers.')
  }

  await db.$transaction(async (tx) => {
    // Reverse fund balance if it was confirmed
    if (existing.status === 'confirmed' && existing.fundId) {
      await tx.fund.update({
        where: { id: existing.fundId },
        data: { balance: { decrement: existing.amount } },
      })
    }
    await tx.donation.delete({ where: { id } })
  })

  await audit(ctx, 'finance.donation.delete', 'donation', id, {
    amount: existing.amount,
    status: existing.status,
  })

  return NextResponse.json({ ok: true, id })
})
