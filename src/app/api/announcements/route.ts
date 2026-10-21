// ChurchOS — Announcements / Communications API
// GET  /api/announcements         — list announcements (filter by audience, org-scoped)
// POST /api/announcements         — create announcement + fan-out Notifications (audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_AUDIENCES = ['all', 'members', 'department', 'leaders'] as const
type Audience = (typeof VALID_AUDIENCES)[number]

interface ListResponse {
  items: any[]
  total: number
  stats: { total: number; pinned: number; published: number; drafts: number }
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('announcements', 'view')
  const { organizationId, role, departmentId } = ctx

  const sp = req.nextUrl.searchParams
  const audienceFilter = sp.get('audience') ?? ''
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

  const where: any = { organizationId }

  // Member role only sees announcements relevant to them.
  // - audience 'all' → everyone
  // - audience 'members' → role === 'member' or higher (any logged-in user)
  // - audience 'department' → user belongs to that department (dept_head/assistant/unit_leader via departmentId OR member via DepartmentMembership)
  // - audience 'leaders' → role in [pastor, church_admin, super_admin, department_head]
  if (role === 'member' || role === 'guest') {
    const memberAudiences: string[] = ['all', 'members']
    // For department-scoped announcements, member may belong to that department
    // We do a per-row membership check below via include + filter — easier to fetch all and filter in-memory
    const all = await db.announcement.findMany({
      where: { organizationId, published: true },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      include: { _count: { select: { id: true } } },
    })
    // Resolve this user's member record to check DepartmentMembership
    const userMember = await db.member.findFirst({
      where: { email: ctx.user.email, organizationId },
      include: { departmentMemberships: { select: { departmentId: true } } },
    })
    const memberDeptIds = new Set((userMember?.departmentMemberships ?? []).map((d) => d.departmentId))
    const leaderRoles = ['pastor', 'church_admin', 'super_admin', 'department_head']
    const visible = all.filter((a) => {
      if (!a.published) return false
      if (a.audience === 'all') return true
      if (a.audience === 'members') return true
      if (a.audience === 'leaders') return leaderRoles.includes(role)
      if (a.audience === 'department') {
        // Members see only if they belong to that department (if dept set)
        if (!a.departmentId) return true
        return memberDeptIds.has(a.departmentId) || departmentId === a.departmentId
      }
      return false
    })
    const total = visible.length
    const paged = visible.slice((page - 1) * pageSize, page * pageSize)
    const body: ListResponse = {
      items: paged.map(mapAnnouncement),
      total,
      stats: {
        total: visible.length,
        pinned: visible.filter((a) => a.pinned).length,
        published: visible.length,
        drafts: 0,
      },
    }
    return NextResponse.json(body)
  }

  if (audienceFilter && VALID_AUDIENCES.includes(audienceFilter as Audience)) {
    where.audience = audienceFilter
  }
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { body: { contains: q } },
    ]
  }

  const [items, total, statusGroups] = await Promise.all([
    db.announcement.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.announcement.count({ where }),
    db.announcement.groupBy({
      by: ['pinned', 'published'],
      where: { organizationId },
      _count: true,
    }),
  ])

  const stats = {
    total: statusGroups.reduce((s, g) => s + g._count, 0),
    pinned: statusGroups.filter((g) => g.pinned).reduce((s, g) => s + g._count, 0),
    published: statusGroups.filter((g) => g.published).reduce((s, g) => s + g._count, 0),
    drafts: statusGroups.filter((g) => !g.published).reduce((s, g) => s + g._count, 0),
  }

  const body: ListResponse = { items: items.map(mapAnnouncement), total, stats }
  return NextResponse.json(body)
})

function mapAnnouncement(a: any) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    audience: a.audience,
    departmentId: a.departmentId,
    published: a.published,
    pinned: a.pinned,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    authorId: a.authorId ?? null,
  }
}

