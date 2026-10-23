// ChurchOS — Bank Accounts API
// GET   /api/finance/bank-accounts    — list (finance:view)
// POST  /api/finance/bank-accounts    — create (finance:manage)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (_req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const accounts = await db.bankAccount.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'asc' },
  })
  // Mask account numbers for non-finance-staff
  const PRIVILEGED = new Set(['super_admin', 'church_admin', 'finance_officer', 'accountant', 'treasurer'])
  const isPriv = PRIVILEGED.has(ctx.role)
  return NextResponse.json({
    accounts: accounts.map((a) => ({
      ...a,
      accountNumber: isPriv ? a.accountNumber : a.accountNumber ? `****${a.accountNumber.slice(-4)}` : null,
    })),
  })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'manage')
  const body = await req.json().catch(() => ({}))
  const { accountName, bankName, accountNumber, currency, accountType, openingBalance, reconciliationFrequency } = body
  if (!accountName) return NextResponse.json({ error: 'accountName required' }, { status: 400 })
  const account = await db.bankAccount.create({
    data: {
      organizationId: ctx.organizationId,
      accountName: String(accountName),
      bankName: bankName ?? null,
      accountNumber: accountNumber ?? null,
      currency: currency ?? 'NGN',
      accountType: accountType ?? 'operating',
      openingBalance: Number(openingBalance) || 0,
      currentBalance: Number(openingBalance) || 0,
      reconciliationFrequency: reconciliationFrequency ?? 'monthly',
    },
  })
  await audit(ctx, 'finance.bankaccount.create', 'bankAccount', account.id, { accountName })
  return NextResponse.json(account, { status: 201 })
})
