// ChurchOS — Chart of Accounts API
// GET   /api/finance/chart-of-accounts       — list accounts (finance:view)
// POST  /api/finance/chart-of-accounts       — create account (finance:manage — accountant+)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'
import { seedDefaultChartOfAccounts } from '@/lib/finance/accounting'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  // Lazy-seed the default chart of accounts if none exists.
  await seedDefaultChartOfAccounts(ctx.organizationId)
  const accounts = await db.chartOfAccount.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { code: 'asc' },
  })
  return NextResponse.json({ accounts })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'manage')
  const body = await req.json().catch(() => ({}))
  const { code, name, accountType, parentCode, description, isPosting } = body
  if (!code || !name || !accountType) {
    return NextResponse.json({ error: 'code, name, accountType required' }, { status: 400 })
  }
  const validTypes = ['asset', 'liability', 'fund_balance', 'income', 'expenditure']
  if (!validTypes.includes(accountType)) {
    return NextResponse.json({ error: 'Invalid accountType' }, { status: 400 })
  }
  try {
    const account = await db.chartOfAccount.create({
      data: {
        organizationId: ctx.organizationId,
        code: String(code).trim(),
        name: String(name).trim(),
        accountType,
        parentCode: parentCode ?? null,
        description: description ?? null,
        isPosting: isPosting !== false,
      },
    })
    return NextResponse.json(account, { status: 201 })
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    }
    throw e
  }
})
