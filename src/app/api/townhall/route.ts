// ChurchOS — Town Hall (chat rooms) API
import { rateLimit } from '@/lib/rate-limiter'
// GET   /api/townhall                  — list rooms visible to current user
// POST  /api/townhall                  — create a room
//   - Members can ONLY create direct rooms (type=direct + recipientMemberId)
//   - Staff (pastor, church_admin, super_admin, department_head, unit_leader)
//     can create department/role/group rooms
//   - Department heads can create departmental rooms only for their own department
//
// Room visibility rules:
//   townhall  → everyone in org
//   department→ members of that department (via DepartmentMembership) + dept-scoped staff
//   role      → users with that role
//   group     → everyone in org (open)
//   direct    → the two participants (refId = sorted user ids joined by '_')
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, audit, apiHandler, type AuthContext } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor',
  'department_head', 'unit_leader',
])
// department_assistant is intentionally NOT in the staff set (cannot create non-direct rooms).

const ROOM_TYPES = new Set(['townhall', 'department', 'role', 'group', 'direct'])

// Build the list of room IDs the user is permitted to see.
async function getVisibleRooms(ctx: AuthContext) {
  const orgId = ctx.organizationId
  const userId = ctx.user.id
  const role = ctx.role

  // 1. Open rooms (townhall + group)
  const openRooms = await db.chatRoom.findMany({
    where: { organizationId: orgId, type: { in: ['townhall', 'group'] } },
  })

  // 2. Department rooms — those whose refId matches a department the user belongs to
  //    (as a department member via DepartmentMembership, or as the dept's User.departmentId).
  const userDeptIds = new Set<string>()
  if (ctx.user.departmentId) userDeptIds.add(ctx.user.departmentId)
  const memberships = await db.departmentMembership.findMany({
    where: { memberId: { in: await db.member.findMany({ where: { account: { id: userId } }, select: { id: true } }).then((m) => m.map((x) => x.id)) } },
    select: { departmentId: true },
  })
  memberships.forEach((m) => userDeptIds.add(m.departmentId))
  // Also include departments this user heads
  const headedDepts = await db.department.findMany({
    where: { organizationId: orgId, headUserId: userId },
    select: { id: true },
  })
  headedDepts.forEach((d) => userDeptIds.add(d.id))

  const deptRooms = userDeptIds.size
    ? await db.chatRoom.findMany({
        where: { organizationId: orgId, type: 'department', refId: { in: Array.from(userDeptIds) } },
      })
    : []

  // 3. Role rooms — those whose refId matches the user's role
  const roleRooms = await db.chatRoom.findMany({
    where: { organizationId: orgId, type: 'role', refId: role },
  })

  // 4. Direct rooms — those whose refId includes the user's id (sorted pair)
  const directRooms = await db.chatRoom.findMany({
    where: { organizationId: orgId, type: 'direct' },
  })
  const myDirectRooms = directRooms.filter((r) => r.refId?.includes(userId))

  // Dedupe
  const seen = new Set<string>()
  const rooms = [...openRooms, ...deptRooms, ...roleRooms, ...myDirectRooms].filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })

  return rooms
}

// Hydrated room shape returned to the client (room fields + last-message
// preview + unread count).
interface RoomSummary {
  id: string
  name: string
  description: string | null
  type: string
  refId: string | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
  lastMessage: { id: string; body: string; senderName: string; senderId: string; createdAt: Date } | null
  unread: number
}

