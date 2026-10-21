// ChurchOS — Finance CSV export API
// GET /api/finance/export?kind=donations|expenses&from=&to=
// Permission: can(role,'finance','export'). Member role blocked.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'export')
  if (ctx.role === 'member') {
    throw new ForbiddenError('CSV export is restricted to authorized finance staff.')
  }
  const sp = req.nextUrl.searchParams
  const kind = sp.get('kind') === 'expenses' ? 'expenses' : 'donations'
  const fromStr = sp.get('from') ?? ''
  const toStr = sp.get('to') ?? ''

  const dateRange: { gte?: Date; lte?: Date } = {}
  if (fromStr) {
    const d = new Date(fromStr)
    if (!isNaN(d.getTime())) dateRange.gte = d
  }
  if (toStr) {
    const d = new Date(toStr)
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999)
      dateRange.lte = d
    }
  }

  if (kind === 'donations') {
    const where: any = { organizationId: ctx.organizationId }
    if (Object.keys(dateRange).length) where.donatedAt = dateRange
    const rows = await db.donation.findMany({
      where,
      orderBy: { donatedAt: 'desc' },
      take: 5000,
      include: {
        fund: { select: { name: true } },
        member: { select: { firstName: true, lastName: true } },
      },
    })
    const header = [
      'Date', 'Donor', 'Member', 'Fund', 'Amount', 'Method', 'Reference', 'Status',
    ]
    const lines = [header]
    for (const d of rows) {
      lines.push([
        new Date(d.donatedAt).toISOString(),
        d.donorName ?? '',
        d.member ? `${d.member.firstName} ${d.member.lastName}`.trim() : '',
        d.fund?.name ?? '',
        d.amount,
        d.method,
        d.reference ?? '',
        d.status,
      ])
    }
    const csv = lines.map((r) => r.map(csvEscape).join(',')).join('\n')

    await audit(ctx, 'finance.export', 'donation', undefined, {
      kind: 'donations',
      count: rows.length,
      from: fromStr || null,
      to: toStr || null,
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="donations-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  // expenses
  const where: any = { organizationId: ctx.organizationId }
  if (Object.keys(dateRange).length) where.incurredAt = dateRange
  const rows = await db.expense.findMany({
    where,
    orderBy: { incurredAt: 'desc' },
    take: 5000,
    include: { fund: { select: { name: true } } },
  })
  const header = [
    'Date', 'Category', 'Description', 'Amount', 'Payee', 'Method', 'Reference', 'Status', 'Fund',
  ]
  const lines = [header]
  for (const e of rows) {
    lines.push([
      new Date(e.incurredAt).toISOString(),
      e.category,
      e.description,
      e.amount,
      e.payee ?? '',
      e.method,
      e.reference ?? '',
      e.status,
      e.fund?.name ?? '',
    ])
  }
  const csv = lines.map((r) => r.map(csvEscape).join(',')).join('\n')

  await audit(ctx, 'finance.export', 'expense', undefined, {
    kind: 'expenses',
    count: rows.length,
    from: fromStr || null,
    to: toStr || null,
  })

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="expenses-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
})
