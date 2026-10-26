// ChurchOS — Departments & Units API
// GET  /api/departments      — list departments with counts + head (scoped for dept_head)
// POST /api/departments      — create department (audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { isScopedRole } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const PRESET_COLORS = ['#0d9488', '#7c3aed', '#ea580c', '#db2777', '#16a34a', '#0891b2', '#ca8a04', '#dc2626']

export const GET = apiHandler(async (_req: NextRequest) => {
  const ctx = await requirePermission('departments', 'view')
  const { organizationId, role, departmentId } = ctx

  // Scoped roles (department_head/assistant/unit_leader) only see their own department
  const where: { organizationId: string; id?: string } = { organizationId }
  if (isScopedRole(role) && departmentId) {
    where.id = departmentId
  }

  const departments = await db.department.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      head: { select: { id: true, name: true, email: true, avatarUrl: true } },
      _count: {
        select: {
          memberships: true,
          tasks: true,
          events: true,
          units: true,
        },
      },
    },
  })

  return NextResponse.json({
    items: departments.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      color: d.color,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      head: d.head,
      counts: {
        members: d._count.memberships,
        tasks: d._count.tasks,
        events: d._count.events,
        units: d._count.units,
      },
    })),
    colors: PRESET_COLORS,
  })
})

interface CreateBody {
  name?: string
  description?: string
  color?: string
  headUserId?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('departments', 'create')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Validate headUserId if provided
  if (body.headUserId) {
    const head = await db.user.findFirst({
      where: { id: body.headUserId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!head) return NextResponse.json({ error: 'Invalid headUserId' }, { status: 400 })
  }

  // headUserId is @unique — guard against existing assignment
  if (body.headUserId) {
    const existing = await db.department.findFirst({
      where: { headUserId: body.headUserId, organizationId: ctx.organizationId },
      select: { id: true, name: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: `User is already head of "${existing.name}" department` },
        { status: 409 },
      )
    }
  }

  const created = await db.department.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      color: body.color?.trim() || null,
      headUserId: body.headUserId || null,
    },
    include: {
      head: { select: { id: true, name: true, email: true } },
    },
  })

  await audit(ctx, 'departments.create', 'department', created.id, { name: created.name })

  return NextResponse.json(created, { status: 201 })
})
