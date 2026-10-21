// ChurchOS — Notifications (in-app) API
// GET   /api/notifications         — current user's notifications (unread first, then by date)
// PATCH /api/notifications        — mark one or all as read
//        body: { id?: string, all?: boolean }
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const sp = req.nextUrl.searchParams
  const onlyUnread = sp.get('unread') === '1' || sp.get('unread') === 'true'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '30', 10) || 30))

  const where: any = { userId: ctx.user.id }
  if (onlyUnread) where.read = false

  const [items, total, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId: ctx.user.id, read: false } }),
  ])

  return NextResponse.json({
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      link: n.link,
      read: n.read,
      createdAt: n.createdAt,
    })),
    total,
    page,
    pageSize,
    unread: unreadCount,
  })
})

interface PatchBody {
  id?: string
  all?: boolean
}

export const PATCH = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const body = (await req.json().catch(() => ({}))) as PatchBody

  if (body.all) {
    const result = await db.notification.updateMany({
      where: { userId: ctx.user.id, read: false },
      data: { read: true },
    })
    await audit(ctx, 'notifications.markAllRead', 'notification', undefined, {
      count: result.count,
    })
    return NextResponse.json({ ok: true, updated: result.count })
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id is required (or pass all:true)' }, { status: 400 })
  }

  const existing = await db.notification.findFirst({
    where: { id: body.id, userId: ctx.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
  }
  const updated = await db.notification.update({
    where: { id: existing.id },
    data: { read: true },
  })
  return NextResponse.json({ ok: true, id: updated.id })
})
