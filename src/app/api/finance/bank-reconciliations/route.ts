// ChurchOS — Bank Reconciliations API
// GET   /api/finance/bank-reconciliations   — list (finance:view)
// POST  /api/finance/bank-reconciliations   — create (finance:manage — accountant+)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (_req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const reconciliations = await db.bankReconciliation.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { periodEnd: 'desc' },
    take: 50,
    include: { bankAccount: { select: { id: true, accountName: true, bankName: true } } },
  })
  return NextResponse.json({ reconciliations })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'manage')
  const body = await req.json().catch(() => ({}))
  const { bankAccountId, periodStart, periodEnd, statementOpeningBalance, statementClosingBalance, bookOpeningBalance, bookClosingBalance, notes } = body
  if (!bankAccountId || !periodStart || !periodEnd) {
    return NextResponse.json({ error: 'bankAccountId, periodStart, periodEnd required' }, { status: 400 })
  }
  // Validate the bank account belongs to this org
  const account = await db.bankAccount.findFirst({
    where: { id: bankAccountId, organizationId: ctx.organizationId },
  })
  if (!account) return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })

  const recon = await db.bankReconciliation.create({
    data: {
      organizationId: ctx.organizationId,
      bankAccountId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      statementOpeningBalance: Number(statementOpeningBalance) || 0,
      statementClosingBalance: Number(statementClosingBalance) || 0,
      bookOpeningBalance: Number(bookOpeningBalance) || 0,
      bookClosingBalance: Number(bookClosingBalance) || 0,
      status: 'draft',
      preparedById: ctx.user.id,
      preparedByName: ctx.user.name,
      notes: notes ?? null,
    },
  })
  await audit(ctx, 'finance.recon.create', 'bankReconciliation', recon.id, { bankAccountId, periodEnd })
  return NextResponse.json(recon, { status: 201 })
})
