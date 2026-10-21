// ChurchOS — Access Control · Access reviews (Task ID 26)
// GET  /api/access/reviews — list access reviews.
// POST /api/access/reviews — create access review.
//      Body: { userId, roleId?, decision, notes?, nextReviewDate? }
//
// Permission: can('access','manage')
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { refreshMatrixCache } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_DECISIONS = new Set(['approved', 'revoked', 'modified', 'pending'])

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('access', 'view')
  const sp = req.nextUrl.searchParams
  const userId = sp.get('userId') ?? ''
  const decision = sp.get('decision') ?? ''

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (userId) where.userId = userId
  if (decision) where.decision = decision

  const reviews = await db.accessReview.findMany({
    where,
    orderBy: [{ reviewDate: 'desc' }],
    take: 200,
    include: {
      user: { select: { id: true, name: true, email: true, role: true, avatarUrl: true } },
      reviewer: { select: { id: true, name: true, email: true, role: true } },
    },
  })

  // Hydrate roleId manually (AccessReview.roleId has no relation — wait, schema says reviewer
  // relation only on reviewerId. Let me check the schema). Looking at the schema, AccessReview
  // has roleId without a relation. So we manually fetch role names.
  const roleIds = new Set(reviews.map((r) => r.roleId).filter(Boolean) as string[])
  const roleMap = roleIds.size
    ? new Map((await db.role.findMany({
        where: { id: { in: [...roleIds] } },
        select: { id: true, name: true, label: true, color: true },
      })).map((r) => [r.id, r]))
    : new Map()

  return NextResponse.json({
    reviews: reviews.map((r) => ({
      id: r.id,
      userId: r.userId,
      user: r.user,
      roleId: r.roleId,
      role: r.roleId ? roleMap.get(r.roleId) ?? null : null,
      reviewerId: r.reviewerId,
      reviewer: r.reviewer,
      reviewDate: r.reviewDate,
      decision: r.decision,
      notes: r.notes,
      nextReviewDate: r.nextReviewDate,
    })),
    total: reviews.length,
  })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('access', 'manage')
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const userId = String(body.userId ?? '').trim()
  const decision = String(body.decision ?? '').trim()
  if (!userId || !decision) {
    return NextResponse.json({ error: 'userId and decision are required' }, { status: 400 })
  }
  if (!VALID_DECISIONS.has(decision)) {
    return NextResponse.json(
      { error: `Invalid decision. Must be one of: ${[...VALID_DECISIONS].join(', ')}` },
      { status: 400 },
    )
  }

  const roleId = body.roleId ? String(body.roleId).trim() : null
  const notes = body.notes ? String(body.notes).trim() : null
  const nextReviewDate = body.nextReviewDate ? new Date(body.nextReviewDate as string) : null
  if (nextReviewDate && isNaN(nextReviewDate.getTime())) {
    return NextResponse.json({ error: 'Invalid nextReviewDate' }, { status: 400 })
  }

  // Validate user (and role if provided) belong to this org
  const [user, role] = await Promise.all([
    db.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId },
      select: { id: true, name: true, email: true },
    }),
    roleId ? db.role.findFirst({
      where: { id: roleId, organizationId: ctx.organizationId },
      select: { id: true, name: true, label: true },
    }) : Promise.resolve(null),
  ])
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (roleId && !role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })

  const review = await db.accessReview.create({
    data: {
      organizationId: ctx.organizationId,
      reviewerId: ctx.user.id,
      userId,
      roleId: roleId ?? null,
      decision,
      notes,
      nextReviewDate,
    },
  })

  await audit(ctx, 'access.review.create', 'user', userId, {
    reviewId: review.id, decision, roleId: roleId ?? null, hasNotes: !!notes,
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({
    review: {
      id: review.id,
      userId: review.userId,
      roleId: review.roleId,
      reviewerId: review.reviewerId,
      reviewDate: review.reviewDate,
      decision: review.decision,
      notes: review.notes,
      nextReviewDate: review.nextReviewDate,
    },
  }, { status: 201 })
})
