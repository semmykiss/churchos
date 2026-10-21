// ChurchOS — Asset detail API
// GET    /api/assets/[id]   — single asset
// PATCH  /api/assets/[id]   — update fields. assets:update.
// DELETE /api/assets/[id]   — delete. assets:delete (or assets:manage for super_admin).
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { can, ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = [
  'equipment', 'instrument', 'furniture', 'vehicle', 'building', 'it',
] as const
const VALID_CONDITIONS = ['good', 'fair', 'damaged', 'retired'] as const

async function getScopedAsset(ctx: AuthContext, id: string) {
  return db.asset.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
}

export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('assets', 'view')
    const { id } = await params
    const asset = await getScopedAsset(ctx, id)
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    return NextResponse.json(asset)
  },
)

interface PatchBody {
  name?: string
  tag?: string | null
  category?: string
  location?: string | null
  custodian?: string | null
  condition?: string
  acquiredAt?: string | null
  value?: number | null
}

export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('assets', 'update')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody

    const existing = await getScopedAsset(ctx, id)
    if (!existing) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) {
      if (!body.name.trim()) {
        return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      }
      data.name = body.name.trim()
    }
    if (body.tag !== undefined) data.tag = body.tag?.trim() || null
    if (body.location !== undefined) data.location = body.location?.trim() || null
    if (body.custodian !== undefined) data.custodian = body.custodian?.trim() || null
    if (body.category !== undefined) {
      if (!VALID_CATEGORIES.includes(body.category as (typeof VALID_CATEGORIES)[number])) {
        return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
      }
      data.category = body.category
    }
    if (body.condition !== undefined) {
      if (!VALID_CONDITIONS.includes(body.condition as (typeof VALID_CONDITIONS)[number])) {
        return NextResponse.json({ error: 'Invalid condition' }, { status: 400 })
      }
      data.condition = body.condition
    }
    if (body.acquiredAt !== undefined) {
      data.acquiredAt = body.acquiredAt ? new Date(body.acquiredAt) : null
    }
    if (body.value !== undefined) {
      data.value = typeof body.value === 'number' && body.value >= 0 ? body.value : null
    }

    const updated = await db.asset.update({ where: { id }, data })
    await audit(ctx, 'assets.update', 'asset', id, { fields: Object.keys(data) })
    return NextResponse.json({ id: updated.id, ok: true })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('assets', 'delete')
    const { id } = await params
    const existing = await getScopedAsset(ctx, id)
    if (!existing) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    // super_admin can manage; others need explicit assets:delete
    if (!can(ctx.role, 'assets', 'delete') && !can(ctx.role, 'assets', 'manage')) {
      throw new ForbiddenError('You do not have permission to delete this asset.')
    }
    await db.asset.delete({ where: { id } })
    await audit(ctx, 'assets.delete', 'asset', id, {
      name: existing.name,
      category: existing.category,
      value: existing.value,
    })
    return NextResponse.json({ ok: true, id })
  },
)
