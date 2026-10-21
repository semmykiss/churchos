// ChurchOS — Audit Log API (read-only)
// GET /api/audit?q=&actorId=&action=&from=&to=&page=
// Permission: can(role,'audit','view') — church_admin/super_admin only.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('audit', 'view')
  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const actorId = sp.get('actorId') ?? ''
  const action = sp.get('action') ?? ''
  const from = sp.get('from')
  const to = sp.get('to')
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (actorId) where.actorId = actorId
  if (action) where.action = { contains: action }
  if (q) {
    where.OR = [
      { action: { contains: q } },
      { targetType: { contains: q } },
      { targetId: { contains: q } },
      { metadata: { contains: q } },
    ]
  }
  if (from || to) {
    const created: Record<string, unknown> = {}
    if (from) created.gte = new Date(from)
    if (to) {
      // inclusive end-of-day
      const toDate = new Date(to)
      toDate.setHours(23, 59, 59, 999)
      created.lte = toDate
    }
    where.createdAt = created
  }

  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    db.auditLog.count({ where }),
  ])

  // Side-channel: distinct actors for the filter dropdown
  const actorsRaw = await db.auditLog.findMany({
    where: { organizationId: ctx.organizationId },
    distinct: ['actorId'],
    select: { actorId: true },
  })
  const actorIds = actorsRaw.map((a) => a.actorId).filter(Boolean) as string[]
  const actors = actorIds.length
    ? await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : []

  return NextResponse.json({
    items: items.map((l) => ({
      id: l.id,
      actorId: l.actorId,
      actor: l.actor
        ? { id: l.actor.id, name: l.actor.name, email: l.actor.email, role: l.actor.role }
        : null,
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      metadata: l.metadata,
      createdAt: l.createdAt,
    })),
    total,
    page,
    pageSize,
    actors,
  })
})
