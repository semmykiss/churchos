// ChurchOS — Prayer Requests API
// GET   /api/pastoral/prayer         — list prayer requests (members see only their own; pastors see all)
// POST  /api/pastoral/prayer         — submit a prayer request (members allowed via pastoral:create)
// PATCH /api/pastoral/prayer         — update a prayer request status: body { id, status }
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
type PrayerStatus = (typeof VALID_STATUSES)[number]

const PRIVATE_VIEW_ROLES = ['pastor', 'super_admin']

// Resolve the current user's member record (if any) — used to scope a member's own prayer requests
async function resolveUserMemberId(email: string | undefined, organizationId: string) {
  if (!email) return null
  const m = await db.member.findFirst({ where: { email, organizationId }, select: { id: true } })
  return m?.id ?? null
}

interface ListResponse {
  items: any[]
  total: number
  stats: { total: number; open: number; private: number }
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('pastoral', 'view')
  const { organizationId, role } = ctx
  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const onlyMine = sp.get('mine') === '1' || sp.get('mine') === 'true'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

  const canSeePrivateSubmitter = PRIVATE_VIEW_ROLES.includes(role)

  // Members can only see their own
  const where: any = { organizationId }
  if (role === 'member' || onlyMine) {
    const memberId = await resolveUserMemberId(ctx.user.email, organizationId)
    if (!memberId) {
      return NextResponse.json({ items: [], total: 0, stats: { total: 0, open: 0, private: 0 } })
    }
    where.memberId = memberId
  }
  if (status && VALID_STATUSES.includes(status as PrayerStatus)) where.status = status

  const [items, total, statusGroups, privateCount] = await Promise.all([
    db.prayerRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, memberId: true },
        },
      },
    }),
    db.prayerRequest.count({ where }),
    db.prayerRequest.groupBy({ by: ['status'], where, _count: true }),
    db.prayerRequest.count({ where: { ...where, private: true } }),
  ])

  return NextResponse.json({
    items: items.map((p) => {
      const isPrivate = !!p.private
      const showSubmitter = canSeePrivateSubmitter || !isPrivate
      return {
        id: p.id,
        request: p.request,
        private: isPrivate,
        status: p.status,
        createdAt: p.createdAt,
        memberId: p.memberId,
        name: showSubmitter ? p.name : 'Anonymous',
        member: showSubmitter && p.member
          ? {
              id: p.member.id,
              name: `${p.member.firstName} ${p.member.lastName}`,
              memberId: p.member.memberId,
            }
          : null,
      }
    }),
    total,
    page,
    pageSize,
    stats: {
      total,
      open: statusGroups.find((g) => g.status === 'open')?._count ?? 0,
      private: privateCount,
    },
  } as ListResponse)
})

interface CreateBody {
  request?: string
  private?: boolean
  memberId?: string | null
  name?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('pastoral', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.request || typeof body.request !== 'string' || !body.request.trim()) {
    return NextResponse.json({ error: 'request is required' }, { status: 400 })
  }

  // Resolve member from auth user's email if not provided
  let memberId: string | null = null
  if (body.memberId) {
    const m = await db.member.findFirst({
      where: { id: body.memberId, organizationId: ctx.organizationId },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!m) {
      return NextResponse.json({ error: 'Invalid member' }, { status: 400 })
    }
    memberId = m.id
  } else {
    const m = await db.member.findFirst({
      where: { email: ctx.user.email, organizationId: ctx.organizationId },
      select: { id: true, firstName: true, lastName: true },
    })
    memberId = m?.id ?? null
  }

  const isPrivate = !!body.private
  // Determine display name — for members submitting their own, use their member name
  let name: string | null = null
  if (memberId) {
    const m = await db.member.findFirst({ where: { id: memberId }, select: { firstName: true, lastName: true } })
    name = m ? `${m.firstName} ${m.lastName}` : null
  } else if (body.name) {
    name = body.name.trim()
  } else {
    name = ctx.user.name ?? null
  }

  const created = await db.prayerRequest.create({
    data: {
      organizationId: ctx.organizationId,
      memberId,
      name,
      request: body.request.trim(),
      private: isPrivate,
      status: 'open',
    },
  })

  await audit(ctx, 'pastoral.prayer.create', 'prayerRequest', created.id, {
    private: isPrivate,
    memberId,
  })

  return NextResponse.json(
    {
      id: created.id,
      request: created.request,
      private: created.private,
      status: created.status,
      createdAt: created.createdAt,
      memberId: created.memberId,
      name: created.name,
    },
    { status: 201 },
  )
})

interface PatchBody {
  id?: string
  status?: string
}

export const PATCH = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('pastoral', 'update')
  const body = (await req.json().catch(() => ({}))) as PatchBody
  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  const existing = await db.prayerRequest.findFirst({
    where: { id: body.id, organizationId: ctx.organizationId },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Prayer request not found' }, { status: 404 })
  }
  if (!body.status || !VALID_STATUSES.includes(body.status as PrayerStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  const updated = await db.prayerRequest.update({
    where: { id: existing.id },
    data: { status: body.status },
  })
  await audit(ctx, 'pastoral.prayer.update', 'prayerRequest', existing.id, {
    status: updated.status,
  })
  return NextResponse.json({ ok: true, id: updated.id, status: updated.status })
})
