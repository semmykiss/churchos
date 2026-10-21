// ChurchOS — Dependants API (member: own only; staff: ?memberId= filter or any)
// GET   /api/dependants                  — list dependants (member: own; staff: optional memberId)
// POST  /api/dependants                  — create dependant (member: own only; staff: any member)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, audit, apiHandler, type AuthContext } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader',
])

// Returns the caller's own memberId (resolved via User.memberId).
async function resolveSelfMember(ctx: AuthContext) {
  if (!ctx.user.memberId) {
    // Try by account link
    const m = await db.member.findFirst({
      where: { account: { id: ctx.user.id }, organizationId: ctx.organizationId },
      select: { id: true },
    })
    return m?.id ?? null
  }
  // Verify it still exists in the org
  const ok = await db.member.findFirst({
    where: { id: ctx.user.memberId, organizationId: ctx.organizationId },
    select: { id: true },
  })
  return ok?.id ?? null
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const sp = req.nextUrl.searchParams
  const memberIdParam = sp.get('memberId') || undefined

  let targetMemberId: string | undefined
  if (STAFF_ROLES.has(ctx.role)) {
    targetMemberId = memberIdParam
  } else {
    const self = await resolveSelfMember(ctx)
    if (!self) return NextResponse.json({ items: [] })
    targetMemberId = self
  }

  const where: any = { organizationId: ctx.organizationId }
  if (targetMemberId) where.memberId = targetMemberId

  const items = await db.dependant.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    include: { member: { select: { id: true, firstName: true, lastName: true } } },
  })
  return NextResponse.json({
    items: items.map((d) => ({
      id: d.id,
      memberId: d.memberId,
      name: d.name,
      relationship: d.relationship,
      dateOfBirth: d.dateOfBirth,
      gender: d.gender,
      note: d.note,
      createdAt: d.createdAt,
      member: d.member,
    })),
    canManageAny: STAFF_ROLES.has(ctx.role),
    selfMemberId: await resolveSelfMember(ctx),
  })
})

interface CreateBody {
  memberId?: string
  name?: string
  relationship?: string
  dateOfBirth?: string | null
  gender?: string | null
  note?: string | null
}

const VALID_RELATIONSHIPS = ['son', 'daughter', 'dependent', 'ward', 'spouse', 'other']
const VALID_GENDERS = ['male', 'female', 'other']

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const body = (await req.json().catch(() => ({}))) as CreateBody
  const name = body.name?.toString().trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const relationship = body.relationship?.toString().trim() || 'dependent'
  if (!VALID_RELATIONSHIPS.includes(relationship)) {
    return NextResponse.json({ error: 'Invalid relationship' }, { status: 400 })
  }
  let targetMemberId: string | undefined
  if (STAFF_ROLES.has(ctx.role)) {
    targetMemberId = body.memberId?.toString().trim()
    if (!targetMemberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
  } else {
    const self = await resolveSelfMember(ctx)
    if (!self) return NextResponse.json({ error: 'Your account is not linked to a member profile' }, { status: 400 })
    targetMemberId = self
  }

  // Validate the target member belongs to the org
  const member = await db.member.findFirst({
    where: { id: targetMemberId, organizationId: ctx.organizationId },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const created = await db.dependant.create({
    data: {
      organizationId: ctx.organizationId,
      memberId: targetMemberId,
      name,
      relationship,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
      gender: body.gender && VALID_GENDERS.includes(body.gender) ? body.gender : null,
      note: body.note?.trim() || null,
    },
  })
  await audit(ctx, 'dependants.create', 'dependant', created.id, {
    memberId: targetMemberId, name, relationship,
  })
  return NextResponse.json(created, { status: 201 })
})
