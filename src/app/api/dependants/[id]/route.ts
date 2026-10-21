// ChurchOS — Dependant detail API (member: own only; staff: any)
// GET    /api/dependants/[id]   — single dependant
// PATCH  /api/dependants/[id]   — update fields
// DELETE /api/dependants/[id]   — remove
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, audit, apiHandler, type AuthContext } from '@/lib/api'

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

async function getDependant(ctx: AuthContext, id: string) {
  const dependant = await db.dependant.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { member: { select: { id: true, firstName: true, lastName: true } } },
  })
  if (!dependant) return null
  // Access control: staff can access any; members only their own
  if (!STAFF_ROLES.has(ctx.role)) {
    const self = await resolveSelfMember(ctx)
    if (!self || self !== dependant.memberId) return null
  }
  return dependant
}

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireUser()
  const { id } = await params
  const d = await getDependant(ctx, id)
  if (!d) return NextResponse.json({ error: 'Dependant not found' }, { status: 404 })
  return NextResponse.json(d)
})

interface PatchBody {
  name?: string
  relationship?: string
  dateOfBirth?: string | null
  gender?: string | null
  note?: string | null
}

const VALID_RELATIONSHIPS = ['son', 'daughter', 'dependent', 'ward', 'spouse', 'other']
const VALID_GENDERS = ['male', 'female', 'other']

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireUser()
  const { id } = await params
  const existing = await getDependant(ctx, id)
  if (!existing) return NextResponse.json({ error: 'Dependant not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    data.name = body.name.trim()
  }
  if (body.relationship !== undefined) {
    if (!VALID_RELATIONSHIPS.includes(body.relationship)) {
      return NextResponse.json({ error: 'Invalid relationship' }, { status: 400 })
    }
    data.relationship = body.relationship
  }
  if (body.dateOfBirth !== undefined) {
    data.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null
  }
  if (body.gender !== undefined) {
    data.gender = body.gender && VALID_GENDERS.includes(body.gender) ? body.gender : null
  }
  if (body.note !== undefined) {
    data.note = body.note?.trim() || null
  }

  const updated = await db.dependant.update({ where: { id }, data })
  await audit(ctx, 'dependants.update', 'dependant', id, { fields: Object.keys(data) })
  return NextResponse.json({ id: updated.id, ok: true })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireUser()
  const { id } = await params
  const existing = await getDependant(ctx, id)
  if (!existing) return NextResponse.json({ error: 'Dependant not found' }, { status: 404 })
  await db.dependant.delete({ where: { id } })
  await audit(ctx, 'dependants.delete', 'dependant', id, { name: existing.name })
  return NextResponse.json({ ok: true, id })
})
