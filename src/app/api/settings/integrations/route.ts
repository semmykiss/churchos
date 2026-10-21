// ChurchOS — Settings integrations API (Email / Payments / Storage / SMS)
// GET  /api/settings/integrations   — list integration configs (sanitized — secrets NEVER exposed)
// PUT  /api/settings/integrations    — replace a config: { key, value: {...} }
//   Keys: smtp_config, payment_config, storage_config, sms_config
//   Stored in Setting table as JSON-stringified value.
//   Secrets (password / secret_key / access_key) are masked in GET responses.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const KEYS = new Set(['smtp_config', 'payment_config', 'storage_config', 'sms_config'])

const SECRET_FIELDS = new Set([
  'password', 'secretKey', 'secret_key', 'accessKey', 'access_key', 'apiKey', 'api_key',
])

function mask(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length <= 4) return '••••'
    return `${value.slice(0, 2)}••••${value.slice(-2)}`
  }
  return value
}

function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_FIELDS.has(k)) {
      out[k] = v === null || v === '' || v === undefined ? null : mask(v)
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitize(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('settings', 'view')
  const rows = await db.setting.findMany({
    where: { organizationId: ctx.organizationId, key: { in: Array.from(KEYS) } },
  })
  const configs: Record<string, Record<string, unknown> | null> = {}
  for (const k of KEYS) {
    const row = rows.find((r) => r.key === k)
    if (row) {
      try {
        const parsed = JSON.parse(row.value) as Record<string, unknown>
        configs[k] = sanitize(parsed)
      } catch {
        configs[k] = null
      }
    } else {
      configs[k] = null
    }
  }
  const statuses: Record<string, boolean> = {}
  for (const k of KEYS) {
    const cfg = configs[k]
    statuses[k] = !!cfg && Object.values(cfg).some((v) => v !== null && v !== '' && v !== undefined)
  }
  return NextResponse.json({ configs, statuses })
})

interface PutBody {
  key: string
  value: Record<string, unknown>
}

export const PUT = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('settings', 'manage')
  const body = (await req.json().catch(() => ({}))) as PutBody
  const key = body.key?.toString().trim()
  if (!key || !KEYS.has(key)) {
    return NextResponse.json({ error: 'Invalid integration key' }, { status: 400 })
  }
  if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
    return NextResponse.json({ error: 'value must be a JSON object' }, { status: 400 })
  }

  // If a masked secret was sent back unchanged ("••••" form), preserve the existing value.
  const existingRow = await db.setting.findFirst({
    where: { organizationId: ctx.organizationId, key },
  })
  let existingValue: Record<string, unknown> = {}
  if (existingRow) {
    try {
      existingValue = JSON.parse(existingRow.value) as Record<string, unknown>
    } catch {
      existingValue = {}
    }
  }
  const merged: Record<string, unknown> = { ...existingValue }
  for (const [k, v] of Object.entries(body.value)) {
    if (SECRET_FIELDS.has(k) && typeof v === 'string' && /••••/.test(v)) {
      // Keep existing secret — don't overwrite with masked placeholder
      continue
    }
    if (v === undefined) continue
    merged[k] = v
  }

  const json = JSON.stringify(merged)
  const upserted = await db.setting.upsert({
    where: { organizationId_key: { organizationId: ctx.organizationId, key } },
    create: { organizationId: ctx.organizationId, key, value: json },
    update: { value: json },
  })
  await audit(ctx, 'settings.integrations.update', 'setting', upserted.id, { key })

  // Return sanitized view
  return NextResponse.json({ key, ok: true, value: sanitize(merged) })
})

// POST — same as PUT but treated as upsert (for forms that want POST verb)
export const POST = PUT
