// ChurchOS — Town Hall room detail API
// GET    /api/townhall/[roomId]   — room + messages (with replies, threaded)
// POST   /api/townhall/[roomId]   — send a message (body, optional parentId for threaded reply)
//                                  → fan-out notifications to relevant users (mentions parsed too)
// DELETE /api/townhall/[roomId]   — delete room (creator + staff with manage)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, audit, apiHandler, type AuthContext } from '@/lib/api'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor',
  'department_head', 'unit_leader',
])
const MANAGE_ROLES = new Set(['super_admin', 'church_admin'])

// Verify the caller may access this room.
async function assertRoomAccess(ctx: AuthContext, room: { id: string; type: string; refId: string | null; organizationId: string }) {
  if (ctx.organizationId !== room.organizationId) return false
  const userId = ctx.user.id
  if (room.type === 'townhall' || room.type === 'group') return true
  if (room.type === 'direct') {
    return room.refId?.includes(userId) ?? false
  }
  if (room.type === 'role') {
    return room.refId === ctx.role
  }
  if (room.type === 'department') {
    // User must be a member of that department
    const deptId = room.refId
    if (!deptId) return false
    if (ctx.user.departmentId === deptId) return true
    // DepartmentMembership via Member.account
    const me = await db.member.findFirst({
      where: { account: { id: userId }, organizationId: ctx.organizationId },
      include: { departmentMemberships: { select: { departmentId: true } } },
    })
    if (me?.departmentMemberships.some((dm) => dm.departmentId === deptId)) return true
    const headed = await db.department.findFirst({
      where: { id: deptId, headUserId: userId },
      select: { id: true },
    })
    return !!headed
  }
  return false
}

async function loadRoom(ctx: AuthContext, roomId: string) {
  const room = await db.chatRoom.findFirst({
    where: { id: roomId, organizationId: ctx.organizationId },
  })
  if (!room) return null
  return room
}