interface CreateBody {
  title?: string
  body?: string
  audience?: string
  departmentId?: string | null
  published?: boolean
  pinned?: boolean
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('announcements', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.body || typeof body.body !== 'string' || !body.body.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }
  const audience: Audience =
    body.audience && VALID_AUDIENCES.includes(body.audience as Audience)
      ? (body.audience as Audience)
      : 'all'

  let departmentId: string | null = null
  if (audience === 'department') {
    if (!body.departmentId) {
      return NextResponse.json(
        { error: 'departmentId is required when audience is "department"' },
        { status: 400 },
      )
    }
    const dept = await db.department.findFirst({
      where: { id: body.departmentId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!dept) {
      return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
    }
    departmentId = dept.id
  }

  const published = body.published !== false
  const pinned = !!body.pinned

  const created = await db.announcement.create({
    data: {
      organizationId: ctx.organizationId,
      title: body.title.trim(),
      body: body.body.trim(),
      audience,
      departmentId,
      published,
      pinned,
      publishedAt: published ? new Date() : new Date(0),
    },
  })

  // Fan-out: create in-app Notifications for all users matching the audience.
  // This is the "queue" — no real email/SMS/WhatsApp sending is performed.
  if (published) {
    try {
      let recipients: { id: string }[] = []
      if (audience === 'all') {
        recipients = await db.user.findMany({
          where: { organizationId: ctx.organizationId, active: true },
          select: { id: true },
        })
      } else if (audience === 'members') {
        recipients = await db.user.findMany({
          where: { organizationId: ctx.organizationId, active: true, role: 'member' },
          select: { id: true },
        })
      } else if (audience === 'leaders') {
        recipients = await db.user.findMany({
          where: {
            organizationId: ctx.organizationId,
            active: true,
            role: { in: ['pastor', 'church_admin', 'super_admin', 'department_head'] },
          },
          select: { id: true },
        })
      } else if (audience === 'department' && departmentId) {
        // Users scoped to that department + members in that department's memberships
        const [deptUsers, deptMemberships] = await Promise.all([
          db.user.findMany({
            where: { organizationId: ctx.organizationId, active: true, departmentId },
            select: { id: true },
          }),
          db.departmentMembership.findMany({
            where: { departmentId },
            select: { member: { select: { email: true } } },
          }),
        ])
        const userIds = new Set(deptUsers.map((u) => u.id))
        // Resolve members → users by email
        const emails = deptMemberships
          .map((dm) => dm.member.email)
          .filter(Boolean) as string[]
        if (emails.length) {
          const matching = await db.user.findMany({
            where: { organizationId: ctx.organizationId, active: true, email: { in: emails } },
            select: { id: true },
          })
          matching.forEach((u) => userIds.add(u.id))
        }
        recipients = Array.from(userIds).map((id) => ({ id }))
      }

      const link = `/announcements/${created.id}`
      const title = created.title.length > 60 ? created.title.slice(0, 57) + '…' : created.title
      const message = created.body.length > 140 ? created.body.slice(0, 137) + '…' : created.body

      if (recipients.length) {
        await db.notification.createMany({
          data: recipients.map((r) => ({
            userId: r.id,
            title,
            message,
            link,
            read: false,
          })),
        })
      }

      await audit(ctx, 'announcements.create', 'announcement', created.id, {
        title: created.title,
        audience,
        departmentId,
        published,
        pinned,
        recipients: recipients.length,
      })

      return NextResponse.json(
        { ...mapAnnouncement(created), notificationsQueued: recipients.length },
        { status: 201 },
      )
    } catch (e) {
      console.error('[announcements] fan-out error', e)
      await audit(ctx, 'announcements.create', 'announcement', created.id, {
        title: created.title,
        audience,
        fanOutError: true,
      })
      return NextResponse.json(
        { ...mapAnnouncement(created), notificationsQueued: 0, fanOutError: true },
        { status: 201 },
      )
    }
  }

  await audit(ctx, 'announcements.create', 'announcement', created.id, {
    title: created.title,
    audience,
    published: false,
  })
  return NextResponse.json({ ...mapAnnouncement(created), notificationsQueued: 0 }, { status: 201 })
})