// Hydrate last message preview + unread count for each room.
async function withLastMessage(rooms: Awaited<ReturnType<typeof getVisibleRooms>>, ctx: AuthContext) {
  const userId = ctx.user.id
  const ids = rooms.map((r) => r.id)
  if (ids.length === 0) return []

  const lastMessages = await db.chatMessage.findMany({
    where: { roomId: { in: ids }, parentId: null },
    orderBy: [{ createdAt: 'desc' }],
    distinct: ['roomId'],
    take: ids.length * 2,
  })

  // For unread count: messages newer than user's last view (approx: not authored by user, createdAt > cutoff).
  // Use Notification read=false on room message events as proxy. Simpler: count messages authored by others
  // after the latest message authored by the user in that room (or all if user never posted).
  const result: RoomSummary[] = []
  for (const room of rooms) {
    const last = lastMessages.find((m) => m.roomId === room.id)
    let unread = 0
    if (last && last.senderId !== userId) {
      // Approximate unread: messages in this room after the user's latest message (if any).
      const myLast = await db.chatMessage.findFirst({
        where: { roomId: room.id, senderId: userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      const cutoff = myLast?.createdAt ?? new Date(0)
      unread = await db.chatMessage.count({
        where: {
          roomId: room.id,
          senderId: { not: userId },
          createdAt: { gt: cutoff },
        },
      })
    }
    result.push({
      id: room.id,
      name: room.name,
      description: room.description,
      type: room.type,
      refId: room.refId,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      lastMessage: last
        ? {
            id: last.id,
            body: last.body,
            senderName: last.senderName,
            senderId: last.senderId,
            createdAt: last.createdAt,
          }
        : null,
      unread,
    })
  }
  // Sort: rooms with last message first (newest first), then empty rooms by name.
  result.sort((a, b) => {
    if (a.lastMessage && b.lastMessage) {
      return new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
    }
    if (a.lastMessage) return -1
    if (b.lastMessage) return 1
    return a.name.localeCompare(b.name)
  })
  return result
}

export const GET = apiHandler(async (_req: NextRequest) => {
  const ctx = await requireUser()
  if (!rateLimit(ctx.user.id, 'townhall', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const rooms = await getVisibleRooms(ctx)
  const hydrated = await withLastMessage(rooms, ctx)
  return NextResponse.json({ rooms: hydrated })
})

interface CreateBody {
  name?: string
  description?: string
  type?: string
  refId?: string
  recipientMemberId?: string
}

function makeDirectRefId(a: string, b: string) {
  return [a, b].sort().join('_')
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  if (!rateLimit(ctx.user.id, 'townhall', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const body = (await req.json().catch(() => ({}))) as CreateBody
  const type = (body.type ?? 'group').toString()
  if (!ROOM_TYPES.has(type)) {
    return NextResponse.json({ error: 'Invalid room type' }, { status: 400 })
  }
  const role = ctx.role
  const isStaff = STAFF_ROLES.has(role)

  // --- DIRECT ROOM (any authenticated user) ---
  if (type === 'direct') {
    const recipientMemberId = body.recipientMemberId?.toString().trim()
    if (!recipientMemberId) {
      return NextResponse.json({ error: 'recipientMemberId is required for direct rooms' }, { status: 400 })
    }
    // Resolve recipient's user account via Member.account
    const recipientMember = await db.member.findFirst({
      where: { id: recipientMemberId, organizationId: ctx.organizationId },
      include: { account: { select: { id: true, name: true } } },
    })
    if (!recipientMember || !recipientMember.account) {
      return NextResponse.json({ error: 'Recipient not found or has no user account' }, { status: 404 })
    }
    const me = await db.member.findFirst({
      where: { account: { id: ctx.user.id }, organizationId: ctx.organizationId },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!me) {
      return NextResponse.json({ error: 'Your account is not linked to a member profile' }, { status: 400 })
    }
    if (recipientMember.id === me.id) {
      return NextResponse.json({ error: 'Cannot create a direct room with yourself' }, { status: 400 })
    }
    const refId = makeDirectRefId(ctx.user.id, recipientMember.account.id)
    // Reuse existing direct room between these two users if any
    const existing = await db.chatRoom.findFirst({
      where: { organizationId: ctx.organizationId, type: 'direct', refId },
    })
    if (existing) {
      await audit(ctx, 'townhall.room.reuse', 'chat_room', existing.id, { refId })
      return NextResponse.json(existing, { status: 200 })
    }
    const name = `${me.firstName} ${recipientMember.firstName}`
    const created = await db.chatRoom.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        type: 'direct',
        refId,
        createdBy: ctx.user.id,
      },
    })
    await audit(ctx, 'townhall.room.create', 'chat_room', created.id, { type, name })
    return NextResponse.json(created, { status: 201 })
  }

  // --- NON-DIRECT ROOMS (staff only) ---
  if (!isStaff) {
    return NextResponse.json(
      { error: 'Members can only create direct rooms.' },
      { status: 403 },
    )
  }

  const name = body.name?.toString().trim()
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  let refId: string | null = null

  if (type === 'department') {
    const deptId = body.refId?.toString().trim()
    if (!deptId) {
      return NextResponse.json({ error: 'refId (departmentId) is required for department rooms' }, { status: 400 })
    }
    const dept = await db.department.findFirst({
      where: { id: deptId, organizationId: ctx.organizationId },
      select: { id: true, headUserId: true },
    })
    if (!dept) {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 })
    }
    // Department heads can only create rooms for their own department
    if (role === 'department_head' && dept.headUserId !== ctx.user.id) {
      return NextResponse.json(
        { error: 'Department heads can only create rooms for their own department.' },
        { status: 403 },
      )
    }
    refId = dept.id
  } else if (type === 'role') {
    const refRole = body.refId?.toString().trim()
    if (!refId && !refRole) {
      return NextResponse.json({ error: 'refId (role name) is required for role rooms' }, { status: 400 })
    }
    refId = refRole ?? null
  } else if (type === 'group') {
    refId = null
  } else if (type === 'townhall') {
    // Only super_admin / church_admin / pastor can recreate the org-wide townhall
    if (!['super_admin', 'church_admin', 'pastor'].includes(role)) {
      return NextResponse.json({ error: 'Insufficient role for townhall room' }, { status: 403 })
    }
    refId = null
  }

  // Prevent duplicate (same type + refId) rooms
  const dupWhere: any = { organizationId: ctx.organizationId, type }
  if (refId) dupWhere.refId = refId
  else dupWhere.refId = null
  const dup = await db.chatRoom.findFirst({ where: dupWhere })
  if (dup) {
    return NextResponse.json(dup, { status: 200 })
  }

  const created = await db.chatRoom.create({
    data: {
      organizationId: ctx.organizationId,
      name,
      description: body.description?.toString().trim() || null,
      type,
      refId,
      createdBy: ctx.user.id,
    },
  })
  await audit(ctx, 'townhall.room.create', 'chat_room', created.id, {
    type, name, refId,
  })
  return NextResponse.json(created, { status: 201 })
})
