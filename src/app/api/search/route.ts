// ChurchOS — Global permission-aware search API
// GET /api/search?q=  → { results: { members, events, donations, assets, documents, tasks }, total }
// Permission-aware: only includes types the role can view. Skips pastoral entirely (no leakage).
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const LIMIT = 5

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('search', 'view')
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()

  if (q.length < 2) {
    return NextResponse.json({
      results: { members: [], events: [], donations: [], assets: [], documents: [], tasks: [] },
      total: 0,
      q,
    })
  }

  const role = ctx.role
  const orgId = ctx.organizationId

  // ---- Members (members:view) ----
  let members: any[] = []
  if (can(role, 'members', 'view')) {
    const rows = await db.member.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { preferredName: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
          { memberId: { contains: q } },
        ],
      },
      take: LIMIT,
      select: {
        id: true, firstName: true, lastName: true, preferredName: true,
        memberId: true, status: true, email: true, phone: true,
      },
    })
    members = rows.map((m) => ({
      id: m.id,
      label: `${m.firstName} ${m.lastName}`,
      subtitle: m.memberId ?? m.email ?? m.phone ?? titleCase(m.status),
      type: 'members',
    }))
  }

  // ---- Events (events:view) ----
  let events: any[] = []
  if (can(role, 'events', 'view')) {
    const rows = await db.event.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
          { venue: { contains: q } },
        ],
      },
      take: LIMIT,
      orderBy: { startDate: 'desc' },
      select: { id: true, title: true, venue: true, startDate: true, status: true },
    })
    events = rows.map((e) => ({
      id: e.id,
      label: e.title,
      subtitle: e.venue ?? 'Event',
      type: 'events',
    }))
  }

  // ---- Donations (finance:view — non-member only, member restricted as in finance module) ----
  let donations: any[] = []
  if (can(role, 'finance', 'view') && role !== 'member') {
    const rows = await db.donation.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { donorName: { contains: q } },
          { reference: { contains: q } },
        ],
      },
      take: LIMIT,
      orderBy: { donatedAt: 'desc' },
      select: {
        id: true, donorName: true, amount: true, donatedAt: true,
        fund: { select: { name: true } },
      },
    })
    donations = rows.map((d) => ({
      id: d.id,
      label: d.donorName ?? 'Donation',
      subtitle: d.fund?.name ?? 'General',
      type: 'donations',
    }))
  }

  // ---- Assets (assets:view) ----
  let assets: any[] = []
  if (can(role, 'assets', 'view')) {
    const rows = await db.asset.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { name: { contains: q } },
          { tag: { contains: q } },
          { location: { contains: q } },
          { custodian: { contains: q } },
        ],
      },
      take: LIMIT,
      select: { id: true, name: true, tag: true, category: true, location: true },
    })
    assets = rows.map((a) => ({
      id: a.id,
      label: a.name,
      subtitle: a.tag ?? a.location ?? titleCase(a.category),
      type: 'assets',
    }))
  }

  // ---- Documents (documents:view) — access-level filtered like documents API ----
  let documents: any[] = []
  if (can(role, 'documents', 'view')) {
    const ACCESS_MATRIX: Record<string, number> = {
      super_admin: 6, church_admin: 5, pastor: 5, finance_officer: 4,
      department_head: 3, department_assistant: 3, unit_leader: 3, member: 2, guest: 1,
    }
    const LEVEL_RANK: Record<string, number> = {
      public: 1, members: 2, staff: 3, leaders: 4, finance: 5, pastoral: 6,
    }
    const maxLevel = ACCESS_MATRIX[role] ?? 1
    const accessibleLevels = (Object.entries(LEVEL_RANK) as [string, number][])
      .filter(([, rank]) => rank <= maxLevel)
      .map(([key]) => key)
    const rows = await db.document.findMany({
      where: {
        organizationId: orgId,
        accessLevel: { in: accessibleLevels },
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
        ],
      },
      take: LIMIT,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, category: true, accessLevel: true },
    })
    documents = rows.map((d) => ({
      id: d.id,
      label: d.title,
      subtitle: `${titleCase(d.category)} · ${titleCase(d.accessLevel)}`,
      type: 'documents',
    }))
  }

  // ---- Tasks (tasks:view) ----
  let tasks: any[] = []
  if (can(role, 'tasks', 'view')) {
    const where: Record<string, unknown> = {
      organizationId: orgId,
      OR: [
        { title: { contains: q } },
        { description: { contains: q } },
      ],
    }
    const rows = await db.task.findMany({
      where,
      take: LIMIT,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, status: true, priority: true,
        department: { select: { name: true } },
      },
    })
    tasks = rows.map((t) => ({
      id: t.id,
      label: t.title,
      subtitle: t.department?.name ?? titleCase(t.status),
      type: 'tasks',
    }))
  }

  // Intentionally NOT including pastoral cases / prayer requests in global search
  // to avoid leakage of confidential data via this surface.

  const results = { members, events, donations, assets, documents, tasks }
  const total = Object.values(results).reduce((s, arr) => s + arr.length, 0)

  return NextResponse.json({ results, total, q })
})

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
