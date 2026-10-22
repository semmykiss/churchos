// ChurchOS — Tithes summary API
// GET /api/finance/tithes/summary
//   - member: own totals (sum by status, last 12 months trend)
//   - staff: org totals + byMember breakdown
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler, type AuthContext } from '@/lib/api'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader',
])

async function resolveSelfMember(ctx: AuthContext) {
  if (!ctx.user.memberId) {
    const m = await db.member.findFirst({
      where: { account: { id: ctx.user.id }, organizationId: ctx.organizationId },
      select: { id: true },
    })
    return m?.id ?? null
  }
  const ok = await db.member.findFirst({
    where: { id: ctx.user.memberId, organizationId: ctx.organizationId },
    select: { id: true },
  })
  return ok?.id ?? null
}

export const GET = apiHandler(async (_req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const isStaff = STAFF_ROLES.has(ctx.role)

  const baseWhere: any = { organizationId: ctx.organizationId }
  if (!isStaff) {
    const self = await resolveSelfMember(ctx)
    if (!self) {
      return NextResponse.json({ totals: zeroTotals(), byMonth: [], byMember: [], isStaff: false })
    }
    baseWhere.memberId = self
  }

  const statusGroups = await db.tithe.groupBy({
    by: ['status'],
    where: baseWhere,
    _sum: { amount: true },
    _count: true,
  })

  const totals = zeroTotals()
  for (const g of statusGroups) {
    totals.total += g._sum.amount ?? 0
    if (g.status === 'confirmed') totals.confirmed = g._sum.amount ?? 0
    if (g.status === 'pending') totals.pending = g._sum.amount ?? 0
    if (g.status === 'failed') totals.failed = g._sum.amount ?? 0
    totals.count += g._count
  }

  // Monthly trend — last 12 months
  const twelveAgo = new Date()
  twelveAgo.setMonth(twelveAgo.getMonth() - 11)
  twelveAgo.setDate(1)
  twelveAgo.setHours(0, 0, 0, 0)
  const recentItems = await db.tithe.findMany({
    where: { ...baseWhere, titheMonth: { gte: twelveAgo }, status: 'confirmed' },
    select: { amount: true, titheMonth: true, memberId: true },
  })
  const monthMap = new Map<string, number>()
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, 0)
  }
  for (const t of recentItems) {
    const d = new Date(t.titheMonth)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (monthMap.has(key)) monthMap.set(key, (monthMap.get(key) ?? 0) + t.amount)
  }
  const byMonth = Array.from(monthMap.entries()).map(([k, v]) => {
    const [yr, mo] = k.split('-')
    const monthLabel = new Date(parseInt(yr), parseInt(mo) - 1, 1).toLocaleString('en-GB', { month: 'short' })
    return { month: k, label: monthLabel, total: v }
  })

  let byMember: any[] = []
  if (isStaff) {
    // Top 10 contributors org-wide
    const memberAgg = await db.tithe.groupBy({
      by: ['memberId'],
      where: { organizationId: ctx.organizationId, status: 'confirmed' },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    })
    const memberIds = memberAgg.map((m) => m.memberId)
    const members = await db.member.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, firstName: true, lastName: true, memberId: true },
    })
    const memberMap = new Map(members.map((m) => [m.id, m]))
    byMember = memberAgg.map((m) => {
      const mem = memberMap.get(m.memberId)
      return {
        memberId: m.memberId,
        name: mem ? `${mem.firstName} ${mem.lastName}` : 'Unknown',
        humanMemberId: mem?.memberId ?? null,
        total: m._sum.amount ?? 0,
        count: m._count,
      }
    })
  }

  return NextResponse.json({
    totals,
    byMonth,
    byMember,
    isStaff,
    selfMemberId: await resolveSelfMember(ctx),
  })
})

function zeroTotals() {
  return { total: 0, confirmed: 0, pending: 0, failed: 0, count: 0 }
}
