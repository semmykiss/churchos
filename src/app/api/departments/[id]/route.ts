// ChurchOS — Department detail API
// GET    /api/departments/[id]   — full department with memberships + head + units + tasks
// PATCH  /api/departments/[id]   — update fields AND manage memberships (addMemberId/removeMemberId/memberRole)
// DELETE /api/departments/[id]   — delete department, audit
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { isScopedRole } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_MEMBER_ROLES = ['leader', 'assistant', 'secretary', 'member'] as const

type Ctx = Awaited<ReturnType<typeof requirePermission>>

async function getScopedDepartment(_ctx: Ctx, id: string) {
  // Org-scoped always. Scoped roles are verified separately after fetch.
  return db.department.findFirst({
    where: { id, organizationId: _ctx.organizationId },
    include: {
      head: { select: { id: true, name: true, email: true, avatarUrl: true } },
      memberships: {
        include: {
          member: {
            select: {
              id: true, firstName: true, lastName: true, preferredName: true,
              email: true, phone: true, photoUrl: true, status: true, memberId: true,
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      },
      units: { orderBy: { name: 'asc' } },
      tasks: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, title: true, status: true, priority: true, dueDate: true },
      },
      _count: { select: { memberships: true, tasks: true, events: true, units: true } },
    },
  })
}

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('departments', 'view')
  const { id } = await params

  const dept = await getScopedDepartment(ctx, id)
  if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

  // For scoped roles, restrict to their own department
  if (isScopedRole(ctx.role) && ctx.departmentId && ctx.departmentId !== id) {
    return NextResponse.json({ error: 'You can only access your own department.' }, { status: 403 })
  }

  return NextResponse.json({
    id: dept.id,
    name: dept.name,
    description: dept.description,
    color: dept.color,
    createdAt: dept.createdAt,
    updatedAt: dept.updatedAt,
    head: dept.head,
    memberships: dept.memberships.map((m) => ({
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      member: {
        id: m.member.id,
        firstName: m.member.firstName,
        lastName: m.member.lastName,
        preferredName: m.member.preferredName,
        email: m.member.email,
        phone: m.member.phone,
        photoUrl: m.member.photoUrl,
        status: m.member.status,
        memberId: m.member.memberId,
      },
    })),
    units: dept.units,
    tasks: dept.tasks,
    counts: {
      members: dept._count.memberships,
      tasks: dept._count.tasks,
      events: dept._count.events,
      units: dept._count.units,
    },
  })
})

interface PatchBody {
  name?: string
  description?: string | null
  color?: string | null
  headUserId?: string | null
  // Membership management (kept inside this route per task constraints)
  addMemberId?: string
  removeMemberId?: string
  memberRole?: string
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('departments', 'update')
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const existing = await db.department.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

  // Scoped role check — only their own department
  if (isScopedRole(ctx.role) && ctx.departmentId && ctx.departmentId !== id) {
    return NextResponse.json({ error: 'You can only update your own department.' }, { status: 403 })
  }

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    data.name = body.name.trim()
  }
  if (body.description !== undefined) data.description = body.description?.trim() || null
  if (body.color !== undefined) data.color = body.color?.trim() || null
  if (body.headUserId !== undefined) {
    if (body.headUserId) {
      const head = await db.user.findFirst({
        where: { id: body.headUserId, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (!head) return NextResponse.json({ error: 'Invalid headUserId' }, { status: 400 })
      // headUserId is @unique — clear from previous department if needed
      const prevOwner = await db.department.findFirst({
        where: { headUserId: body.headUserId, NOT: { id }, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (prevOwner) {
        await db.department.update({ where: { id: prevOwner.id }, data: { headUserId: null } })
      }
      data.headUserId = body.headUserId
    } else {
      data.headUserId = null
    }
  }

  // Membership management
  let membershipAction: { kind: 'added' | 'removed' | 'updated'; memberId?: string; role?: string } | null = null
  if (body.addMemberId) {
    const member = await db.member.findFirst({
      where: { id: body.addMemberId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!member) return NextResponse.json({ error: 'Invalid addMemberId' }, { status: 400 })
    const role =
      body.memberRole && VALID_MEMBER_ROLES.includes(body.memberRole as (typeof VALID_MEMBER_ROLES)[number])
        ? body.memberRole
        : 'member'
    await db.departmentMembership
      .upsert({
        where: { memberId_departmentId: { memberId: body.addMemberId, departmentId: id } },
        create: { memberId: body.addMemberId, departmentId: id, role },
        update: { role },
      })
      .catch(() => null)
    membershipAction = { kind: 'added', memberId: body.addMemberId, role }
  } else if (body.removeMemberId) {
    await db.departmentMembership
      .deleteMany({ where: { memberId: body.removeMemberId, departmentId: id } })
      .catch(() => null)
    membershipAction = { kind: 'removed', memberId: body.removeMemberId }
  } else if (body.memberRole && body.addMemberId === undefined && body.removeMemberId === undefined) {
    // Allow role change on existing membership via memberRole + addMemberId (already handled above)
  }

  if (Object.keys(data).length > 0) {
    await db.department.update({ where: { id }, data })
  }

  await audit(ctx, 'departments.update', 'department', id, {
    fields: Object.keys(data),
    membership: membershipAction,
  })

  return NextResponse.json({ id, ok: true })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('departments', 'delete')
  const { id } = await params

  const existing = await db.department.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, name: true },
  })
  if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

  // Cascade handles memberships, units, tasks, events
  await db.department.delete({ where: { id } })

  await audit(ctx, 'departments.delete', 'department', id, { name: existing.name })

  return NextResponse.json({ ok: true, id })
})
