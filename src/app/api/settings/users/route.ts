// ChurchOS — Settings / Users & Roles API
// GET   /api/settings/users                  — list users. settings:view (church_admin+).
// POST  /api/settings/users                  — create/invite user with hashed password.
// PATCH /api/settings/users {id, role?, active?, departmentId?} — update (no self-role-change).
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'
import { hashPassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

const VALID_ROLES = [
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader', 'member', 'guest',
] as const

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('settings', 'view')
  // Only church_admin and super_admin can list users
  if (ctx.role !== 'church_admin' && ctx.role !== 'super_admin') {
    throw new ForbiddenError('Only administrators can list users.')
  }
  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const role = sp.get('role') ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '200', 10) || 200))

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (role && VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) where.role = role
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
    ]
  }

  const [items, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        department: { select: { id: true, name: true, color: true } },
      },
    }),
    db.user.count({ where }),
  ])

  // Departments for the assignment dropdown
  const departments = await db.department.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true, color: true },
    orderBy: { name: 'asc' },
  })

  // Roles stats
  const roleGroups = await db.user.groupBy({
    by: ['role'],
    where: { organizationId: ctx.organizationId },
    _count: true,
  })

  return NextResponse.json({
    items: items.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      phone: u.phone,
      avatarUrl: u.avatarUrl,
      active: u.active,
      departmentId: u.departmentId,
      department: u.department,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
    total,
    page,
    pageSize,
    departments,
    roles: Object.fromEntries(roleGroups.map((g) => [g.role, g._count])) as Record<string, number>,
    currentUserId: ctx.user.id,
    currentRole: ctx.role,
  })
})

interface CreateBody {
  name?: string
  email?: string
  password?: string
  role?: string
  phone?: string | null
  departmentId?: string | null
  active?: boolean
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('settings', 'manage')
  const body = (await req.json().catch(() => ({}))) as CreateBody

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.email || typeof body.email !== 'string' || !body.email.trim()) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }
  if (!body.password || typeof body.password !== 'string' || body.password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
  }
  const role =
    body.role && VALID_ROLES.includes(body.role as (typeof VALID_ROLES)[number])
      ? body.role!
      : 'member'

  // Email uniqueness (global — User.email is @unique)
  const existing = await db.user.findUnique({
    where: { email: body.email.trim().toLowerCase() },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 })
  }

  // Department validation
  let departmentId: string | null = null
  if (body.departmentId) {
    const d = await db.department.findFirst({
      where: { id: body.departmentId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!d) {
      return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
    }
    departmentId = body.departmentId
  }

  const passwordHash = hashPassword(body.password)
  const created = await db.user.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      passwordHash,
      role,
      phone: body.phone?.trim() || null,
      departmentId,
      active: body.active !== false,
    },
  })

  await audit(ctx, 'settings.user.create', 'user', created.id, {
    name: created.name,
    email: created.email,
    role: created.role,
    departmentId,
  })

  return NextResponse.json(
    {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
    },
    { status: 201 },
  )
})

interface PatchBody {
  id?: string
  role?: string
  active?: boolean
  departmentId?: string | null
  name?: string
  phone?: string | null
}

export const PATCH = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('settings', 'manage')
  const body = (await req.json().catch(() => ({}))) as PatchBody

  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  // Fetch the target user (must be in same org)
  const target = await db.user.findFirst({
    where: { id: body.id, organizationId: ctx.organizationId },
  })
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Prevent self-role-change / self-deactivation (lockout protection)
  if (body.id === ctx.user.id) {
    if (body.role !== undefined && body.role !== target.role) {
      throw new ForbiddenError('You cannot change your own role. Ask another administrator.')
    }
    if (body.active !== undefined && body.active !== target.active) {
      throw new ForbiddenError('You cannot deactivate your own account.')
    }
  }

  const data: Record<string, unknown> = {}
  const auditMeta: Record<string, unknown> = {}
  if (body.role !== undefined && body.role !== target.role) {
    if (!VALID_ROLES.includes(body.role as (typeof VALID_ROLES)[number])) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    // Prevent the last super_admin from demoting themselves
    if (target.role === 'super_admin' && body.role !== 'super_admin') {
      const superCount = await db.user.count({
        where: { role: 'super_admin', active: true },
      })
      if (superCount <= 1) {
        throw new ForbiddenError('Cannot demote the last remaining super_admin.')
      }
    }
    data.role = body.role
    auditMeta.previousRole = target.role
    auditMeta.newRole = body.role
  }
  if (body.active !== undefined && body.active !== target.active) {
    data.active = !!body.active
    auditMeta.active = body.active
  }
  if (body.departmentId !== undefined && body.departmentId !== target.departmentId) {
    if (body.departmentId) {
      const d = await db.department.findFirst({
        where: { id: body.departmentId, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (!d) {
        return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
      }
      data.departmentId = body.departmentId
    } else {
      data.departmentId = null
    }
    auditMeta.departmentId = data.departmentId
  }
  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }
    data.name = body.name.trim()
  }
  if (body.phone !== undefined) {
    data.phone = body.phone?.trim() || null
  }

  const updated = await db.user.update({ where: { id: body.id }, data })

  // Heavy audit for role changes; standard audit otherwise
  if (auditMeta.newRole) {
    await audit(ctx, 'settings.role.change', 'user', body.id, auditMeta)
  }
  await audit(ctx, 'settings.user.update', 'user', body.id, {
    fields: Object.keys(data),
  })

  return NextResponse.json({
    id: updated.id,
    role: updated.role,
    active: updated.active,
    departmentId: updated.departmentId,
    ok: true,
  })
})
