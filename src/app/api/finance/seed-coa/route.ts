// ChurchOS — Seed default chart of accounts (manual trigger)
// POST /api/finance/seed-coa
import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission, apiHandler } from '@/lib/api'
import { seedDefaultChartOfAccounts } from '@/lib/finance/accounting'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (_req: NextRequest) => {
  const ctx = await requirePermission('finance', 'manage')
  const count = await seedDefaultChartOfAccounts(ctx.organizationId)
  return NextResponse.json({ ok: true, accountsCreated: count })
})
