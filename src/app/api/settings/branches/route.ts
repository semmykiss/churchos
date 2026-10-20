// ChurchOS — Settings / Branches API
// GET  /api/settings/branches  — list branches. settings:view.
// POST /api/settings/branches  — create branch. settings:manage.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('settings', 'view')
  const branches = await db.branch.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { members: true, services: true, attendance: true, events: true },
      },
    },
  })
  return NextResponse.json({
    items: branches.map((b) => ({
      id: b.id,
      name: b.name,
      location: b.location,
      createdAt: b.createdAt,
      counts: b._count,
    })),
  })
})

interface CreateBody {
  name?: string
  location?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('settings', 'manage')
  const body = (await req.json().catch(() => ({}))) as CreateBody
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const created = await db.branch.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name.trim(),
      location: body.location?.trim() || null,
    },
  })
  await audit(ctx, 'settings.branch.create', 'branch', created.id, {
    name: created.name,
    location: created.location,
  })
  return NextResponse.json(created, { status: 201 })
})