export const GET = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) => {
  const ctx = await requireUser()
  const { roomId } = await params
  const room = await loadRoom(ctx, roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (!(await assertRoomAccess(ctx, room))) {
    return NextResponse.json({ error: 'You do not have access to this room' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const afterId = sp.get('afterId')
  const limit = Math.min(200, Math.max(20, parseInt(sp.get('limit') ?? '100', 10) || 100))

  // Load top-level messages (parentId = null) + their replies (2-level deep).
  const where: any = { roomId }
  if (afterId) {
    const pivot = await db.chatMessage.findUnique({ where: { id: afterId }, select: { createdAt: true } })
    if (pivot) where.createdAt = { gt: pivot.createdAt }
  }
  const topLevel = await db.chatMessage.findMany({
    where: { ...where, parentId: null },
    orderBy: [{ createdAt: 'asc' }],
    take: limit,
  })
  const replyWhere = roomId ? { roomId, parentId: { not: null } } : { roomId }
  const replies = await db.chatMessage.findMany({
    where: replyWhere,
    orderBy: [{ createdAt: 'asc' }],
  })
  const repliesByParent = new Map<string, typeof replies>()
  for (const r of replies) {
    if (!r.parentId) continue
    const list = repliesByParent.get(r.parentId) ?? []
    list.push(r)
    repliesByParent.set(r.parentId, list)
  }

  // Mark notifications for this room's messages as read for the current user
  // (notifications created with link = `townhall:{roomId}`)
  await db.notification.updateMany({
    where: { userId: ctx.user.id, read: false, link: `townhall:${roomId}` },
    data: { read: true },
  }).catch(() => null)

  const messages = topLevel.map((m) => ({
    id: m.id,
    roomId: m.roomId,
    senderId: m.senderId,
    senderName: m.senderName,
    body: m.body,
    parentId: m.parentId,
    createdAt: m.createdAt,
    replies: (repliesByParent.get(m.id) ?? []).map((r) => ({
      id: r.id,
      senderId: r.senderId,
      senderName: r.senderName,
      body: r.body,
      createdAt: r.createdAt,
    })),
  }))

  return NextResponse.json({
    room: {
      id: room.id,
      name: room.name,
      description: room.description,
      type: room.type,
      refId: room.refId,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    },
    messages,
  })
})

interface PostBody {
  body?: string
  parentId?: string | null
}

// Parse @FirstName LastName mentions → returns list of candidate member user IDs in org.
async function resolveMentions(ctx: AuthContext, text: string): Promise<{ userId: string; name: string }[]> {
  // Match tokens like "@FirstName LastName" (greedy on word chars/spaces until next non-mention)
  const mentions = Array.from(text.matchAll(/@([A-Za-z][A-Za-z'-]+(?:\s[A-Za-z][A-Za-z'-]+)?)/g))
  if (mentions.length === 0) return []
  const names = Array.from(new Set(mentions.map((m) => m[1].trim())))
  const out: { userId: string; name: string }[] = []
  for (const name of names) {
    const parts = name.split(/\s+/)
    const where = parts.length === 1
      ? { organizationId: ctx.organizationId, OR: [{ firstName: { contains: parts[0] } }, { preferredName: { contains: parts[0] } }] }
      : { organizationId: ctx.organizationId, AND: [{ firstName: { contains: parts[0] } }, { lastName: { contains: parts[1] } }] }
    const members = await db.member.findMany({
      where,
      include: { account: { select: { id: true } } },
      take: 5,
    })
    for (const m of members) {
      if (m.account?.id && m.account.id !== ctx.user.id) {
        out.push({ userId: m.account.id, name: `${m.firstName} ${m.lastName}` })
      }
    }
  }
  // Dedupe by userId
  const seen = new Set<string>()
  return out.filter((m) => (seen.has(m.userId) ? false : (seen.add(m.userId), true)))
}

// Build the list of recipient user IDs for a room-message notification fan-out.
async function collectRecipients(
  ctx: AuthContext,
  room: { id: string; type: string; refId: string | null; organizationId: string },
): Promise<string[]> {
  if (room.type === 'townhall' || room.type === 'group') {
    const users = await db.user.findMany({
      where: { organizationId: ctx.organizationId, active: true },
      select: { id: true },
    })
    return users.map((u) => u.id).filter((id) => id !== ctx.user.id)
  }
  if (room.type === 'direct') {
    const ids = (room.refId ?? '').split('_')
    return ids.filter((id) => id && id !== ctx.user.id)
  }
  if (room.type === 'role') {
    const users = await db.user.findMany({
      where: { organizationId: ctx.organizationId, active: true, role: room.refId ?? undefined },
      select: { id: true },
    })
    return users.map((u) => u.id).filter((id) => id !== ctx.user.id)
  }
  if (room.type === 'department') {
    const deptId = room.refId
    if (!deptId) return []
    // Members of the department + dept head + dept users
    const memberships = await db.departmentMembership.findMany({
      where: { departmentId: deptId },
      include: { member: { include: { account: { select: { id: true } } } } },
    })
    const ids = new Set<string>()
    memberships.forEach((dm) => {
      if (dm.member.account?.id) ids.add(dm.member.account.id)
    })
    const dept = await db.department.findUnique({
      where: { id: deptId },
      include: { members: { select: { id: true } }, head: { select: { id: true } } },
    })
    dept?.members.forEach((u) => ids.add(u.id))
    if (dept?.head?.id) ids.add(dept.head.id)
    ids.delete(ctx.user.id)
    return Array.from(ids)
  }
  return []
}

async function fanoutNotifications(
  ctx: AuthContext,
  room: { id: string; type: string; refId: string | null; organizationId: string; name: string },
  senderName: string,
  preview: string,
  recipients: string[],
  mentionedUsers: { userId: string; name: string }[],
) {
  const link = `townhall:${room.id}`
  // Bulk-create base notifications
  if (recipients.length) {
    await db.notification.createMany({
      data: recipients.map((uid) => ({
        userId: uid,
        organizationId: ctx.organizationId,
        title: `${room.type === 'direct' ? 'New direct message' : room.name}`,
        message: `${senderName}: ${preview.slice(0, 160)}`,
        link,
      })),
    }).catch((e) => console.error('[townhall.notify] base fanout failed', e))
  }
  // Mention notifications (separate title)
  if (mentionedUsers.length) {
    await db.notification.createMany({
      data: mentionedUsers.map((m) => ({
        userId: m.userId,
        organizationId: ctx.organizationId,
        title: `You were mentioned in ${room.name}`,
        message: `${senderName}: ${preview.slice(0, 160)}`,
        link,
      })),
    }).catch((e) => console.error('[townhall.notify] mention fanout failed', e))
  }
}

export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) => {
  const ctx = await requireUser()
  const { roomId } = await params
  const body = (await req.json().catch(() => ({}))) as PostBody
  const text = (body.body ?? '').toString().trim()
  if (!text) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: 'Message too long (4000 chars max)' }, { status: 400 })
  }

  const room = await loadRoom(ctx, roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (!(await assertRoomAccess(ctx, room))) {
    return NextResponse.json({ error: 'You do not have access to this room' }, { status: 403 })
  }

  // Validate parentId (if provided) belongs to same room
  let parentId: string | null = null
  if (body.parentId) {
    const parent = await db.chatMessage.findFirst({
      where: { id: body.parentId, roomId, organizationId: ctx.organizationId },
      select: { id: true, parentId: true },
    })
    if (!parent) {
      return NextResponse.json({ error: 'Parent message not found' }, { status: 404 })
    }
    if (parent.parentId) {
      return NextResponse.json({ error: 'Cannot reply to a reply (max 2 levels)' }, { status: 400 })
    }
    parentId = parent.id
  }

  const created = await db.chatMessage.create({
    data: {
      organizationId: ctx.organizationId,
      roomId,
      senderId: ctx.user.id,
      senderName: ctx.user.name,
      body: text,
      parentId,
    },
  })

  // Touch room.updatedAt so it sorts first in lists
  await db.chatRoom.update({ where: { id: roomId }, data: { updatedAt: new Date() } })

  // Fan-out notifications + mentions
  const recipients = await collectRecipients(ctx, room)
  const mentioned = await resolveMentions(ctx, text)
  await fanoutNotifications(ctx, room, ctx.user.name, text, recipients, mentioned)

  await audit(ctx, 'townhall.message.send', 'chat_message', created.id, {
    roomId,
    parentId,
    mentioned: mentioned.map((m) => m.userId),
  })
  return NextResponse.json(created, { status: 201 })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) => {
  const ctx = await requireUser()
  const { roomId } = await params
  const room = await loadRoom(ctx, roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const isCreator = room.createdBy === ctx.user.id
  const canManage = MANAGE_ROLES.has(ctx.role)
  if (!isCreator && !canManage) {
    return NextResponse.json({ error: 'Only the room creator or an admin can delete this room' }, { status: 403 })
  }
  await db.chatRoom.delete({ where: { id: roomId } })
  await audit(ctx, 'townhall.room.delete', 'chat_room', roomId, { type: room.type, name: room.name })
  return NextResponse.json({ ok: true, id: roomId })
})

// Re-export so server tools can introspect (harmless)
export const _STAFF_ROLES = STAFF_ROLES
export const _MANAGE_ROLES = MANAGE_ROLES
