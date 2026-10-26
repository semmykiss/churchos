// ChurchOS — Tithe detail API (member: own; staff: any)
// GET    /api/finance/tithes/[id]   — single tithe
// PATCH  /api/finance/tithes/[id]   — update (staff only for status changes)
// DELETE /api/finance/tithes/[id]   — remove (staff only)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { broadcastEvent } from '@/lib/ai-events'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { isFinanceStaffRole } from '@/lib/permissions-db'

export const dynamic = 'force-dynamic'

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

async function getTithe(ctx: AuthContext, id: string) {
  const tithe = await db.tithe.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } } },
  })
  if (!tithe) return null
  if (!isFinanceStaffRole(ctx.role)) {
    const self = await resolveSelfMember(ctx)
    if (!self || self !== tithe.memberId) return null
  }
  return tithe
}

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'view')
  const { id } = await params
  const t = await getTithe(ctx, id)
  if (!t) return NextResponse.json({ error: 'Tithe not found' }, { status: 404 })
  return NextResponse.json(t)
})

interface PatchBody {
  amount?: number
  method?: string
  reference?: string | null
  status?: string
  titheMonth?: string
  note?: string | null
  /** Required when status === 'rejected'. Captures the reason for rejecting the tithe. */
  rejectionReason?: string
}

const VALID_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'mobile_money', 'other']
const VALID_STATUSES = ['confirmed', 'pending', 'failed', 'rejected']

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'update')
  const { id } = await params
  const existing = await getTithe(ctx, id)
  if (!existing) return NextResponse.json({ error: 'Tithe not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const data: Record<string, unknown> = {}

  // Members can only edit note on their own pending tithes
  if (!isFinanceStaffRole(ctx.role)) {
    if (existing.status !== 'pending') {
      return NextResponse.json({ error: 'Cannot edit a non-pending tithe' }, { status: 403 })
    }
    if (body.note !== undefined) data.note = body.note?.trim() || null
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Members can only edit the note field on pending tithes' }, { status: 400 })
    }
  } else {
    if (body.amount !== undefined) {
      const amt = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount))
      if (!isFinite(amt) || amt <= 0) return NextResponse.json({ error: 'amount must be positive' }, { status: 400 })
      data.amount = amt
    }
    if (body.method !== undefined) {
      if (!VALID_METHODS.includes(body.method)) return NextResponse.json({ error: 'Invalid method' }, { status: 400 })
      data.method = body.method
    }
    if (body.reference !== undefined) data.reference = body.reference?.trim() || null
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      // Require a rejection reason when rejecting a tithe
      if (body.status === 'rejected') {
        const reason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim() : ''
        if (!reason) {
          return NextResponse.json(
            { error: 'A rejection reason is required when rejecting a tithe. Please provide a reason.' },
            { status: 400 },
          )
        }
        data.note = reason // store the reason in the note field (preserves it on the record)
      }
      data.status = body.status
    }
    if (body.titheMonth !== undefined) {
      const d = new Date(body.titheMonth)
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid titheMonth' }, { status: 400 })
      data.titheMonth = d
    }
    if (body.note !== undefined && body.status !== 'rejected') {
      // Don't overwrite the rejection reason if it was just set above
      data.note = body.note?.trim() || null
    }
  }

  const updated = await db.tithe.update({ where: { id }, data })
  await audit(ctx, 'finance.tithes.update', 'tithe', id, { fields: Object.keys(data) })

  // Notify the member if their tithe status changed (confirmed/rejected)
  if (body.status && body.status !== existing.status && existing.memberId) {
    const member = await db.member.findUnique({ where: { id: existing.memberId }, include: { account: { select: { id: true } } } })
    if (member?.account?.id) {
      const rejectionReason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim() : ''
      await db.notification.create({
        data: {
          userId: member.account.id,
          title: body.status === 'confirmed' ? 'Tithe confirmed ✅' : 'Tithe rejected',
          message: body.status === 'confirmed'
            ? `Your tithe of ${existing.amount} has been confirmed. Thank you for your giving!`
            : `Your tithe of ${existing.amount} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ' Please contact the finance office.'}`,
          link: `finance:${id}`,
        },
      }).catch(() => {})
    }

    // Broadcast to the AI assistant live events feed. Marked as finance so the
    // UI hides the amount for non-finance-staff users (they just see "a tithe
    // was confirmed"). Finance staff see the full amount in the ticker.
    await broadcastEvent(ctx, {
      module: 'finance',
      action: body.status === 'confirmed' ? 'confirm' : 'reject',
      title: body.status === 'confirmed' ? 'Tithe confirmed' : 'Tithe rejected',
      message: body.status === 'confirmed'
        ? `A tithe was confirmed for ${member ? `${member.firstName} ${member.lastName}` : 'a member'}.`
        : `A tithe was rejected for ${member ? `${member.firstName} ${member.lastName}` : 'a member'}.`,
      refId: id,
      refType: 'tithe',
      isFinance: true,
      metadata: { amount: existing.amount, currency: existing.currency }, // hidden for non-finance-staff on the client
    })
  }

  return NextResponse.json({ id: updated.id, ok: true })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'delete')
  const { id } = await params
  const existing = await getTithe(ctx, id)
  if (!existing) return NextResponse.json({ error: 'Tithe not found' }, { status: 404 })
  await db.tithe.delete({ where: { id } })
  await audit(ctx, 'finance.tithes.delete', 'tithe', id, {
    memberId: existing.memberId, amount: existing.amount,
  })
  return NextResponse.json({ ok: true, id })
})
