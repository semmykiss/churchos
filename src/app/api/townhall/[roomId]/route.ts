// ChurchOS — Town Hall room detail API (UPGRADED)
import { rateLimit } from '@/lib/rate-limiter'
// GET    /api/townhall/[roomId]              — room + messages (with reactions, read receipts, attachments, pinned)
// POST   /api/townhall/[roomId]              — send a message (body, parentId, attachmentUrl, attachmentName, attachmentType)
// PATCH  /api/townhall/[roomId]              — edit message / pin / react / mark read / delete message
// DELETE /api/townhall/[roomId]              — delete room
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { broadcastEvent } from '@/lib/ai-events'
import { requireUser, audit, apiHandler, type AuthContext } from '@/lib/api'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor',
  'department_head', 'unit_leader',
])

async function loadRoom(ctx: AuthContext, roomId: string) {
  return db.chatRoom.findFirst({ where: { id: roomId, organizationId: ctx.organizationId } })
}

async function assertRoomAccess(ctx: AuthContext, room: { id: string; type: string; refId: string | null; organizationId: string }) {
  if (ctx.organizationId !== room.organizationId) return false
  if (room.type === 'townhall' || room.type === 'group') return true
  if (room.type === 'direct') return room.refId?.includes(ctx.user.id) ?? false
  if (room.type === 'role') return room.refId === ctx.role
  if (room.type === 'department') {
    if (ctx.user.departmentId === room.refId) return true
    const me = await db.member.findFirst({
      where: { account: { id: ctx.user.id }, organizationId: ctx.organizationId },
      include: { departmentMemberships: { select: { departmentId: true } } },
    })
    if (me?.departmentMemberships.some((dm) => dm.departmentId === room.refId)) return true
    const headed = await db.department.findFirst({ where: { organizationId: ctx.organizationId, headUserId: ctx.user.id, id: room.refId ?? undefined } })
    return !!headed
  }
  return false
}

// Parse @FirstName LastName mentions
async function resolveMentions(ctx: AuthContext, text: string): Promise<{ userId: string; name: string }[]> {
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
      where: { ...where, account: { isNot: null } },
      include: { account: { select: { id: true } } },
      take: 5,
    })
    for (const m of members) {
      if (m.account?.id && m.account.id !== ctx.user.id) {
        out.push({ userId: m.account.id, name: `${m.firstName} ${m.lastName}` })
      }
    }
  }
  return out
}

async function notifyRoom(ctx: AuthContext, room: { id: string; type: string; refId: string | null; organizationId: string }, senderId: string, body: string) {
  let recipients: string[] = []
  if (room.type === 'townhall' || room.type === 'group') {
    const users = await db.user.findMany({ where: { organizationId: ctx.organizationId, active: true, id: { not: senderId } }, select: { id: true } })
    recipients = users.map((u) => u.id)
  } else if (room.type === 'direct' && room.refId) {
    const ids = room.refId.split('_').filter((id) => id !== senderId)
    recipients = ids
  } else if (room.type === 'department' && room.refId) {
    const memberships = await db.departmentMembership.findMany({ where: { departmentId: room.refId }, include: { member: { include: { account: { select: { id: true } } } } } })
    recipients = memberships.map((m) => m.member.account?.id).filter(Boolean) as string[]
  } else if (room.type === 'role' && room.refId) {
    const users = await db.user.findMany({ where: { organizationId: ctx.organizationId, role: room.refId, active: true, id: { not: senderId } }, select: { id: true } })
    recipients = users.map((u) => u.id)
  }
  recipients = recipients.filter((id) => id && id !== senderId)
  if (recipients.length === 0) return

  // Mention notifications (higher priority)
  const mentionTargets = await resolveMentions(ctx, body)
  const mentionIds = new Set(mentionTargets.map((m) => m.userId))

  const data = recipients.map((uid) => ({
    userId: uid,
    title: mentionIds.has(uid) ? 'You were mentioned in Town Hall' : 'New message in Town Hall',
    message: mentionIds.has(uid)
      ? `${ctx.user.name} mentioned you: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`
      : `${ctx.user.name}: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`,
    link: `townhall:${room.id}`,
  }))
  await db.notification.createMany({ data }).catch(() => null)
}

