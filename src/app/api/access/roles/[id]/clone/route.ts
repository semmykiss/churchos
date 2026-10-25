// ChurchOS — Access Control · Clone role (Task ID 26)
// POST /api/access/roles/[id]/clone — clone a role + all its RolePermission +
// FieldPermission rows under a new name/label.
//
// Body: { name, label, description?, color? }
// Permission: can('access','manage')
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { refreshMatrixCache } from '@/lib/permissions-db'

export const dynamic = 'force-dynamic'

const NAME_RE = /^[a-z][a-z0-9_]{1,48}$/
const RESERVED_NAMES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader', 'member', 'guest',
])
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/

export const POST = apiHandler(async (req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'manage')
  const { id: sourceRoleId } = await ctx2.params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const name = String(body.name ?? '').trim()
  const label = String(body.label ?? '').trim()
  const description = body.description ? String(body.description).trim() : null
  const color = body.color ? String(body.color).trim() : null

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

  const source = await db.role.findFirst({
    where: { id: sourceRoleId, organizationId: ctx.organizationId },
    select: { id: true, name: true, label: true, description: true, color: true },
  })
  if (!source) {
    return NextResponse.json({ error: 'Source role not found in this organization.' }, { status: 404 })
  }

  const existing = await db.role.findFirst({
    where: { organizationId: ctx.organizationId, name },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ error: `A role named "${name}" already exists.` }, { status: 409 })
  }

  const maxSort = await db.role.aggregate({
    where: { organizationId: ctx.organizationId },
    _max: { sortOrder: true },
  })
  const sortOrder = (maxSort._max.sortOrder ?? 8) + 1

  const cloned = await db.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        label,
        description: description ?? source.description,
        color: color ?? source.color,
        isSystem: false,
        active: true,
        sortOrder,
      },
    })
    const [perms, fields] = await Promise.all([
      tx.rolePermission.findMany({ where: { roleId: source.id } }),
      tx.fieldPermission.findMany({ where: { roleId: source.id } }),
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
    return created
  })

  await audit(ctx, 'access.role.clone', 'role', cloned.id, {
    name: cloned.name, clonedFrom: { id: source.id, name: source.name },
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({
    id: cloned.id,
    name: cloned.name,
    label: cloned.label,
    description: cloned.description,
    color: cloned.color,
    isSystem: false,
    active: true,
    sortOrder: cloned.sortOrder,
    clonedFrom: { id: source.id, name: source.name },
  }, { status: 201 })
})
