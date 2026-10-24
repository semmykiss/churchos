// ChurchOS — Statement of Financial Position (Balance Sheet)
// GET /api/finance/reports/statement-of-position?asAt=
//
// Assets = Liabilities + Fund Balances (must balance)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

function round(n: number): number { return Math.round(n * 100) / 100 }

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const asAt = sp.get('asAt') ? new Date(sp.get('asAt')!) : new Date()

  const entries = await db.ledgerEntry.findMany({
    where: {
      organizationId: ctx.organizationId,
      journalEntry: { status: 'posted', transactionDate: { lte: asAt } },
    },
    select: {
      debit: true,
      credit: true,
      account: { select: { code: true, name: true, accountType: true } },
    },
  })

  const accounts: Record<string, { code: string; name: string; accountType: string; balance: number }> = {}
  for (const e of entries) {
    const key = e.account.code
    if (!accounts[key]) accounts[key] = { code: e.account.code, name: e.account.name, accountType: e.account.accountType, balance: 0 }
    accounts[key].balance = round(accounts[key].balance + e.debit - e.credit)
  }

  const assets = Object.values(accounts).filter((a) => a.accountType === 'asset' && a.balance !== 0).sort((a, b) => a.code.localeCompare(b.code))
  const liabilities = Object.values(accounts).filter((a) => a.accountType === 'liability' && a.balance !== 0).sort((a, b) => a.code.localeCompare(b.code))
  const fundBalances = Object.values(accounts).filter((a) => a.accountType === 'fund_balance' && a.balance !== 0).sort((a, b) => a.code.localeCompare(b.code))

  const totalAssets = round(assets.reduce((s, a) => s + a.balance, 0))
  const totalLiabilities = round(liabilities.reduce((s, a) => s + Math.abs(a.balance), 0))
  const totalFundBalances = round(fundBalances.reduce((s, a) => s + Math.abs(a.balance), 0))

  return NextResponse.json({
    asAt,
    assets,
    liabilities,
    fundBalances,
    totalAssets,
    totalLiabilities,
    totalFundBalances,
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalFundBalances)) < 0.01,
  })
})
