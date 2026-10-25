// ChurchOS — lightweight authenticated users directory for pickers.
// Used by department-head dropdowns and other user-select primitives.
// Deliberately minimal PII: id, name, email, role, active, avatarUrl, memberId.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

// GET /api/users?q=&active=true&role=&pageSize=
// Any authenticated user of the org may read the directory (no module permission required).
export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const active = sp.get('active')
  const role = (sp.get('role') ?? '').trim()
  const pageSizeRaw = parseInt(sp.get('pageSize') ?? '', 10)
  const pageSize = Math.min(Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 100, 200)

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (active === 'true') where.active = true
  if (role) where.role = role
  if (q) {
    // SQLite: plain contains (no insensitive mode) — consistent with sibling routes.
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
    ]
  }

  const users = await db.user.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    take: pageSize,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      avatarUrl: true,
      memberId: true,
    },
  })

  return NextResponse.json({ users })
})