// ---- GET: room + messages with reactions, read receipts, attachments, pinned ----
export const GET = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) => {
  const ctx = await requireUser()
  if (!rateLimit(ctx.user.id, '[roomId]', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const { roomId } = await params
  const room = await loadRoom(ctx, roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (!(await assertRoomAccess(ctx, room))) {
    return NextResponse.json({ error: 'You do not have access to this room' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const afterId = sp.get('afterId')
  const search = sp.get('q')?.trim() ?? ''
  const limit = Math.min(200, Math.max(20, parseInt(sp.get('limit') ?? '100', 10) || 100))

  const where: any = { roomId, deletedAt: null }
  if (afterId) {
    const pivot = await db.chatMessage.findUnique({ where: { id: afterId }, select: { createdAt: true } })
    if (pivot) where.createdAt = { gt: pivot.createdAt }
  }
  if (search) where.body = { contains: search }

  const [topLevel, replies] = await Promise.all([
    db.chatMessage.findMany({
      where: { ...where, parentId: null },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'asc' }],
      take: limit,
      include: {
        reactions: { select: { id: true, userId: true, emoji: true } },
        readReceipts: { select: { userId: true } },
      },
    }),
    db.chatMessage.findMany({
      where: { roomId, parentId: { not: null }, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        reactions: { select: { id: true, userId: true, emoji: true } },
        readReceipts: { select: { userId: true } },
      },
    }),
  ])

  const repliesByParent = new Map<string, typeof replies>()
  for (const r of replies) {
    if (!r.parentId) continue
    const list = repliesByParent.get(r.parentId) ?? []
    list.push(r)
    repliesByParent.set(r.parentId, list)
  }

  // Mark notifications for this room as read
  await db.notification.updateMany({
    where: { userId: ctx.user.id, read: false, link: `townhall:${roomId}` },
    data: { read: true },
  }).catch(() => null)

  // Auto-create read receipts for the current user on all loaded messages
  const allMessageIds = [...topLevel, ...replies].map((m) => m.id)
  if (allMessageIds.length > 0) {
    const existingReceipts = await db.messageReadReceipt.findMany({
      where: { messageId: { in: allMessageIds }, userId: ctx.user.id },
      select: { messageId: true },
    })
    const existingSet = new Set(existingReceipts.map((r) => r.messageId))
    const newReceipts = allMessageIds.filter((id) => !existingSet.has(id)).map((messageId) => ({ messageId, userId: ctx.user.id }))
    if (newReceipts.length > 0) {
      await db.messageReadReceipt.createMany({ data: newReceipts }).catch(() => null)
    }
  }

  // ---- Expected room participants (mirrors notifyRoom's recipient fan-out) ----
  // Used so readByEveryone is only true when ALL non-sender participants have
  // read the message — not merely the first single reader.
  let participantIds: string[] = []
  if (room.type === 'direct' && room.refId) {
    participantIds = room.refId.split('_').filter(Boolean)
  } else if (room.type === 'townhall' || room.type === 'group') {
    const users = await db.user.findMany({ where: { organizationId: ctx.organizationId, active: true }, select: { id: true } })
    participantIds = users.map((u) => u.id)
  } else if (room.type === 'department' && room.refId) {
    const memberships = await db.departmentMembership.findMany({
      where: { departmentId: room.refId },
      include: { member: { include: { account: { select: { id: true } } } } },
    })
    participantIds = memberships.map((m) => m.member.account?.id).filter(Boolean) as string[]
  } else if (room.type === 'role' && room.refId) {
    const users = await db.user.findMany({ where: { organizationId: ctx.organizationId, role: room.refId, active: true }, select: { id: true } })
    participantIds = users.map((u) => u.id)
  }
  const participants = new Set(participantIds)

  const messages = [...topLevel, ...replies].map((m) => {
    const isOwn = m.senderId === ctx.user.id
    const readers = m.readReceipts.map((r) => r.userId).filter((uid) => uid !== m.senderId)
    const readerSet = new Set(readers)
    // "Everyone" = every non-sender participant has a read receipt for this message.
    const nonSenderParticipants = Array.from(participants).filter((id) => id !== m.senderId)
    const readByEveryone =
      isOwn && nonSenderParticipants.length > 0 && nonSenderParticipants.every((id) => readerSet.has(id))
    return {
      id: m.id,
      roomId: m.roomId,
      senderId: m.senderId,
      senderName: m.senderName,
      body: m.body,
      parentId: m.parentId,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      isPinned: m.isPinned,
      attachmentUrl: m.attachmentUrl,
      attachmentName: m.attachmentName,
      attachmentType: m.attachmentType,
      reactions: m.reactions.reduce((acc: Record<string, { count: number; userIds: string[] }>, r) => {
        if (!acc[r.emoji]) acc[r.emoji] = { count: 0, userIds: [] }
        acc[r.emoji].count += 1
        acc[r.emoji].userIds.push(r.userId)
        return acc
      }, {}),
      readBy: readers.length,
      readByEveryone,
      isOwn,
    }
  })

  const pinnedMessages = messages.filter((m) => m.isPinned && !m.parentId)

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
    messages: messages.filter((m) => !m.parentId).map((m) => ({
      ...m,
      replies: messages.filter((r) => r.parentId === m.id).map((r) => ({ id: r.id, senderId: r.senderId, senderName: r.senderName, body: r.body, createdAt: r.createdAt, editedAt: r.editedAt, reactions: r.reactions, isOwn: r.isOwn })),
    })),
    pinnedMessages: pinnedMessages.map((m) => ({ id: m.id, senderName: m.senderName, body: m.body, createdAt: m.createdAt })),
  })
})

// ---- POST: send a message ----
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) => {
  const ctx = await requireUser()
  if (!rateLimit(ctx.user.id, '[roomId]', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const { roomId } = await params
  const room = await loadRoom(ctx, roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (!(await assertRoomAccess(ctx, room))) {
    return NextResponse.json({ error: 'You do not have access to this room' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const text = (body.body ?? '').trim()
  const parentId = body.parentId ?? null
  const attachmentUrl = body.attachmentUrl ?? null
  const attachmentName = body.attachmentName ?? null
  const attachmentType = body.attachmentType ?? null

  if (!text && !attachmentUrl) {
    return NextResponse.json({ error: 'Message body or attachment is required' }, { status: 400 })
  }

  const msg = await db.chatMessage.create({
    data: {
      organizationId: ctx.organizationId,
      roomId,
      senderId: ctx.user.id,
      senderName: ctx.user.name,
      body: text || '(attachment)',
      parentId,
      attachmentUrl,
      attachmentName,
      attachmentType,
    },
  })

  // Update room lastMessage
  await db.chatRoom.update({
    where: { id: roomId },
    data: {
      lastMessageAt: new Date(),
      lastMessagePreview: text ? text.slice(0, 80) : `📎 ${attachmentName ?? 'attachment'}`,
    },
  })

  // Fan-out notifications
  await notifyRoom(ctx, room, ctx.user.id, text || attachmentName || 'sent an attachment')

  await audit(ctx, 'townhall.message.send', 'chatMessage', msg.id, { roomId })

  // Broadcast to the AI assistant live events feed
  await broadcastEvent(ctx, {
    module: 'townhall',
    action: 'send',
    title: 'New townhall message',
    message: `${ctx.user.name} posted in ${room.name}: "${(text || attachmentName || 'attachment').slice(0, 80)}${(text || '').length > 80 ? '…' : ''}"`,
    refId: room.id,
    refType: 'chatRoom',
  })

  return NextResponse.json({
    id: msg.id,
    senderId: msg.senderId,
    senderName: msg.senderName,
    body: msg.body,
    parentId: msg.parentId,
    createdAt: msg.createdAt,
    attachmentUrl: msg.attachmentUrl,
    attachmentName: msg.attachmentName,
    attachmentType: msg.attachmentType,
  }, { status: 201 })
})

// ---- PATCH: edit / delete / pin / react / mark read ----
export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) => {
  const ctx = await requireUser()
  if (!rateLimit(ctx.user.id, '[roomId]', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const { roomId } = await params
  const room = await loadRoom(ctx, roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (!(await assertRoomAccess(ctx, room))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { action, messageId } = body

  if (!messageId) return NextResponse.json({ error: 'messageId is required' }, { status: 400 })

  const msg = await db.chatMessage.findFirst({ where: { id: messageId, roomId, organizationId: ctx.organizationId, deletedAt: null } })
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  // ---- EDIT MESSAGE ----
  if (action === 'edit') {
    if (msg.senderId !== ctx.user.id) return NextResponse.json({ error: 'You can only edit your own messages' }, { status: 403 })
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    if (msg.createdAt < fiveMinAgo) return NextResponse.json({ error: 'Messages can only be edited within 5 minutes' }, { status: 403 })
    const newText = (body.newBody ?? '').trim()
    if (!newText) return NextResponse.json({ error: 'New body is required' }, { status: 400 })
    await db.chatMessage.update({ where: { id: messageId }, data: { body: newText, editedAt: new Date() } })
    await audit(ctx, 'townhall.message.edit', 'chatMessage', messageId, { oldBody: msg.body.slice(0, 50) })
    return NextResponse.json({ ok: true, id: messageId, body: newText, editedAt: new Date().toISOString() })
  }

  // ---- DELETE MESSAGE (soft delete) ----
  if (action === 'delete') {
    if (msg.senderId !== ctx.user.id && !STAFF_ROLES.has(ctx.role)) {
      return NextResponse.json({ error: 'You can only delete your own messages' }, { status: 403 })
    }
    await db.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: '🗑️ This message was deleted' } })
    await audit(ctx, 'townhall.message.delete', 'chatMessage', messageId)
    return NextResponse.json({ ok: true, id: messageId })
  }

  // ---- PIN / UNPIN MESSAGE ----
  if (action === 'pin' || action === 'unpin') {
    if (!STAFF_ROLES.has(ctx.role) && msg.senderId !== ctx.user.id) {
      return NextResponse.json({ error: 'Only staff or message authors can pin' }, { status: 403 })
    }
    await db.chatMessage.update({ where: { id: messageId }, data: { isPinned: action === 'pin' } })
    await audit(ctx, `townhall.message.${action}`, 'chatMessage', messageId)
    return NextResponse.json({ ok: true, id: messageId, isPinned: action === 'pin' })
  }

  // ---- TOGGLE REACTION ----
  if (action === 'react') {
    const emoji = body.emoji
    if (!emoji) return NextResponse.json({ error: 'emoji is required' }, { status: 400 })
    const existing = await db.messageReaction.findFirst({ where: { messageId, userId: ctx.user.id, emoji } })
    if (existing) {
      await db.messageReaction.delete({ where: { id: existing.id } })
      return NextResponse.json({ ok: true, action: 'removed', emoji })
    }
    await db.messageReaction.create({ data: { messageId, userId: ctx.user.id, emoji } })
    return NextResponse.json({ ok: true, action: 'added', emoji })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
})

// ---- DELETE: delete room ----
export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) => {
  const ctx = await requireUser()
  if (!rateLimit(ctx.user.id, '[roomId]', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const { roomId } = await params
  const room = await loadRoom(ctx, roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  const canManage = room.createdBy === ctx.user.id || STAFF_ROLES.has(ctx.role)
  if (!canManage) return NextResponse.json({ error: 'Only the room creator or staff can delete rooms' }, { status: 403 })
  await db.chatRoom.delete({ where: { id: roomId } })
  await audit(ctx, 'townhall.room.delete', 'chatRoom', roomId)
  return NextResponse.json({ ok: true })
})
