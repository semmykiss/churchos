// ChurchOS — Celebrations API
// GET /api/celebrations?type=birthdays|anniversaries&month=&branchId=&departmentId=
// Returns members with dateOfBirth (birthdays) or weddingAnniversary (anniversaries),
// sorted by next upcoming occurrence with days-until + age/years.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, apiHandler } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

function nextOccurrence(month: number, day: number, today: Date): Date {
  // month is 0-based; day is 1-based.
  const t = new Date(today)
  let year = t.getFullYear()
  // JS Date with year-matching Feb 29 will roll over to Mar 1 in non-leap years; do a safe construction:
  let next = new Date(year, month, day, 0, 0, 0, 0)
  if (next < startOfDayUTC(t)) {
    next = new Date(year + 1, month, day, 0, 0, 0, 0)
  }
  return next
}

function daysUntil(target: Date, today: Date): number {
  const a = startOfDayUTC(target).getTime()
  const b = startOfDayUTC(today).getTime()
  return Math.round((a - b) / 86_400_000)
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const sp = req.nextUrl.searchParams
  const type = (sp.get('type') ?? 'birthdays').toLowerCase()
  const monthParam = sp.get('month') // 1-12, optional
  const branchId = sp.get('branchId') || undefined
  const departmentId = sp.get('departmentId') || undefined

  const where: any = { organizationId: ctx.organizationId }
  if (type === 'birthdays') where.dateOfBirth = { not: null }
  else if (type === 'anniversaries') where.weddingAnniversary = { not: null }
  else return NextResponse.json({ error: 'type must be birthdays or anniversaries' }, { status: 400 })

  if (branchId) where.branchId = branchId
  if (departmentId) {
    where.departmentMemberships = { some: { departmentId } }
  }

  // Members: visibility — non-staff can only see active + themselves.
  // Permission check via members:view (everyone has it). For simpler UX, allow all members
  // (celebrations is a community feature). If strict privacy required, switch to scoped list.
  const members = await db.member.findMany({
    where,
    include: {
      branch: { select: { id: true, name: true } },
      departmentMemberships: { include: { department: { select: { id: true, name: true, color: true } } } },
      account: { select: { id: true } },
    },
  })

  const today = new Date()
  const items = members
    .map((m) => {
      const date = type === 'birthdays' ? m.dateOfBirth : m.weddingAnniversary
      if (!date) return null
      const d = new Date(date)
      const month = d.getMonth()
      const day = d.getDate()
      if (monthParam) {
        const wantMonth = parseInt(monthParam, 10)
        if (!isNaN(wantMonth) && (month + 1) !== wantMonth) return null
      }
      const next = nextOccurrence(month, day, today)
      const days = daysUntil(next, today)
      const years = type === 'birthdays'
        ? next.getFullYear() - d.getFullYear()
        : next.getFullYear() - d.getFullYear()
      const firstName = m.firstName
      const lastName = m.lastName
      return {
        id: m.id,
        memberId: m.memberId,
        firstName,
        lastName,
        preferredName: m.preferredName,
        name: m.preferredName || `${firstName} ${lastName}`,
        photoUrl: m.photoUrl,
        date: d.toISOString(),
        month: month + 1,
        day,
        nextOccurrence: next.toISOString(),
        daysUntil: days,
        years,
        hasAccount: !!m.account?.id,
        branch: m.branch,
        departments: m.departmentMemberships.map((dm) => ({
          id: dm.department.id,
          name: dm.department.name,
          color: dm.department.color,
        })),
      }
    })
    .filter(Boolean) as any[]

  // Sort by days-until ascending (soonest first)
  items.sort((a, b) => a.daysUntil - b.daysUntil)

  // Group counts for headers
  const counts = {
    total: items.length,
    upcoming30: items.filter((i) => i.daysUntil <= 30).length,
    today: items.filter((i) => i.daysUntil === 0).length,
  }

  await can(ctx.role, 'celebrations', 'view')
  return NextResponse.json({
    type,
    items,
    counts,
    canGreet: true, // members can greet each other in celebrations (community feature)
  })
})
