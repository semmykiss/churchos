// ChurchOS — Member Giving Statement
// GET /api/finance/reports/member-giving-statement?memberId=&fromDate=&toDate=
//
// PRIVACY: A member can only request their OWN statement. Staff with finance:view
// can request any member's statement (subject to the existing FULL_ACCESS hybrid
// model — finance data is always gated by PRIVILEGED_FINANCE_ROLES for individual
// member giving).
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, apiHandler, type AuthContext } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const PRIVILEGED_FINANCE_ROLES = new Set(['super_admin', 'church_admin', 'finance_officer', 'accountant', 'treasurer'])

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const sp = req.nextUrl.searchParams
  const memberId = sp.get('memberId') ?? ''
  const fromDate = sp.get('fromDate') ? new Date(sp.get('fromDate')!) : new Date(new Date().getFullYear(), 0, 1)
  const toDate = sp.get('toDate') ? new Date(sp.get('toDate')!) : new Date()

  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  // PRIVACY GATE: members can only see their OWN giving statement
  const isOwn = ctx.memberId === memberId
  const isFinanceStaff = PRIVILEGED_FINANCE_ROLES.has(ctx.role)
  if (!isOwn && !isFinanceStaff) {
    throw new ForbiddenError('You can only view your own giving statement. Another member\'s giving history is private.')
  }

  const [tithes, donations] = await Promise.all([
    db.tithe.findMany({
      where: { memberId, organizationId: ctx.organizationId, titheMonth: { gte: fromDate, lte: toDate } },
      orderBy: { titheMonth: 'desc' },
      select: { id: true, amount: true, currency: true, method: true, status: true, titheMonth: true, reference: true },
    }),
    db.donation.findMany({
      where: { memberId, organizationId: ctx.organizationId, donatedAt: { gte: fromDate, lte: toDate } },
      orderBy: { donatedAt: 'desc' },
      select: { id: true, amount: true, currency: true, method: true, status: true, donatedAt: true, reference: true, fund: { select: { name: true } } },
    }),
  ])

  const totalTithes = tithes.filter((t) => t.status === 'confirmed').reduce((s, t) => s + t.amount, 0)
  const totalDonations = donations.filter((d) => d.status === 'confirmed').reduce((s, d) => s + d.amount, 0)

  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: ctx.organizationId },
    select: { id: true, firstName: true, lastName: true, memberId: true },
  })

  return NextResponse.json({
    member,
    period: { fromDate, toDate },
    tithes,
    donations,
    totalTithes,
    totalDonations,
    grandTotal: totalTithes + totalDonations,
  })
})
