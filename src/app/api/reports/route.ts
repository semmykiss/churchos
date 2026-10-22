// ChurchOS — Reports & Analytics API
// GET /api/reports?type=membership|attendance|finance&from=&to=&branchId=&departmentId=
// Permission: can(role,'reports','view') minimum; finance type requires can(role,'finance','view').
// Same scoping as underlying modules (member role has no reports access at all).
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'
import { can, ForbiddenError, isScopedRole } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('reports', 'view')
  const { organizationId, role, departmentId } = ctx

  const sp = req.nextUrl.searchParams
  const type = sp.get('type') ?? 'membership'
  const fromStr = sp.get('from') ?? ''
  const toStr = sp.get('to') ?? ''
  const branchId = sp.get('branchId') ?? ''
  const departmentIdFilter = sp.get('departmentId') ?? ''
  const memberIdFilter = sp.get('memberId') ?? ''

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

  // ---------- Membership report ----------
  if (type === 'membership') {
    const where: any = { organizationId }
    if (branchId) where.branchId = branchId
    if (Object.keys(dateRange).length) where.dateJoined = dateRange
    // Department filter via DepartmentMembership join (members belonging to dept)
    if (departmentIdFilter) {
      where.departmentMemberships = { some: { departmentId: departmentIdFilter } }
    }
    // Specific member filter (single member growth snapshot)
    if (memberIdFilter) {
      where.id = memberIdFilter
    }

    const [byStatus, byBranch, byGender, total, newOverTime] = await Promise.all([
      db.member.groupBy({ by: ['status'], where, _count: true }),
      db.member.groupBy({
        by: ['branchId'],
        where,
        _count: true,
      }),
      db.member.groupBy({ by: ['gender'], where, _count: true }),
      db.member.count({ where }),
      db.member.findMany({
        where: { ...where, dateJoined: dateRange.gte ? { gte: dateRange.gte } : undefined },
        select: { dateJoined: true },
        take: 5000,
      }),
    ])

    const branchIds = byBranch.map((b) => b.branchId).filter(Boolean) as string[]
    const branches = branchIds.length
      ? await db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
      : []
    const branchMap = new Map(branches.map((b) => [b.id, b.name]))

    // Group new members by month
    const monthMap = new Map<string, number>()
    for (const m of newOverTime) {
      const d = new Date(m.dateJoined)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, (monthMap.get(key) ?? 0) + 1)
    }
    const newByMonth = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([k, v]) => ({
        key: k,
        label: new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' }).format(
          new Date(`${k}-01`),
        ),
        count: v,
      }))

    return NextResponse.json({
      type: 'membership',
      total,
      byStatus: byStatus.map((g) => ({ status: g.status, count: g._count })),
      byBranch: byBranch.map((g) => ({
        branchId: g.branchId,
        branchName: g.branchId ? branchMap.get(g.branchId) ?? 'Unknown' : 'No branch',
        count: g._count,
      })),
      byGender: byGender.map((g) => ({ gender: g.gender ?? 'unknown', count: g._count })),
      newByMonth,
      canViewMembers: can(role, 'members', 'view'),
    })
  }

  // ---------- Attendance report ----------
  if (type === 'attendance') {
    const sessionWhere: any = { service: { organizationId } }
    if (branchId) sessionWhere.branchId = branchId
    if (Object.keys(dateRange).length) sessionWhere.date = dateRange

    const [sessions, totalRecords] = await Promise.all([
      db.attendanceSession.findMany({
        where: sessionWhere,
        orderBy: { date: 'desc' },
        take: 200,
        include: {
          _count: { select: { records: true } },
          service: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      db.attendanceRecord.count({
        where: { session: sessionWhere },
      }),
    ])

    // Aggregate by serviceId in memory (groupBy doesn't support relation counts on SQLite)
    const serviceMap = new Map<string, { serviceName: string; sessions: number; records: number }>()
    for (const s of sessions) {
      const sid = s.serviceId
      const name = s.service?.name ?? 'Unknown'
      const entry = serviceMap.get(sid) ?? { serviceName: name, sessions: 0, records: 0 }
      entry.sessions += 1
      entry.records += s._count.records
      serviceMap.set(sid, entry)
    }
    const byService = Array.from(serviceMap.entries()).map(([serviceId, v]) => ({
      serviceId,
      serviceName: v.serviceName,
      sessions: v.sessions,
      records: v.records,
    }))

    // Trend by month
    const monthMap = new Map<string, number>()
    for (const s of sessions) {
      const d = new Date(s.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, (monthMap.get(key) ?? 0) + s._count.records)
    }
    const trend = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([k, v]) => ({
        key: k,
        label: new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' }).format(
          new Date(`${k}-01`),
        ),
        count: v,
      }))

    // Top attending members — only if user has members:view
    let topAttenders: { id: string; name: string; count: number }[] = []
    if (can(role, 'members', 'view')) {
      const records = await db.attendanceRecord.findMany({
        where: { session: sessionWhere, memberId: { not: null } },
        select: { memberId: true },
        take: 5000,
      })
      const memberCount = new Map<string, number>()
      for (const r of records) {
        if (!r.memberId) continue
        memberCount.set(r.memberId, (memberCount.get(r.memberId) ?? 0) + 1)
      }
      const topIds = Array.from(memberCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
      if (topIds.length) {
        const members = await db.member.findMany({
          where: { id: { in: topIds.map(([id]) => id) } },
          select: { id: true, firstName: true, lastName: true },
        })
        topAttenders = topIds
          .map(([id, count]) => {
            const m = members.find((mm) => mm.id === id)
            return m
              ? { id, name: `${m.firstName} ${m.lastName}`.trim(), count }
              : null
          })
          .filter(Boolean) as { id: string; name: string; count: number }[]
      }
    }

    return NextResponse.json({
      type: 'attendance',
      totalSessions: sessions.length,
      totalRecords,
      avgPerSession: sessions.length ? Math.round(totalRecords / sessions.length) : 0,
      byService,
      trend,
      topAttenders,
      canViewMembers: can(role, 'members', 'view'),
    })
  }

  // ---------- Finance report (gated) ----------
  if (type === 'finance') {
    if (!can(role, 'finance', 'view') || role === 'member') {
      throw new ForbiddenError('Finance reports require the finance:view permission.')
    }

    const donationWhere: any = { organizationId, status: 'confirmed' }
    const expenseWhere: any = {
      organizationId,
      status: { in: ['approved', 'paid'] },
    }
    if (Object.keys(dateRange).length) {
      donationWhere.donatedAt = dateRange
      expenseWhere.incurredAt = dateRange
    }
    // Member filter — restrict to a specific donor
    if (memberIdFilter) {
      donationWhere.memberId = memberIdFilter
      // Tithes (if used in this report) would also be filtered by member
    }

    const [incomeAgg, expenseAgg, byFundDonations, byFundExpenses, byMonthDonations, byMonthExpenses, topDonorsRaw] = await Promise.all([
      db.donation.aggregate({ where: donationWhere, _sum: { amount: true }, _count: true }),
      db.expense.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: true }),
      db.donation.groupBy({
        by: ['fundId'],
        where: donationWhere,
        _sum: { amount: true },
        _count: true,
      }),
      db.expense.groupBy({
        by: ['fundId'],
        where: expenseWhere,
        _sum: { amount: true },
        _count: true,
      }),
      db.donation.findMany({
        where: donationWhere,
        select: { amount: true, donatedAt: true, donorName: true, memberId: true },
        take: 5000,
      }),
      db.expense.findMany({
        where: expenseWhere,
        select: { amount: true, incurredAt: true, category: true },
        take: 5000,
      }),
      db.donation.findMany({
        where: donationWhere,
        select: { donorName: true, memberId: true, amount: true },
        take: 5000,
      }),
    ])

    // Build month-by-month income vs expense
    const monthMap = new Map<string, { income: number; expense: number }>()
    for (const d of byMonthDonations) {
      const dt = new Date(d.donatedAt)
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
      const entry = monthMap.get(key) ?? { income: 0, expense: 0 }
      entry.income += d.amount
      monthMap.set(key, entry)
    }
    for (const e of byMonthExpenses) {
      const dt = new Date(e.incurredAt)
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
      const entry = monthMap.get(key) ?? { income: 0, expense: 0 }
      entry.expense += e.amount
      monthMap.set(key, entry)
    }
    const monthlyTrend = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([k, v]) => ({
        key: k,
        label: new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' }).format(
          new Date(`${k}-01`),
        ),
        income: v.income,
        expense: v.expense,
        net: v.income - v.expense,
      }))

    // Top donors — finance roles see real names
    const donorMap = new Map<string, { name: string; total: number; count: number }>()
    for (const d of topDonorsRaw) {
      const key = d.memberId ?? d.donorName ?? 'anonymous'
      const name = d.donorName ?? 'Anonymous'
      const entry = donorMap.get(key) ?? { name, total: 0, count: 0 }
      entry.total += d.amount
      entry.count += 1
      donorMap.set(key, entry)
    }
    const topDonors = Array.from(donorMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    // By fund — merge donation + expense aggregates
    const fundIds = new Set<string | null>([
      ...byFundDonations.map((d) => d.fundId),
      ...byFundExpenses.map((e) => e.fundId),
    ])
    const fundNames = fundIds.size
      ? await db.fund.findMany({
          where: { id: { in: Array.from(fundIds).filter(Boolean) as string[] } },
          select: { id: true, name: true, code: true, balance: true },
        })
      : []
    const fundMap = new Map(fundNames.map((f) => [f.id, f]))
    const byFund = Array.from(fundIds).map((fid) => {
      const inc = byFundDonations.find((d) => d.fundId === fid)
      const exp = byFundExpenses.find((e) => e.fundId === fid)
      const fund = fid ? fundMap.get(fid) : null
      return {
        fundId: fid,
        fundName: fund?.name ?? 'Unspecified',
        fundCode: fund?.code ?? null,
        income: inc?._sum.amount ?? 0,
        incomeCount: inc?._count ?? 0,
        expense: exp?._sum.amount ?? 0,
        expenseCount: exp?._count ?? 0,
        net: (inc?._sum.amount ?? 0) - (exp?._sum.amount ?? 0),
      }
    })

    // Expenses by category
    const catMap = new Map<string, number>()
    for (const e of byMonthExpenses) {
      catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amount)
    }
    const byCategory = Array.from(catMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)

    return NextResponse.json({
      type: 'finance',
      totals: {
        income: incomeAgg._sum.amount ?? 0,
        incomeCount: incomeAgg._count,
        expense: expenseAgg._sum.amount ?? 0,
        expenseCount: expenseAgg._count,
        net: (incomeAgg._sum.amount ?? 0) - (expenseAgg._sum.amount ?? 0),
      },
      monthlyTrend,
      byFund,
      byCategory,
      topDonors,
      canViewDonorNames: true, // finance roles see donor names; non-finance can't reach this branch
    })
  }

  // ---------- Department participation report ----------
  if (type === 'departments') {
    const where: any = { organizationId }
    if (departmentIdFilter) where.id = departmentIdFilter
    const departments = await db.department.findMany({
      where,
      include: {
        _count: { select: { memberships: true, tasks: true, events: true, units: true } },
        head: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      type: 'departments',
      total: departments.length,
      items: departments.map((d) => ({
        id: d.id,
        name: d.name,
        head: d.head?.name ?? null,
        members: d._count.memberships,
        tasks: d._count.tasks,
        events: d._count.events,
        units: d._count.units,
      })),
    })
  }

  // ---------- Visitor follow-up report ----------
  if (type === 'visitors') {
    if (!can(role, 'visitors', 'view')) {
      throw new ForbiddenError('Visitor reports require the visitors:view permission.')
    }
    const where: any = { organizationId }
    if (Object.keys(dateRange).length) where.firstVisitDate = dateRange

    const [byReferral, total, converted, followUps] = await Promise.all([
      db.visitor.groupBy({ by: ['referralSource'], where, _count: true }),
      db.visitor.count({ where }),
      db.visitor.count({ where: { organizationId, convertedMemberId: { not: null } } }),
      db.followUpTask.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
    ])

    return NextResponse.json({
      type: 'visitors',
      total,
      converted,
      conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
      byReferral: byReferral.map((g) => ({
        source: g.referralSource ?? 'Unknown',
        count: g._count,
      })),
      followUps: followUps.map((g) => ({ status: g.status, count: g._count })),
    })
  }

  // ---- TITHE REPORT ----
  if (type === 'tithe') {
    const tithes = await db.tithe.findMany({
      where: { organizationId: ctx.organizationId, ...(memberIdFilter && { memberId: memberIdFilter }), ...(departmentId && { member: { departmentMemberships: { some: { departmentId } } } }) },
      orderBy: { titheMonth: 'desc' },
    })
    const total = tithes.reduce((s, t) => s + t.amount, 0)
    const confirmed = tithes.filter((t) => t.status === 'confirmed')
    const pending = tithes.filter((t) => t.status === 'pending')
    // Monthly breakdown
    const byMonth: { month: string; total: number; count: number }[] = []
    const monthMap = new Map<string, { total: number; count: number }>()
    for (const t of tithes) {
      const m = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(t.titheMonth)
      if (!monthMap.has(m)) monthMap.set(m, { total: 0, count: 0 })
      const e = monthMap.get(m)!
      e.total += t.amount
      e.count += 1
    }
    monthMap.forEach((v, k) => byMonth.push({ month: k, total: v.total, count: v.count }))
    // By member
    const memberMap = new Map<string, { total: number; count: number; lastMonth: string | null }>()
    for (const t of tithes) {
      const key = t.memberId ?? 'anonymous'
      if (!memberMap.has(key)) memberMap.set(key, { total: 0, count: 0, lastMonth: null })
      const e = memberMap.get(key)!
      e.total += t.amount
      e.count += 1
      if (!e.lastMonth || t.titheMonth > new Date(e.lastMonth)) e.lastMonth = t.titheMonth.toISOString()
    }
    // Resolve member names
    const memberIds = [...memberMap.keys()].filter((k) => k !== 'anonymous')
    const members = memberIds.length ? await db.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, firstName: true, lastName: true } }) : []
    const memberNameMap = new Map(members.map((m) => [m.id, `${m.firstName} ${m.lastName}`]))
    const byMember = Array.from(memberMap.entries())
      .map(([memberId, v]) => ({ memberId, name: memberNameMap.get(memberId) ?? 'Anonymous', total: v.total, count: v.count, lastTitheMonth: v.lastMonth }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20)

    return NextResponse.json({
      type: 'tithe',
      totalTithes: total,
      titheCount: tithes.length,
      confirmedTotal: confirmed.reduce((s, t) => s + t.amount, 0),
      confirmedCount: confirmed.length,
      pendingTotal: pending.reduce((s, t) => s + t.amount, 0),
      pendingCount: pending.length,
      byMonth,
      byMember,
      filters: { memberId: memberIdFilter, departmentId, branchId, from: fromStr, to: toStr },
    })
  }

  // ---- CELEBRATIONS REPORT ----
  if (type === 'celebrations') {
    const members = await db.member.findMany({
      where: { organizationId: ctx.organizationId, OR: [{ dateOfBirth: { not: null } }, { weddingAnniversary: { not: null } }] },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, weddingAnniversary: true, branchId: true, memberId: true, membershipType: true, orgUnitType: true },
    })
    // Birthday stats
    const birthdayByMonth: { month: string; count: number }[] = []
    const bMonthMap = new Map<number, number>()
    for (const m of members) {
      if (m.dateOfBirth) {
        const mo = m.dateOfBirth.getMonth()
        bMonthMap.set(mo, (bMonthMap.get(mo) ?? 0) + 1)
      }
    }
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    bMonthMap.forEach((count, mo) => birthdayByMonth.push({ month: monthNames[mo], count }))

    // Anniversary stats
    const anniversaryByMonth: { month: string; count: number }[] = []
    const aMonthMap = new Map<number, number>()
    for (const m of members) {
      if (m.weddingAnniversary) {
        const mo = m.weddingAnniversary.getMonth()
        aMonthMap.set(mo, (aMonthMap.get(mo) ?? 0) + 1)
      }
    }
    aMonthMap.forEach((count, mo) => anniversaryByMonth.push({ month: monthNames[mo], count }))

    // By membership type
    const byMembershipType: { type: string; count: number }[] = []
    const typeMap = new Map<string, number>()
    for (const m of members) {
      const t = m.membershipType ?? 'member'
      typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
    }
    typeMap.forEach((count, t) => byMembershipType.push({ type: t, count }))

    // By org unit type
    const byOrgUnit: { type: string; count: number }[] = []
    const orgMap = new Map<string, number>()
    for (const m of members) {
      const t = m.orgUnitType ?? 'unassigned'
      orgMap.set(t, (orgMap.get(t) ?? 0) + 1)
    }
    orgMap.forEach((count, t) => byOrgUnit.push({ type: t, count }))

    return NextResponse.json({
      type: 'celebrations',
      totalWithBirthday: members.filter((m) => m.dateOfBirth).length,
      totalWithAnniversary: members.filter((m) => m.weddingAnniversary).length,
      birthdayByMonth,
      anniversaryByMonth,
      byMembershipType,
      byOrgUnit,
      filters: { departmentId, branchId, from: fromStr, to: toStr },
    })
  }

  // Unknown type
  return NextResponse.json({ error: `Unknown report type: ${type}` }, { status: 400 })
})
