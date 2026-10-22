// ChurchOS — Access Control · Role creation (Task ID 26)
// POST /api/access/roles — create a custom role, optionally cloning all
// RolePermission + FieldPermission rows from an existing role.
//
// Body: { name, label, description?, color?, cloneFromRoleId? }
// Permission: can('access','manage') — church_admin + super_admin only.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { refreshMatrixCache } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const NAME_RE = /^[a-z][a-z0-9_]{1,48}$/
const RESERVED_NAMES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader', 'member', 'guest',
  'system', 'admin', 'root', 'owner',
])
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/

export const POST = apiHandler(async (req: Request) => {
  const ctx = await requirePermission('access', 'manage')
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const name = String(body.name ?? '').trim()
  const label = String(body.label ?? '').trim()
  const description = body.description ? String(body.description).trim() : null
  const color = body.color ? String(body.color).trim() : null
  const cloneFromRoleId = body.cloneFromRoleId ? String(body.cloneFromRoleId).trim() : null

  if (!name || !label) {
    return NextResponse.json({ error: 'name and label are required' }, { status: 400 })
  }
  if (!NAME_RE.test(name)) {
    return NextResponse.json(
      { error: 'name must be snake_case (lowercase letters, digits, underscores) — 2–49 chars' },
      { status: 400 },
    )
  }
  if (RESERVED_NAMES.has(name)) {
    return NextResponse.json({ error: `Role name "${name}" is reserved for system roles.` }, { status: 400 })
  }
  if (color && !HEX_RE.test(color)) {
    return NextResponse.json({ error: 'color must be a hex string like #0891b2' }, { status: 400 })
  }

  // Ensure role name uniqueness within the org
  const existing = await db.role.findFirst({
    where: { organizationId: ctx.organizationId, name },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ error: `A role named "${name}" already exists.` }, { status: 409 })
  }

  // Validate clone source role (must be in same org)
  let sourceRole: { id: string; name: string } | null = null
  if (cloneFromRoleId) {
    sourceRole = await db.role.findFirst({
      where: { id: cloneFromRoleId, organizationId: ctx.organizationId },
      select: { id: true, name: true },
    })
    if (!sourceRole) {
      return NextResponse.json({ error: 'Clone source role not found in this organization.' }, { status: 404 })
    }
  }

  // Determine the sort order (after the last existing role)
  const maxSort = await db.role.aggregate({
    where: { organizationId: ctx.organizationId },
    _max: { sortOrder: true },
  })
  const sortOrder = (maxSort._max.sortOrder ?? 8) + 1

  // Create role + clone permissions in a transaction for atomicity
  const role = await db.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        label,
        description,
        color,
        isSystem: false,
        active: true,
        sortOrder,
      },
    })

    if (sourceRole) {
      const [perms, fields] = await Promise.all([
        tx.rolePermission.findMany({ where: { roleId: sourceRole.id } }),
        tx.fieldPermission.findMany({ where: { roleId: sourceRole.id } }),
      ])
      if (perms.length) {
        await tx.rolePermission.createMany({
          data: perms.map((p) => ({ roleId: created.id, module: p.module, action: p.action })),
        })
      }
      if (fields.length) {
        await tx.fieldPermission.createMany({
          data: fields.map((f) => ({
            roleId: created.id, module: f.module, field: f.field, access: f.access,
          })),
        })
      }
    }
    return created
  })

  await audit(ctx, 'access.role.create', 'role', role.id, {
    name: role.name, label: role.label, clonedFrom: sourceRole?.name ?? null,
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({
    id: role.id,
    name: role.name,
    label: role.label,
    description: role.description,
    color: role.color,
    isSystem: false,
    active: true,
    sortOrder: role.sortOrder,
    clonedFrom: sourceRole ? { id: sourceRole.id, name: sourceRole.name } : null,
  }, { status: 201 })
})

// GET /api/access/roles — list all roles (lightweight) for selectors / dashboards
export const GET = apiHandler(async () => {
  const ctx = await requirePermission('access', 'view')
  const roles = await db.role.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      _count: {
        select: {
          permissions: true,
          fieldPermissions: true,
          assignments: { where: { active: true } },
        },
      },
    },
  })
  return NextResponse.json({
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      label: r.label,
      description: r.description,
      color: r.color,
      isSystem: r.isSystem,
      active: r.active,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      permissionCount: r._count.permissions,
      fieldPermissionCount: r._count.fieldPermissions,
      userCount: r._count.assignments,
    })),
  })
})
