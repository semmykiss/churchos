// ChurchOS — Access Control · Field permissions (Task ID 26)
// GET /api/access/roles/[id]/fields — field permissions for a role (grouped by module)
// PUT /api/access/roles/[id]/fields — REPLACE field permissions.
//    Body: { permissions: [{ module, field, access }] }
//    access ∈ 'none' | 'masked' | 'view' | 'edit'
//
// Permission: can('access','manage') for PUT, can('access','view') for GET.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { SENSITIVE_FIELDS } from '@/lib/permissions'
import { refreshMatrixCache } from '@/lib/permissions-db'

export const dynamic = 'force-dynamic'

const VALID_ACCESS = new Set(['none', 'masked', 'view', 'edit'])
const VALID_MODULES = new Set(Object.keys(SENSITIVE_FIELDS))

// GET — grouped by module
export const GET = apiHandler(async (_req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'view')
  const { id } = await ctx2.params

  const role = await db.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, name: true, label: true },
  })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  const fields = await db.fieldPermission.findMany({
    where: { roleId: role.id },
    orderBy: [{ module: 'asc' }, { field: 'asc' }],
  })

  const grouped: Record<string, { field: string; access: string }[]> = {}
  for (const f of fields) {
    if (!grouped[f.module]) grouped[f.module] = []
    grouped[f.module].push({ field: f.field, access: f.access })
  }

  // Also include the catalogue of all known sensitive fields per module so the UI
  // can render all available fields (even those without an explicit permission row).
  return NextResponse.json({
    role: { id: role.id, name: role.name, label: role.label },
    permissions: grouped,
    catalogue: SENSITIVE_FIELDS,
    validAccessLevels: ['none', 'masked', 'view', 'edit'],
  })
})

// PUT — REPLACE field permissions (delete then recreate).
export const PUT = apiHandler(async (req: NextRequest, ctx2: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('access', 'manage')
  const { id } = await ctx2.params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const role = await db.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, name: true, label: true },
  })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  const incoming = Array.isArray(body.permissions) ? body.permissions : []
  const clean: { module: string; field: string; access: string }[] = []
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue
    const mod = String((item as Record<string, unknown>).module ?? '').trim()
    const field = String((item as Record<string, unknown>).field ?? '').trim()
    const access = String((item as Record<string, unknown>).access ?? 'none').trim()
    if (!mod || !field) continue
    if (!VALID_ACCESS.has(access)) {
      return NextResponse.json(
        { error: `Invalid access level "${access}" for ${mod}.${field}. Must be one of: none, masked, view, edit` },
        { status: 400 },
      )
    }
    // Only accept fields that are in our known sensitive-fields catalogue
    const knownFields = SENSITIVE_FIELDS[mod]
    if (!knownFields || !knownFields.includes(field)) {
      return NextResponse.json(
        { error: `Unknown sensitive field "${field}" on module "${mod}".` },
        { status: 400 },
      )
    }
    if (access !== 'none') {
      clean.push({ module: mod, field, access })
    }
  }

  // Replace atomically
  await db.$transaction(async (tx) => {
    await tx.fieldPermission.deleteMany({ where: { roleId: role.id } })
    if (clean.length) {
      await tx.fieldPermission.createMany({
        data: clean.map((c) => ({ roleId: role.id, module: c.module, field: c.field, access: c.access })),
      })
    }
  })

  await audit(ctx, 'access.field.update', 'role', role.id, {
    name: role.name, fieldPermissionCount: clean.length,
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({
    ok: true,
    roleId: role.id,
    roleName: role.name,
    fieldPermissionCount: clean.length,
  })
})
