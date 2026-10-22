// ChurchOS — Household detail API
// GET    /api/households/[id]   — household with members + head
// PATCH  /api/households/[id]   — update fields
// DELETE /api/households/[id]   — remove (clears householdId on members)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

async function getHousehold(orgId: string, id: string) {
  return db.household.findFirst({
    where: { id, organizationId: orgId },
    include: {
      head: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      members: { select: { id: true, firstName: true, lastName: true, photoUrl: true, status: true, memberId: true } },
    },
  })
}

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'view')
  const { id } = await params
  const h = await getHousehold(ctx.organizationId, id)
  if (!h) return NextResponse.json({ error: 'Household not found' }, { status: 404 })
  return NextResponse.json(h)
})

interface PatchBody {
  name?: string
  headMemberId?: string | null
  address?: string | null
  phone?: string | null
  note?: string | null
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'update')
  const { id } = await params
  const existing = await getHousehold(ctx.organizationId, id)
  if (!existing) return NextResponse.json({ error: 'Household not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    data.name = body.name.trim()
  }
  if (body.address !== undefined) data.address = body.address?.trim() || null
  if (body.phone !== undefined) data.phone = body.phone?.trim() || null
  if (body.note !== undefined) data.note = body.note?.trim() || null
  if (body.headMemberId !== undefined) {
    if (body.headMemberId) {
      const m = await db.member.findFirst({
        where: { id: body.headMemberId, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (!m) return NextResponse.json({ error: 'Head member not found' }, { status: 404 })
      data.headMemberId = m.id
    } else {
      data.headMemberId = null
    }
  }

  const updated = await db.household.update({ where: { id }, data })
  // Keep head's householdId synced
  if (data.headMemberId) {
    await db.member.update({
      where: { id: data.headMemberId as string },
      data: { householdId: id },
    }).catch(() => null)
  }

  await audit(ctx, 'households.update', 'household', id, { fields: Object.keys(data) })
  return NextResponse.json({ id: updated.id, ok: true })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'delete')
  const { id } = await params
  const existing = await getHousehold(ctx.organizationId, id)
  if (!existing) return NextResponse.json({ error: 'Household not found' }, { status: 404 })

  // Clear householdId on members before deleting (prisma SetNull only applies on household delete via cascade? — schema uses onDelete: SetNull on household relation)
  await db.member.updateMany({
    where: { householdId: id },
    data: { householdId: null },
  }).catch(() => null)

  await db.household.delete({ where: { id } })
  await audit(ctx, 'households.delete', 'household', id, { name: existing.name })
  return NextResponse.json({ ok: true, id })
})
