// ChurchOS — Member relationships API
// GET    /api/members/[id]/relationships   — list both directions (from + to)
// POST   /api/members/[id]/relationships {toMemberId, relationType, note?}
// DELETE /api/members/[id]/relationships?relId=
//   Members (with members:update): scoped to their own member profile (or self).
//   Staff with members:update can edit any member's relationships.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor',
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

async function canEditMember(ctx: AuthContext, memberId: string) {
  if (STAFF_ROLES.has(ctx.role)) return true
  const self = await resolveSelfMember(ctx)
  return !!self && self === memberId
}

const VALID_RELATIONS = ['spouse', 'child', 'parent', 'sibling', 'guardian', 'dependent', 'other']

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'view')
  const { id } = await params
  const member = await db.member.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const [fromRels, toRels] = await Promise.all([
    db.relationship.findMany({
      where: { fromMemberId: id },
      include: { toMember: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } },
    }),
    db.relationship.findMany({
      where: { toMemberId: id },
      include: { fromMember: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } },
    }),
  ])

  return NextResponse.json({
    items: [
      ...fromRels.map((r) => ({
        id: r.id,
        fromMemberId: r.fromMemberId,
        toMemberId: r.toMemberId,
        relationType: r.relationType,
        note: r.note,
        direction: 'outgoing',
        target: r.toMember,
      })),
      ...toRels.map((r) => ({
        id: r.id,
        fromMemberId: r.fromMemberId,
        toMemberId: r.toMemberId,
        relationType: r.relationType,
        note: r.note,
        direction: 'incoming',
        target: r.fromMember,
      })),
    ],
  })
})

interface PostBody {
  toMemberId?: string
  relationType?: string
  note?: string | null
}

export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'update')
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PostBody
  const toMemberId = body.toMemberId?.toString().trim()
  const relationType = body.relationType?.toString().trim()
  if (!toMemberId) return NextResponse.json({ error: 'toMemberId is required' }, { status: 400 })
  if (!relationType || !VALID_RELATIONS.includes(relationType)) {
    return NextResponse.json({ error: 'Invalid relationType' }, { status: 400 })
  }
  if (toMemberId === id) {
    return NextResponse.json({ error: 'Cannot relate a member to themselves' }, { status: 400 })
  }
  if (!(await canEditMember(ctx, id))) {
    return NextResponse.json({ error: 'You can only manage relationships for your own member profile' }, { status: 403 })
  }
  const toMember = await db.member.findFirst({
    where: { id: toMemberId, organizationId: ctx.organizationId },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!toMember) return NextResponse.json({ error: 'Target member not found' }, { status: 404 })

  try {
    const created = await db.relationship.create({
      data: {
        organizationId: ctx.organizationId,
        fromMemberId: id,
        toMemberId,
        relationType,
        note: body.note?.trim() || null,
      },
    })
    await audit(ctx, 'members.relationship.create', 'relationship', created.id, {
      fromMemberId: id, toMemberId, relationType,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e: any) {
    if (String(e?.message || '').includes('Unique constraint')) {
      return NextResponse.json({ error: 'This relationship already exists' }, { status: 409 })
    }
    throw e
  }
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'update')
  const { id } = await params
  const sp = req.nextUrl.searchParams
  const relId = sp.get('relId')?.toString().trim()
  if (!relId) return NextResponse.json({ error: 'relId query param is required' }, { status: 400 })

  const rel = await db.relationship.findFirst({
    where: { id: relId, organizationId: ctx.organizationId },
  })
  if (!rel) return NextResponse.json({ error: 'Relationship not found' }, { status: 404 })
  if (rel.fromMemberId !== id && rel.toMemberId !== id) {
    return NextResponse.json({ error: 'Relationship does not belong to this member' }, { status: 400 })
  }
  if (!(await canEditMember(ctx, id))) {
    return NextResponse.json({ error: 'You can only manage relationships for your own member profile' }, { status: 403 })
  }
  await db.relationship.delete({ where: { id: relId } })
  await audit(ctx, 'members.relationship.delete', 'relationship', relId, {
    fromMemberId: rel.fromMemberId, toMemberId: rel.toMemberId,
  })
  return NextResponse.json({ ok: true, id: relId })
})
