// ChurchOS — Settings API (church profile)
// GET   /api/settings                — church profile + counts. settings:view.
// PATCH /api/settings                — update org fields. settings:manage.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_TIMEZONES = [
  'Africa/Lagos', 'Africa/Nairobi', 'Africa/Accra', 'Africa/Johannesburg',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London',
  'UTC',
]
const VALID_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'KES', 'GHS', 'ZAR', 'CAD']

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('settings', 'view')
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    include: {
      branches: { orderBy: { name: 'asc' } },
      _count: {
        select: {
          users: true, members: true, departments: true,
          services: true, events: true, funds: true,
        },
      },
    },
  })
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  // Settings table key/value entries (feature flags etc.)
  const settings = await db.setting.findMany({
    where: { organizationId: ctx.organizationId },
  })
  const settingsMap: Record<string, string> = {}
  for (const s of settings) settingsMap[s.key] = s.value

  return NextResponse.json({
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      address: org.address,
      phone: org.phone,
      email: org.email,
      timezone: org.timezone,
      currency: org.currency,
    },
    branches: org.branches.map((b) => ({
      id: b.id, name: b.name, location: b.location, createdAt: b.createdAt,
    })),
    counts: org._count,
    settings: settingsMap,
    canManage: ctx.role === 'church_admin' || ctx.role === 'super_admin',
  })
})

interface PatchBody {
  name?: string
  address?: string | null
  phone?: string | null
  email?: string | null
  timezone?: string
  currency?: string
  logoUrl?: string | null
}

export const PATCH = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('settings', 'manage')
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }
    data.name = body.name.trim()
  }
  if (body.address !== undefined) data.address = body.address?.trim() || null
  if (body.phone !== undefined) data.phone = body.phone?.trim() || null
  if (body.email !== undefined) data.email = body.email?.trim() || null
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl?.trim() || null
  if (body.timezone !== undefined) {
    if (!VALID_TIMEZONES.includes(body.timezone)) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
    }
    data.timezone = body.timezone
  }
  if (body.currency !== undefined) {
    if (!VALID_CURRENCIES.includes(body.currency)) {
      return NextResponse.json({ error: 'Invalid currency code' }, { status: 400 })
    }
    data.currency = body.currency
  }

  const updated = await db.organization.update({
    where: { id: ctx.organizationId },
    data,
  })
  await audit(ctx, 'settings.update', 'organization', updated.id, {
    fields: Object.keys(data),
  })
  return NextResponse.json({ id: updated.id, ok: true })
})
