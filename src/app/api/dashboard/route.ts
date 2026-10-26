import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'
import { can, isScopedRole } from '@/lib/permissions'

// Finance summary block returned only to finance-authorized roles.
interface FinanceSummary {
  incomeThisMonth: number
  expensesThisMonth: number
  pendingApprovals: number
  funds: { id: string; name: string; code: string | null; balance: number }[]
}

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('dashboard', 'view')
  const { organizationId, role, departmentId } = ctx

  // Member counts by status
  const memberStatusGroups = await db.member.groupBy({
    by: ['status'],
    where: { organizationId },
    _count: true,
  })
  const totalMembers = memberStatusGroups.reduce((s, g) => s + g._count, 0)
  const activeMembers = memberStatusGroups.find((g) => g.status === 'active')?._count ?? 0
  const newVisitors = memberStatusGroups.find((g) => g.status === 'visitor')?._count ?? 0
  const newConverts = memberStatusGroups.find((g) => g.status === 'new_convert')?._count ?? 0
  const followUpCount = memberStatusGroups.find((g) => g.status === 'follow_up')?._count ?? 0

  // Members added in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
  const newMembersThisMonth = await db.member.count({
    where: { organizationId, dateJoined: { gte: thirtyDaysAgo } },
  })

  // Attendance trend — last 8 Sunday sessions
  const sessions = await db.attendanceSession.findMany({
    where: { service: { organizationId } },
    orderBy: { date: 'desc' },
    take: 16,
    include: { _count: { select: { records: true } }, service: true },
  })
  const attendanceTrend = sessions
    .reverse()
    .map((s) => ({
      date: s.date,
      label: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(s.date),
      service: s.service.name,
      count: s._count.records,
    }))

  // Total attendance records (all time)
  const totalAttendance = await db.attendanceRecord.count({
    where: { session: { service: { organizationId } } },
  })

  // Visitors
  const totalVisitors = await db.visitor.count({ where: { organizationId } })

  // Follow-up tasks
  const followUpTasks = await db.followUpTask.groupBy({
    by: ['status'],
    where: { organizationId },
    _count: true,
  })
  const pendingFollowUps = followUpTasks.find((g) => g.status === 'pending' || g.status === 'in_progress')?._count ?? 0

  // Upcoming events (next 5)
  const upcomingEvents = await db.event.findMany({
    where: { organizationId, startDate: { gte: new Date() }, status: { not: 'cancelled' } },
    orderBy: { startDate: 'asc' },
    take: 5,
    include: { _count: { select: { registrations: true } } },
  })

  // Pending tasks
  const taskWhere = isScopedRole(role) && departmentId
    ? { organizationId, departmentId, status: { not: 'done' } }
    : { organizationId, status: { not: 'done' } }
  const pendingTasks = await db.task.count({ where: taskWhere as any })

  // Department activity (member counts per department)
  const departmentActivity = await db.department.findMany({
    where: { organizationId },
    include: { _count: { select: { memberships: true, tasks: true, events: true } } },
    take: 8,
  })

  // Finance summary (only for finance-authorized roles)
  let financeSummary: FinanceSummary | null = null
  if (can(role, 'finance', 'view')) {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const [income, expenses, pendingExpenses] = await Promise.all([
      db.donation.aggregate({
        where: { organizationId, status: 'confirmed', donatedAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      db.expense.aggregate({
        where: { organizationId, status: { in: ['approved', 'paid'] }, incurredAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      db.expense.count({ where: { organizationId, status: 'pending' } }),
    ])
    const fundBalances = await db.fund.findMany({
      where: { organizationId },
      select: { id: true, name: true, balance: true, code: true },
    })
    financeSummary = {
      incomeThisMonth: income._sum.amount ?? 0,
      expensesThisMonth: expenses._sum.amount ?? 0,
      pendingApprovals: pendingExpenses,
      funds: fundBalances,
    }
  }

  // Pending approvals (for approvers)
  const pendingApprovals = await db.approval.count({
    where: { organizationId, status: 'pending' },
  })

  // Announcements (pinned/recent)
  const announcements = await db.announcement.findMany({
    where: { organizationId, published: true },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
    take: 4,
  })

  return NextResponse.json({
    role,
    metrics: {
      totalMembers,
      activeMembers,
      newVisitors,
      newConverts,
      followUpCount,
      newMembersThisMonth,
      totalAttendance,
      totalVisitors,
      pendingFollowUps,
      pendingTasks,
      pendingApprovals,
    },
    attendanceTrend,
    upcomingEvents: upcomingEvents.map((e) => ({
      id: e.id, title: e.title, startDate: e.startDate, venue: e.venue,
      eventType: e.eventType, registrations: e._count.registrations, capacity: e.capacity,
    })),
    departmentActivity: departmentActivity.map((d) => ({
      id: d.id, name: d.name, color: d.color,
      members: d._count.memberships, tasks: d._count.tasks, events: d._count.events,
    })),
    financeSummary,
    announcements: announcements.map((a) => ({
      id: a.id, title: a.title, body: a.body, pinned: a.pinned, publishedAt: a.publishedAt, audience: a.audience,
    })),
  })
})
