// ChurchOS — Households API
// GET   /api/households            — list households (with member count + head)
// POST  /api/households            — create household
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('members', 'view')
  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const headMemberId = sp.get('headMemberId') || undefined

  const where: any = { organizationId: ctx.organizationId }
  if (q) where.name = { contains: q }
  if (headMemberId) where.headMemberId = headMemberId

  const items = await db.household.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    include: {
      head: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      members: {
        select: { id: true, firstName: true, lastName: true, photoUrl: true, status: true },
      },
    },
  })

  return NextResponse.json({
    items: items.map((h) => ({
      id: h.id,
      name: h.name,
      address: h.address,
      phone: h.phone,
      note: h.note,
      head: h.head,
      members: h.members,
      memberCount: h.members.length,
      createdAt: h.createdAt,
    })),
  })
})

interface PostBody {
  name?: string
  headMemberId?: string | null
  address?: string | null
  phone?: string | null
  note?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('members', 'create')
  const body = (await req.json().catch(() => ({}))) as PostBody
  const name = body.name?.toString().trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  let headMemberId: string | null = null
  if (body.headMemberId) {
    const m = await db.member.findFirst({
      where: { id: body.headMemberId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!m) return NextResponse.json({ error: 'Head member not found' }, { status: 404 })
    headMemberId = m.id
  }

  const created = await db.household.create({
    data: {
      organizationId: ctx.organizationId,
      name,
      headMemberId,
      address: body.address?.trim() || null,
      phone: body.phone?.trim() || null,
      note: body.note?.trim() || null,
    },
    include: { head: { select: { id: true, firstName: true, lastName: true } } },
  })

  // If headMemberId is set, also set the member's householdId (best-effort)
  if (headMemberId) {
    await db.member.update({
      where: { id: headMemberId },
      data: { householdId: created.id },
    }).catch(() => null)
  }

  await audit(ctx, 'households.create', 'household', created.id, { name, headMemberId })
  return NextResponse.json(created, { status: 201 })
})
