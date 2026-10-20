// ChurchOS — Announcement detail API
// GET    /api/announcements/[id]   — single announcement
// PATCH  /api/announcements/[id]   — update fields (title/body/audience/pinned/published)
// DELETE /api/announcements/[id]   — remove (audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_AUDIENCES = ['all', 'members', 'department', 'leaders'] as const
type Audience = (typeof VALID_AUDIENCES)[number]

type Ctx = Awaited<ReturnType<typeof requirePermission>>

async function getScoped(id: string, ctx: Ctx) {
  return db.announcement.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
}

export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('announcements', 'view')
    const { id } = await params
    const a = await getScoped(id, ctx)
    if (!a) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
    }
    return NextResponse.json({
      id: a.id,
      title: a.title,
      body: a.body,
      audience: a.audience,
      departmentId: a.departmentId,
      published: a.published,
      pinned: a.pinned,
      publishedAt: a.publishedAt,
      createdAt: a.createdAt,
    })
  },
)

interface PatchBody {
  title?: string
  body?: string
  audience?: string
  departmentId?: string | null
  published?: boolean
  pinned?: boolean
}

export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('announcements', 'update')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody
    const existing = await getScoped(id, ctx)
    if (!existing) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
      }
      data.title = body.title.trim()
    }
    if (body.body !== undefined) {
      if (typeof body.body !== 'string' || !body.body.trim()) {
        return NextResponse.json({ error: 'body cannot be empty' }, { status: 400 })
      }
      data.body = body.body.trim()
    }
    if (body.audience !== undefined) {
      if (!VALID_AUDIENCES.includes(body.audience as Audience)) {
        return NextResponse.json({ error: 'Invalid audience' }, { status: 400 })
      }
      data.audience = body.audience
      if (body.audience !== 'department') {
        data.departmentId = null
      }
    }
    if (body.departmentId !== undefined) {
      if (body.departmentId) {
        const dept = await db.department.findFirst({
          where: { id: body.departmentId, organizationId: ctx.organizationId },
          select: { id: true },
        })
        if (!dept) {
          return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
        }
        data.departmentId = dept.id
      } else {
        data.departmentId = null
      }
    }
    let fanOutCount = 0
    if (body.published !== undefined) {
      const nowPublishing = body.published === true && !existing.published
      data.published = body.published
      if (nowPublishing) {
        data.publishedAt = new Date()
      }
    }
    if (body.pinned !== undefined) {
      data.pinned = !!body.pinned
    }

    const updated = await db.announcement.update({ where: { id }, data })

    // If we just published for the first time, fan out notifications.
    if (body.published === true && !existing.published) {
      try {
        let recipients: { id: string }[] = []
        const aud = (data.audience as Audience) ?? (existing.audience as Audience)
        const deptId = (data.departmentId as string | null) ?? existing.departmentId
        if (aud === 'all') {
          recipients = await db.user.findMany({
            where: { organizationId: ctx.organizationId, active: true },
            select: { id: true },
          })
        } else if (aud === 'members') {
          recipients = await db.user.findMany({
            where: { organizationId: ctx.organizationId, active: true, role: 'member' },
            select: { id: true },
          })
        } else if (aud === 'leaders') {
          recipients = await db.user.findMany({
            where: {
              organizationId: ctx.organizationId,
              active: true,
              role: { in: ['pastor', 'church_admin', 'super_admin', 'department_head'] },
            },
            select: { id: true },
          })
        } else if (aud === 'department' && deptId) {
          const [deptUsers, deptMemberships] = await Promise.all([
            db.user.findMany({
              where: { organizationId: ctx.organizationId, active: true, departmentId: deptId },
              select: { id: true },
            }),
            db.departmentMembership.findMany({
              where: { departmentId: deptId },
              select: { member: { select: { email: true } } },
            }),
          ])
          const userIds = new Set(deptUsers.map((u) => u.id))
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
        const link = `/announcements/${updated.id}`
        const title =
          updated.title.length > 60 ? updated.title.slice(0, 57) + '…' : updated.title
        const message =
          updated.body.length > 140 ? updated.body.slice(0, 137) + '…' : updated.body
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
        fanOutCount = recipients.length
      } catch (e) {
        console.error('[announcements.patch] fan-out error', e)
      }
    }

    await audit(ctx, 'announcements.update', 'announcement', id, {
      fields: Object.keys(data),
      notificationsQueued: fanOutCount,
    })

    return NextResponse.json({ id: updated.id, ok: true, notificationsQueued: fanOutCount })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('announcements', 'delete')
    const { id } = await params
    const existing = await getScoped(id, ctx)
    if (!existing) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
    }
    await db.announcement.delete({ where: { id } })
    await audit(ctx, 'announcements.delete', 'announcement', id, {
      title: existing.title,
    })
    return NextResponse.json({ ok: true, id })
  },
)
