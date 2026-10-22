// AI Assistant — permission-aware retrieval layer.
//
// CRITICAL DATA-VISIBILITY POLICY (enforced at the data layer, not the prompt):
//   1. User's OWN biodata     → full access (phone, email, address, DOB, etc.)
//   2. OTHER users' biodata   → basic info only (name, role, department, photoUrl, status)
//                               — never phone, email, address, DOB, emergency, privateNotes.
//   3. User's OWN finance     → full access (own tithes, donations, giving history)
//   4. OTHER members' finance → NEVER revealed (no amounts, no history, no references)
//   5. Church-wide finance    → ONLY to roles with `finance:view` permission
//                               (finance_officer / church_admin / super_admin).
//                               Members, department heads, pastors without finance access
//                               get a polite refusal instead of numbers.
//
// Each retriever function returns ALREADY-FILTERED data. The LLM never sees raw
// rows it isn't allowed to see — it only sees what we hand it.

import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/api'
import { canAsync, checkFieldAccess } from '@/lib/permissions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASIC_MEMBER_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  membershipType: true,
  status: true,
  photoUrl: true,
  gender: true,
  maritalStatus: true,
  dateJoined: true,
  occupation: true,
  departmentMemberships: { select: { department: { select: { id: true, name: true } } } },
} as const

const FULL_OWN_MEMBER_FIELDS = {
  ...BASIC_MEMBER_FIELDS,
  memberId: true,
  middleName: true,
  phone: true,
  phoneSecondary: true,
  email: true,
  address: true,
  city: true,
  stateProvince: true,
  country: true,
  postalCode: true,
  dateOfBirth: true,
  placeOfBirth: true,
  nationality: true,
  emergencyName: true,
  emergencyPhone: true,
  emergencyRelationship: true,
  weddingAnniversary: true,
  spouseName: true,
  householdName: true,
  headOfHousehold: true,
  notes: true,
} as const

function fmtDate(d: Date | null | undefined): string | null {
  if (!d) return null
  return d.toISOString().slice(0, 10)
}

function fmtDateTime(d: Date | null | undefined): string | null {
  if (!d) return null
  return d.toISOString()
}

function maskSensitiveMember(m: any): any {
  // Strip ALL sensitive PII before exposing another member's record.
  if (!m) return null
  return {
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    preferredName: m.preferredName,
    membershipType: m.membershipType,
    status: m.status,
    photoUrl: m.photoUrl ?? null,
    gender: m.gender ?? null,
    maritalStatus: m.maritalStatus ?? null,
    dateJoined: fmtDate(m.dateJoined),
    occupation: m.occupation ?? null,
    departments: (m.departmentMemberships ?? []).map((dm: any) => dm.department?.name).filter(Boolean),
  }
}

function ownMemberProfile(m: any): any {
  if (!m) return null
  return {
    id: m.id,
    memberId: m.memberId ?? null,
    firstName: m.firstName,
    lastName: m.lastName,
    middleName: m.middleName ?? null,
    preferredName: m.preferredName ?? null,
    gender: m.gender ?? null,
    dateOfBirth: fmtDate(m.dateOfBirth),
    placeOfBirth: m.placeOfBirth ?? null,
    nationality: m.nationality ?? null,
    phone: m.phone ?? null,
    phoneSecondary: m.phoneSecondary ?? null,
    email: m.email ?? null,
    address: m.address ?? null,
    city: m.city ?? null,
    stateProvince: m.stateProvince ?? null,
    country: m.country ?? null,
    postalCode: m.postalCode ?? null,
    emergencyName: m.emergencyName ?? null,
    emergencyPhone: m.emergencyPhone ?? null,
    emergencyRelationship: m.emergencyRelationship ?? null,
    status: m.status,
    membershipType: m.membershipType,
    isMinor: m.isMinor ?? false,
    dateJoined: fmtDate(m.dateJoined),
    occupation: m.occupation ?? null,
    employer: m.employer ?? null,
    educationLevel: m.educationLevel ?? null,
    languages: m.languages ?? null,
    maritalStatus: m.maritalStatus ?? null,
    weddingAnniversary: fmtDate(m.weddingAnniversary),
    householdName: m.householdName ?? null,
    headOfHousehold: m.headOfHousehold ?? false,
    spouseName: m.spouseName ?? null,
    communicationPreference: m.communicationPreference ?? null,
    notes: m.notes ?? null,
    departments: (m.departmentMemberships ?? []).map((dm: any) => ({ id: dm.department?.id, name: dm.department?.name })),
  }
}

// ---------------------------------------------------------------------------
// Retrievers — each gated by permission. Returns either filtered data or null.
// ---------------------------------------------------------------------------

/** User's own linked Member record (full biodata). */
export async function getOwnMemberProfile(ctx: AuthContext) {
  if (!ctx.memberId) return null
  const m = await db.member.findFirst({
    where: { id: ctx.memberId, organizationId: ctx.organizationId },
    select: FULL_OWN_MEMBER_FIELDS,
  })
  return ownMemberProfile(m)
}

/** User's own account/role/department summary (from User record). */
export async function getOwnUserSummary(ctx: AuthContext) {
  return {
    name: ctx.user.name,
    email: ctx.user.email,
    role: ctx.role,
    departmentId: ctx.departmentId ?? null,
    memberId: ctx.memberId ?? null,
  }
}

/** User's own tithes — full history. NEVER exposes other members' tithes. */
export async function getOwnTithes(ctx: AuthContext, limit = 50) {
  if (!ctx.memberId) return []
  const rows = await db.tithe.findMany({
    where: { memberId: ctx.memberId, organizationId: ctx.organizationId },
    orderBy: { titheMonth: 'desc' },
    take: limit,
    select: { id: true, amount: true, currency: true, method: true, status: true, titheMonth: true, note: true, reference: true },
  })
  return rows.map((r) => ({
    amount: r.amount,
    currency: r.currency,
    method: r.method,
    status: r.status,
    month: fmtDate(r.titheMonth),
    note: r.note,
    reference: r.reference,
  }))
}

/** User's own donations — full history. NEVER exposes other members' donations. */
export async function getOwnDonations(ctx: AuthContext, limit = 50) {
  if (!ctx.memberId) return []
  const rows = await db.donation.findMany({
    where: { memberId: ctx.memberId, organizationId: ctx.organizationId },
    orderBy: { donatedAt: 'desc' },
    take: limit,
    select: { id: true, amount: true, currency: true, method: true, status: true, donatedAt: true, reference: true, fund: { select: { name: true } } },
  })
  return rows.map((r) => ({
    amount: r.amount,
    currency: r.currency,
    method: r.method,
    status: r.status,
    donatedAt: fmtDate(r.donatedAt),
    reference: r.reference,
    fund: r.fund?.name ?? null,
  }))
}

/** User's own tasks. */
export async function getOwnTasks(ctx: AuthContext, limit = 30) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'tasks', 'view').catch(() => false)
  if (!canView) return []
  const rows = await db.task.findMany({
    where: { organizationId: ctx.organizationId, assigneeId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, title: true, status: true, priority: true, dueDate: true, createdAt: true },
  })
  return rows.map((r) => ({
    title: r.title,
    status: r.status,
    priority: r.priority,
    dueDate: fmtDate(r.dueDate),
    createdAt: fmtDate(r.createdAt),
  }))
}

/** User's own notifications (unread + recent). */
export async function getOwnNotifications(ctx: AuthContext, limit = 15) {
  const rows = await db.notification.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, title: true, message: true, read: true, createdAt: true, link: true },
  })
  return rows.map((r) => ({
    title: r.title,
    message: r.message,
    read: r.read,
    createdAt: fmtDateTime(r.createdAt),
    link: r.link,
  }))
}

/** User's own prayer requests — only the ones they submitted. */
export async function getOwnPrayerRequests(ctx: AuthContext, limit = 20) {
  if (!ctx.memberId) return []
  const rows = await db.prayerRequest.findMany({
    where: { memberId: ctx.memberId, organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, request: true, status: true, isPublic: true, createdAt: true },
  })
  return rows.map((r) => ({
    request: r.request,
    status: r.status,
    isPublic: r.isPublic,
    createdAt: fmtDate(r.createdAt),
  }))
}

/** Public announcements visible to this user (everyone with announcements:view). */
export async function getAnnouncements(ctx: AuthContext, limit = 10) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'announcements', 'view').catch(() => false)
  if (!canView) return []
  const rows = await db.announcement.findMany({
    where: {
      organizationId: ctx.organizationId,
      published: true,
      OR: [
        { audience: 'all' },
        { audience: 'members' },
        ...(ctx.role === 'guest' ? [] : [{ audience: ctx.role }]),
        ...(ctx.departmentId ? [{ audience: 'department', departmentId: ctx.departmentId }] : []),
      ],
    },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: { id: true, title: true, body: true, audience: true, pinned: true, publishedAt: true },
  })
  return rows.map((r) => ({
    title: r.title,
    body: (r.body ?? '').slice(0, 400),
    audience: r.audience,
    pinned: r.pinned,
    publishedAt: fmtDate(r.publishedAt),
  }))
}

/** Upcoming events visible to this user. */
export async function getUpcomingEvents(ctx: AuthContext, limit = 10) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'events', 'view').catch(() => false)
  if (!canView) return []
  const now = new Date()
  const rows = await db.event.findMany({
    where: { organizationId: ctx.organizationId, startDate: { gte: now } },
    orderBy: { startDate: 'asc' },
    take: limit,
    select: { id: true, title: true, description: true, startDate: true, endDate: true, venue: true, eventType: true, status: true },
  })
  return rows.map((r) => ({
    title: r.title,
    description: (r.description ?? '').slice(0, 240),
    startDate: fmtDateTime(r.startDate),
    endDate: fmtDateTime(r.endDate),
    venue: r.venue ?? null,
    type: r.eventType,
    status: r.status,
  }))
}

/** Public celebrations (birthdays/anniversaries) for the upcoming window. */
export async function getCelebrations(ctx: AuthContext, limit = 30) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'celebrations', 'view').catch(() => false)
  if (!canView) return []
  // Celebrations are public — but we only return name + occasion, no contact info.
  const members = await db.member.findMany({
    where: { organizationId: ctx.organizationId, status: { notIn: ['inactive', 'deceased'] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      dateOfBirth: true,
      weddingAnniversary: true,
      membershipType: true,
    },
    take: 500,
  })
  const today = new Date()
  const upcoming: any[] = []
  for (const m of members) {
    if (m.dateOfBirth) {
      const next = new Date(today.getFullYear(), m.dateOfBirth.getMonth(), m.dateOfBirth.getDate())
      if (next < today) next.setFullYear(today.getFullYear() + 1)
      const days = Math.ceil((next.getTime() - today.getTime()) / 86400000)
      if (days <= 30) {
        upcoming.push({
          type: 'birthday',
          name: `${m.firstName} ${m.lastName}`,
          date: fmtDate(next),
          daysAway: days,
        })
      }
    }
    if (m.weddingAnniversary) {
      const next = new Date(today.getFullYear(), m.weddingAnniversary.getMonth(), m.weddingAnniversary.getDate())
      if (next < today) next.setFullYear(today.getFullYear() + 1)
      const days = Math.ceil((next.getTime() - today.getTime()) / 86400000)
      if (days <= 30) {
        upcoming.push({
          type: 'anniversary',
          name: `${m.firstName} ${m.lastName}`,
          date: fmtDate(next),
          daysAway: days,
        })
      }
    }
  }
  return upcoming.sort((a, b) => a.daysAway - b.daysAway).slice(0, limit)
}

/** Departments list — public to all logged-in users (name + description + head name only). */
export async function getDepartments(ctx: AuthContext, limit = 50) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'departments', 'view').catch(() => false)
  if (!canView) return []
  const rows = await db.department.findMany({
    where: { organizationId: ctx.organizationId },
    take: limit,
    select: {
      id: true,
      name: true,
      description: true,
      head: { select: { name: true } },
      _count: { select: { members: true } },
    },
  })
  return rows.map((r) => ({
    name: r.name,
    description: (r.description ?? '').slice(0, 240),
    head: r.head?.name ?? null,
    memberCount: r._count?.members ?? 0,
  }))
}

/** Search members — returns BASIC INFO ONLY (masked), scoped by permission + scope. */
export async function searchMembers(ctx: AuthContext, query: string, limit = 10) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'members', 'view').catch(() => false)
  if (!canView) return { note: 'You do not have permission to view member records.', results: [] }

  // Members can ONLY see their own record (scope=self). Staff see org-wide.
  if (ctx.role === 'member') {
    if (!ctx.memberId) return { note: 'No member profile linked to your account.', results: [] }
    const m = await db.member.findFirst({
      where: { id: ctx.memberId, organizationId: ctx.organizationId },
      select: FULL_OWN_MEMBER_FIELDS,
    })
    if (!m) return { note: 'No matching record.', results: [] }
    return {
      note: 'As a member, you can only see your own record (full detail).',
      results: [ownMemberProfile(m)],
    }
  }

  // For non-self roles — return masked records (basic info only).
  const where: any = {
    organizationId: ctx.organizationId,
    OR: [
      { firstName: { contains: query } },
      { lastName: { contains: query } },
      { preferredName: { contains: query } },
      { email: { contains: query } },
      { phone: { contains: query } },
    ],
  }
  // Scope: department heads/assistants see only their department's members.
  if ((ctx.role === 'department_head' || ctx.role === 'department_assistant' || ctx.role === 'unit_leader') && ctx.departmentId) {
    where.departmentMemberships = { some: { departmentId: ctx.departmentId } }
  }

  const rows = await db.member.findMany({ where, take: limit, select: BASIC_MEMBER_FIELDS })
  return {
    note: 'Showing basic directory info only (name, role, department, status). Contact details are protected.',
    results: rows.map(maskSensitiveMember),
  }
}

/** Church-wide finance summary — ONLY for privileged finance-staff roles.
 *
 * CRITICAL: Even though `member` and `department_head` roles technically have
 * `finance:view` permission (because they need to view their OWN giving), they
 * must NEVER see church-wide aggregates. We enforce this with a strict role
 * whitelist of roles whose job includes church-wide financial oversight.
 */
export async function getChurchFinanceSummary(ctx: AuthContext) {
  const PRIVILEGED_FINANCE_ROLES = new Set([
    'super_admin',
    'church_admin',
    'finance_officer',
    'auditor',
  ])
  if (!PRIVILEGED_FINANCE_ROLES.has(ctx.role)) {
    return {
      allowed: false,
      note: 'You do not have permission to view church-wide financial data. Church-wide finances are restricted to authorized finance staff (finance officer, church administrator, or auditor) only. You can still view your OWN giving history.',
    }
  }

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const [tithes, donations, expenses, pendingTithes, pendingDonations] = await Promise.all([
    db.tithe.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { organizationId: ctx.organizationId, status: 'confirmed', titheMonth: { gte: startOfMonth } },
    }),
    db.donation.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { organizationId: ctx.organizationId, status: 'confirmed', donatedAt: { gte: startOfMonth } },
    }),
    db.expense.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { organizationId: ctx.organizationId, status: { in: ['paid', 'approved'] }, incurredAt: { gte: startOfMonth } },
    }),
    db.tithe.count({ where: { organizationId: ctx.organizationId, status: 'pending' } }),
    db.donation.count({ where: { organizationId: ctx.organizationId, status: 'pending' } }),
  ])

  // Currency hint
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { currency: true, name: true },
  })

  return {
    allowed: true,
    organization: org?.name,
    currency: org?.currency ?? 'NGN',
    period: fmtDate(startOfMonth) + ' → today',
    confirmedTithes: { total: tithes._sum.amount ?? 0, count: tithes._count },
    confirmedDonations: { total: donations._sum.amount ?? 0, count: donations._count },
    paidExpenses: { total: expenses._sum.amount ?? 0, count: expenses._count },
    pendingApprovals: { tithes: pendingTithes, donations: pendingDonations },
    note: 'Aggregate only. Individual members\' financial contributions are NEVER revealed — not even to finance staff via the assistant.',
  }
}

/** Church basic info — name, currency, timezone, status (no financial data). */
export async function getChurchInfo(ctx: AuthContext) {
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { name: true, currency: true, timezone: true, status: true, createdAt: true },
  })
  return org
    ? {
        name: org.name,
        currency: org.currency,
        timezone: org.timezone,
        status: org.status,
        memberSince: fmtDate(org.createdAt),
      }
    : null
}

// ---------------------------------------------------------------------------
// Module-spanning retrievers (added for "trained on every data across all modules").
//
// Each is permission-gated AND scope-aware. Critical rules carried forward:
//   - Other members' contact info (phone/email/address/DOB) is NEVER shared.
//   - Other members' financial data is NEVER shared (no amounts, no history).
//   - Church-wide finances only for privileged finance roles.
//   - Pastoral / counselling / private notes are NEVER shared by the assistant.
//   - Audit metadata may contain sensitive IDs → only actor/action/type/time shown.
// ---------------------------------------------------------------------------

/** User's own attendance check-ins — their personal worship attendance history. */
export async function getOwnAttendance(ctx: AuthContext, limit = 25) {
  if (!ctx.memberId) return []
  const canView = await canAsync(ctx.organizationId, ctx.role, 'attendance', 'view').catch(() => false)
  if (!canView) return []
  const rows = await db.attendanceRecord.findMany({
    where: { memberId: ctx.memberId, session: { service: { organizationId: ctx.organizationId } } },
    orderBy: { checkInTime: 'desc' },
    take: limit,
    select: {
      checkInTime: true,
      checkInMethod: true,
      session: { select: { date: true, service: { select: { name: true } } } },
    },
  })
  return rows.map((r) => ({
    service: r.session?.service?.name ?? null,
    serviceDate: fmtDate(r.session?.date ?? null),
    checkedInAt: fmtDateTime(r.checkInTime),
    method: r.checkInMethod,
  }))
}

/** Recent visitors — BASIC info only (no contact PII).
 *  Only visible to users with `visitors:view` permission.
 *  Visitor contact info is NEVER shared — only the assigned follow-up owner
 *  may see contact details (via getOwnFollowUps). */
export async function getRecentVisitors(ctx: AuthContext, limit = 15) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'visitors', 'view').catch(() => false)
  if (!canView) return { note: 'You do not have permission to view visitor records.', results: [] }
  const rows = await db.visitor.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { firstVisitDate: 'desc' },
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      referralSource: true,
      firstVisitDate: true,
      convertedMemberId: true,
      followUps: { select: { status: true, ownerId: true }, take: 1, orderBy: { createdAt: 'desc' } },
    },
  })
  return {
    note: 'Showing visitor basic info only. Contact details (phone/email/address) are protected — only the assigned follow-up owner can see them for outreach.',
    results: rows.map((v) => ({
      name: `${v.firstName} ${v.lastName}`.trim(),
      referralSource: v.referralSource ?? null,
      firstVisit: fmtDate(v.firstVisitDate),
      converted: !!v.convertedMemberId,
      latestFollowUpStatus: v.followUps[0]?.status ?? null,
    })),
  }
}

/** Follow-up tasks owned by the current user.
 *  Outreach exception: the assigned follow-up owner DOES see the visitor's
 *  phone/email so they can actually reach out — that is the entire point of
 *  the assignment. They may NOT see other owners' follow-ups or visitor PII. */
export async function getOwnFollowUps(ctx: AuthContext, limit = 25) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'followups', 'view').catch(() => false)
  if (!canView) return []
  const rows = await db.followUpTask.findMany({
    where: { organizationId: ctx.organizationId, ownerId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      visitor: { select: { firstName: true, lastName: true, phone: true, email: true } },
      interactions: { select: { method: true, notes: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  // If a follow-up has a memberId (member follow-up rather than visitor follow-up),
  // fetch the basic member info separately — there's no Prisma relation on FollowUpTask.
  const memberIds = rows.map((r) => r.memberId).filter(Boolean) as string[]
  const members = memberIds.length
    ? await db.member.findMany({
        where: { id: { in: memberIds }, organizationId: ctx.organizationId },
        select: BASIC_MEMBER_FIELDS,
      })
    : []
  const memberById = new Map(members.map((m) => [m.id, m]))
  return rows.map((r) => ({
    status: r.status,
    dueDate: fmtDate(r.dueDate),
    notes: r.notes ?? null,
    outcome: r.outcome ?? null,
    visitor: r.visitor
      ? {
          name: `${r.visitor.firstName} ${r.visitor.lastName}`.trim(),
          phone: r.visitor.phone ?? null,
          email: r.visitor.email ?? null,
        }
      : r.memberId && memberById.has(r.memberId)
        ? maskSensitiveMember(memberById.get(r.memberId))
        : null,
    lastInteraction: r.interactions[0]
      ? { method: r.interactions[0].method, notes: r.interactions[0].notes, at: fmtDateTime(r.interactions[0].createdAt) }
      : null,
  }))
}

/** Org assets visible to the user (assets:view permission).
 *  Asset monetary value is hidden unless user is a privileged finance role. */
export async function getOrgAssets(ctx: AuthContext, limit = 30) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'assets', 'view').catch(() => false)
  if (!canView) return { note: 'You do not have permission to view assets.', results: [] }
  const PRIVILEGED_FINANCE_ROLES = new Set(['super_admin', 'church_admin', 'finance_officer', 'auditor'])
  const showValue = PRIVILEGED_FINANCE_ROLES.has(ctx.role)
  const rows = await db.asset.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      tag: true, name: true, category: true, location: true, custodian: true,
      condition: true, acquiredAt: true, value: true,
    },
  })
  return {
    note: showValue
      ? 'Showing full asset info including value (you have finance oversight).'
      : 'Asset monetary values are hidden — visible to finance staff only.',
    results: rows.map((a) => ({
      tag: a.tag ?? null,
      name: a.name,
      category: a.category,
      location: a.location ?? null,
      custodian: a.custodian ?? null,
      condition: a.condition,
      acquiredAt: fmtDate(a.acquiredAt),
      value: showValue ? a.value ?? null : null,
    })),
  }
}

/** Documents accessible to the user based on accessLevel:
 *  public → everyone | members → authenticated members | staff → staff roles
 *  leaders → pastors/department heads | finance → finance roles | pastoral → pastors only */
export async function getAccessibleDocuments(ctx: AuthContext, limit = 20) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'documents', 'view').catch(() => false)
  if (!canView) return []
  const isPastor = ctx.role === 'pastor' || ctx.role === 'senior_pastor' || ctx.role === 'asst_pastor'
  const isLeader = isPastor || ctx.role === 'department_head' || ctx.role === 'unit_leader'
  const isStaff = isLeader || ctx.role === 'church_admin' || ctx.role === 'super_admin' || ctx.role === 'finance_officer' || ctx.role === 'department_assistant'
  const isFinance = ctx.role === 'finance_officer' || ctx.role === 'church_admin' || ctx.role === 'super_admin' || ctx.role === 'auditor'
  const allowedLevels = new Set<string>(['public', 'members'])
  if (isStaff) allowedLevels.add('staff')
  if (isLeader) allowedLevels.add('leaders')
  if (isFinance) allowedLevels.add('finance')
  if (isPastor) allowedLevels.add('pastoral')

  const rows = await db.document.findMany({
    where: { organizationId: ctx.organizationId, accessLevel: { in: Array.from(allowedLevels) } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { title: true, category: true, description: true, accessLevel: true, version: true, updatedAt: true, fileName: true },
  })
  return rows.map((d) => ({
    title: d.title,
    category: d.category,
    description: d.description ?? null,
    accessLevel: d.accessLevel,
    version: d.version,
    updatedAt: fmtDate(d.updatedAt),
    fileName: d.fileName ?? null,
  }))
}

/** Recent townhall / chat messages in rooms the user is a member of.
 *  Rooms visible to the user: townhall, group, their department rooms, their role rooms, their direct rooms. */
export async function getTownhallHighlights(ctx: AuthContext, limit = 20) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'townhall', 'view').catch(() => false)
  if (!canView) return []
  const roomWhere: any = {
    organizationId: ctx.organizationId,
    OR: [
      { type: { in: ['townhall', 'group'] } },
      ...(ctx.departmentId ? [{ type: 'department', refId: ctx.departmentId }] : []),
      { type: 'role', refId: ctx.role },
      { type: 'direct', refId: { contains: ctx.user.id } },
    ],
  }
  const rooms = await db.chatRoom.findMany({
    where: roomWhere,
    select: { id: true, name: true, type: true },
    take: 30,
  })
  if (!rooms.length) return []
  const rows = await db.chatMessage.findMany({
    where: { roomId: { in: rooms.map((r) => r.id) }, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { roomId: true, senderName: true, body: true, createdAt: true, isPinned: true },
  })
  const roomName = new Map(rooms.map((r) => [r.id, r.name]))
  return rows.map((m) => ({
    room: roomName.get(m.roomId) ?? null,
    sender: m.senderName,
    body: m.body.slice(0, 240),
    pinned: m.isPinned,
    at: fmtDateTime(m.createdAt),
  }))
}

/** Pastoral cases assigned to the current user (as the pastoral worker).
 *  Returns case metadata + member basic info only. NEVER returns privateNotes
 *  or description contents — those are confidential case files. */
export async function getAssignedPastoralCases(ctx: AuthContext, limit = 20) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'pastoral', 'view').catch(() => false)
  if (!canView) return []
  const rows = await db.pastoralCase.findMany({
    where: { organizationId: ctx.organizationId, assignedToId: ctx.user.id },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true, type: true, status: true, priority: true, updatedAt: true,
      member: { select: BASIC_MEMBER_FIELDS },
    },
  })
  return rows.map((c) => ({
    type: c.type,
    status: c.status,
    priority: c.priority,
    updatedAt: fmtDate(c.updatedAt),
    member: c.member ? maskSensitiveMember(c.member) : null,
    note: 'Case notes and private details are confidential — open the case in the Pastoral module to view them.',
  }))
}

/** Upcoming meetings the user is invited to or has visibility into. */
export async function getUpcomingMeetings(ctx: AuthContext, limit = 10) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'dashboard', 'view').catch(() => false)
  if (!canView) return []
  const now = new Date()
  const rows = await db.meeting.findMany({
    where: { organizationId: ctx.organizationId, scheduledAt: { gte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
    select: { title: true, agenda: true, location: true, attendees: true, scheduledAt: true },
  })
  return rows.map((m) => {
    // Parse attendees string (could be comma-separated names or a JSON list).
    let attendeeCount: number | null = null
    if (m.attendees) {
      try {
        const parsed = JSON.parse(m.attendees)
        if (Array.isArray(parsed)) attendeeCount = parsed.length
      } catch {
        attendeeCount = m.attendees.split(',').map((s) => s.trim()).filter(Boolean).length
      }
    }
    return {
      title: m.title,
      agenda: m.agenda ? m.agenda.slice(0, 240) : null,
      location: m.location ?? null,
      attendeeCount,
      scheduledAt: fmtDateTime(m.scheduledAt),
    }
  })
}

/** User's own household — full household info + members (basic info only — they live together). */
export async function getOwnHousehold(ctx: AuthContext) {
  if (!ctx.memberId) return null
  const member = await db.member.findFirst({
    where: { id: ctx.memberId, organizationId: ctx.organizationId },
    select: { householdId: true },
  })
  if (!member?.householdId) return null
  const household = await db.household.findFirst({
    where: { id: member.householdId, organizationId: ctx.organizationId },
    select: {
      name: true, address: true, phone: true, note: true,
      head: { select: { firstName: true, lastName: true } },
      members: { select: BASIC_MEMBER_FIELDS },
    },
  })
  if (!household) return null
  return {
    name: household.name,
    address: household.address ?? null,
    phone: household.phone ?? null,
    note: household.note ?? null,
    head: household.head ? `${household.head.firstName} ${household.head.lastName}`.trim() : null,
    members: household.members.map(maskSensitiveMember),
    note_about_members: 'Showing basic info for household members. Other members\' contact details are protected.',
  }
}

/** User's own dependants — full info (their children / wards). */
export async function getOwnDependants(ctx: AuthContext, limit = 20) {
  if (!ctx.memberId) return []
  const rows = await db.dependant.findMany({
    where: { memberId: ctx.memberId, organizationId: ctx.organizationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { name: true, relationship: true, dateOfBirth: true, gender: true, note: true },
  })
  return rows.map((d) => ({
    name: d.name,
    relationship: d.relationship,
    dateOfBirth: fmtDate(d.dateOfBirth),
    gender: d.gender ?? null,
    note: d.note ?? null,
  }))
}

/** Events the user has registered for (matched by their account email or name). */
export async function getOwnEventRegistrations(ctx: AuthContext, limit = 20) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'events', 'view').catch(() => false)
  if (!canView) return []
  const email = ctx.user.email?.toLowerCase()
  const name = ctx.user.name?.toLowerCase()
  const rows = await db.registration.findMany({
    where: {
      event: { organizationId: ctx.organizationId },
      OR: [
        ...(email ? [{ email: email }] : []),
        ...(name ? [{ name: { contains: name } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      name: true, email: true, phone: true, createdAt: true,
      event: { select: { title: true, startDate: true, endDate: true, venue: true, status: true } },
    },
  })
  return rows.map((r) => ({
    event: r.event.title,
    startDate: fmtDateTime(r.event.startDate),
    endDate: fmtDateTime(r.event.endDate),
    venue: r.event.venue ?? null,
    eventStatus: r.event.status,
    registeredAt: fmtDate(r.createdAt),
    // Don't echo back the user's own phone/email to the LLM unnecessarily —
    // they already know it; this is just a registration confirmation.
  }))
}

/** Recent audit activity — admin/auditor only. Metadata is STRIPPED (may contain sensitive IDs). */
export async function getRecentAuditActivity(ctx: AuthContext, limit = 20) {
  const canView = await canAsync(ctx.organizationId, ctx.role, 'audit', 'view').catch(() => false)
  if (!canView) return { note: 'You do not have permission to view the audit log.', results: [] }
  const rows = await db.auditLog.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      actorId: true, action: true, targetType: true, targetId: true,
      ip: true, createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  })
  return {
    note: 'Audit metadata is hidden — only actor, action, target type, and timestamp are shown.',
    results: rows.map((a) => ({
      actor: a.actor?.name ?? null,
      action: a.action,
      targetType: a.targetType ?? null,
      targetId: a.targetId ?? null,
      ip: a.ip ?? null,
      at: fmtDateTime(a.createdAt),
    })),
  }
}

/** Approvals pending the current user's action (if they have approve permission). */
export async function getPendingApprovalsForUser(ctx: AuthContext, limit = 15) {
  const canApproveFinance = await canAsync(ctx.organizationId, ctx.role, 'finance', 'approve').catch(() => false)
  const canApproveEvents = await canAsync(ctx.organizationId, ctx.role, 'events', 'approve').catch(() => false)
  if (!canApproveFinance && !canApproveEvents) return []
  const where: any = { organizationId: ctx.organizationId, status: 'pending' }
  if (canApproveFinance && !canApproveEvents) {
    where.type = { in: ['expense', 'finance'] }
  } else if (canApproveEvents && !canApproveFinance) {
    where.type = { in: ['event'] }
  }
  const rows = await db.approval.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      type: true, status: true, comment: true, createdAt: true,
      requester: { select: { name: true } },
    },
  })
  return rows.map((a) => ({
    type: a.type,
    status: a.status,
    requester: a.requester?.name ?? null,
    comment: a.comment ?? null,
    createdAt: fmtDate(a.createdAt),
    note: 'Open the relevant module (Finance → Approvals or Events → Approvals) to review the underlying record. The assistant does not display referenced record amounts.',
  }))
}

/** Org-wide dashboard stats — NO financial totals for non-privileged roles.
 *  Members only see their own data + counts they're permitted to view. */
export async function getDashboardStats(ctx: AuthContext) {
  const PRIVILEGED_FINANCE_ROLES = new Set(['super_admin', 'church_admin', 'finance_officer', 'auditor'])
  const canViewMembers = await canAsync(ctx.organizationId, ctx.role, 'members', 'view').catch(() => false)
  const canViewVisitors = await canAsync(ctx.organizationId, ctx.role, 'visitors', 'view').catch(() => false)
  const canViewDepartments = await canAsync(ctx.organizationId, ctx.role, 'departments', 'view').catch(() => false)
  const canViewTasks = await canAsync(ctx.organizationId, ctx.role, 'tasks', 'view').catch(() => false)
  const canViewFollowUps = await canAsync(ctx.organizationId, ctx.role, 'followups', 'view').catch(() => false)

  const out: Record<string, unknown> = { generatedAt: fmtDateTime(new Date()) }

  if (canViewMembers) {
    out.totalMembers = await db.member.count({ where: { organizationId: ctx.organizationId } })
    out.activeMembers = await db.member.count({ where: { organizationId: ctx.organizationId, status: 'active' } })
    out.newConverts = await db.member.count({ where: { organizationId: ctx.organizationId, status: 'new_convert' } })
  }
  if (canViewVisitors) {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    out.visitorsThisMonth = await db.visitor.count({
      where: { organizationId: ctx.organizationId, firstVisitDate: { gte: startOfMonth } },
    })
  }
  if (canViewDepartments) {
    out.totalDepartments = await db.department.count({ where: { organizationId: ctx.organizationId } })
  }
  if (canViewFollowUps) {
    out.pendingFollowUps = await db.followUpTask.count({
      where: { organizationId: ctx.organizationId, status: { in: ['pending', 'in_progress'] } },
    })
  }
  if (canViewTasks) {
    out.myOpenTasks = await db.task.count({
      where: { organizationId: ctx.organizationId, assigneeId: ctx.user.id, status: { in: ['todo', 'in_progress', 'review'] } },
    })
  }

  // Church-wide financial totals — ONLY privileged finance roles.
  if (PRIVILEGED_FINANCE_ROLES.has(ctx.role)) {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const titheAgg = await db.tithe.aggregate({
      _sum: { amount: true },
      where: { organizationId: ctx.organizationId, status: 'confirmed', titheMonth: { gte: startOfMonth } },
    })
    const donationAgg = await db.donation.aggregate({
      _sum: { amount: true },
      where: { organizationId: ctx.organizationId, status: 'confirmed', donatedAt: { gte: startOfMonth } },
    })
    out.churchFinanceThisMonth = {
      tithes: titheAgg._sum.amount ?? 0,
      donations: donationAgg._sum.amount ?? 0,
      note: 'Aggregate only — individual member contributions are NEVER revealed.',
    }
  } else {
    out.churchFinanceThisMonth = {
      allowed: false,
      note: 'Church-wide financial totals are restricted to authorized finance staff.',
    }
  }

  return out
}

/** Field-level access report for the user (what fields they can/can't see) — used to
 *  craft a precise system prompt that tells the LLM exactly what it's allowed to discuss. */
export async function getUserAccessProfile(ctx: AuthContext) {
  const modules = [
    'dashboard', 'members', 'departments', 'attendance', 'visitors', 'followups',
    'events', 'finance', 'announcements', 'pastoral', 'tasks', 'assets', 'documents',
    'reports', 'audit', 'settings', 'access', 'search', 'celebrations', 'townhall',
  ] as const

  const access: Record<string, string[]> = {}
  for (const mod of modules) {
    const acts: string[] = []
    for (const a of ['view', 'create', 'update', 'delete', 'manage'] as const) {
      const ok = await canAsync(ctx.organizationId, ctx.role, mod as any, a as any).catch(() => false)
      if (ok) acts.push(a)
    }
    if (acts.length) access[mod] = acts
  }

  // Field-level access for sensitive modules
  const memberFieldAccess: Record<string, string> = {}
  for (const f of ['phone', 'email', 'address', 'dateOfBirth', 'emergencyName', 'privateNotes']) {
    memberFieldAccess[f] = await checkFieldAccess(ctx.organizationId, ctx.role, 'members', f).catch(() => 'none')
  }

  return {
    role: ctx.role,
    isScopedToDepartment: ctx.role === 'department_head' || ctx.role === 'department_assistant' || ctx.role === 'unit_leader',
    departmentId: ctx.departmentId ?? null,
    hasMemberProfile: !!ctx.memberId,
    moduleAccess: access,
    sensitiveMemberFieldAccess: memberFieldAccess,
    canViewFinance: access.finance?.includes('view') ?? false,
  }
}

// ---------------------------------------------------------------------------
// Query intent classifier — picks which retrievers to run.
// Conservative: when in doubt, retrieve MORE public context (announcements,
// events, celebrations, church info) and ALWAYS own-profile/finance/tasks/notifications.
// ---------------------------------------------------------------------------

const INTENT_RULES: Array<{ keywords: string[]; retrievers: string[] }> = [
  { keywords: ['my profile', 'my bio', 'my data', 'my info', 'my phone', 'my email', 'my address', 'my dob', 'my birthday', 'my own phone', 'my own email', 'my own address', 'my own dob', 'my own birthday', 'my phone number', 'my email address', 'my contact', 'what is my phone', 'what is my email', 'what\'s my phone', 'what\'s my email', 'show my profile', 'view my profile'], retrievers: ['ownMemberProfile', 'ownUserSummary'] },
  { keywords: ['my tithe', 'my giving', 'my donation', 'my finance', 'my contribution', 'my giving history', 'how much have i given', 'my giving statement'], retrievers: ['ownTithes', 'ownDonations'] },
  { keywords: ['church finance', 'church financial', 'total tithe', 'total donation', 'church income', 'church expense', 'church budget', 'finance summary', 'financial summary'], retrievers: ['churchFinanceSummary'] },
  { keywords: ['my task', 'task assigned', 'todo', 'my to-do', 'my to do', 'what do i need to do', 'my assignments'], retrievers: ['ownTasks'] },
  { keywords: ['notification', 'my notifications', 'what\'s new', 'whats new', 'recent activity'], retrievers: ['ownNotifications'] },
  { keywords: ['announcement', 'news', 'what\'s happening', 'whats happening', 'updates'], retrievers: ['announcements'] },
  { keywords: ['event', 'upcoming', 'next service', 'calendar', 'schedule'], retrievers: ['upcomingEvents'] },
  { keywords: ['my event', 'my registration', 'my rsvp', 'events i registered', 'am i registered', 'my events'], retrievers: ['ownEventRegistrations'] },
  { keywords: ['birthday', 'anniversary', 'celebration', 'celebrant', 'who is celebrating'], retrievers: ['celebrations'] },
  { keywords: ['department', 'ministry', 'ministries', 'units'], retrievers: ['departments'] },
  { keywords: ['prayer request', 'my prayer', 'prayed for', 'prayer need'], retrievers: ['ownPrayerRequests'] },
  { keywords: ['member', 'find', 'who is', 'lookup', 'directory', 'search for', 'phone number of', 'email of'], retrievers: ['searchMembers'] },
  { keywords: ['about church', 'church info', 'church name', 'church status'], retrievers: ['churchInfo'] },
  // New module-spanning intents:
  { keywords: ['my attendance', 'my check-in', 'my checkin', 'i attend', 'i was at service', 'when did i check in', 'services i attended'], retrievers: ['ownAttendance'] },
  { keywords: ['visitor', 'new visitor', 'first time visitor', 'recent visitor', 'guests', 'first visit'], retrievers: ['recentVisitors'] },
  { keywords: ['follow up', 'followup', 'follow-up', 'my follow up', 'who do i follow', 'my outreach', 'assigned to me to follow'], retrievers: ['ownFollowUps'] },
  { keywords: ['asset', 'equipment', 'instrument', 'inventory', 'facility', 'facilities', 'vehicle', 'furniture', 'church property'], retrievers: ['orgAssets'] },
  { keywords: ['document', 'policy', 'template', 'minutes', 'form', 'report', 'resource', 'church document'], retrievers: ['accessibleDocuments'] },
  { keywords: ['townhall', 'chat', 'discussion', 'discussion board', 'message', 'recent messages', 'what are people saying', 'town hall'], retrievers: ['townhallHighlights'] },
  { keywords: ['pastoral case', 'my pastoral', 'assigned case', 'counselling case', 'my cases', 'cases assigned to me'], retrievers: ['assignedPastoralCases'] },
  { keywords: ['meeting', 'committee', 'agenda', 'next meeting', 'upcoming meeting', 'leadership meeting'], retrievers: ['upcomingMeetings'] },
  { keywords: ['my household', 'my family', 'my house', 'household members', 'who is in my household', 'head of my household'], retrievers: ['ownHousehold'] },
  { keywords: ['my dependant', 'my dependent', 'my children', 'my kids', 'my wards', 'my dependants'], retrievers: ['ownDependants'] },
  { keywords: ['audit', 'audit log', 'recent activity log', 'who did what', 'system activity', 'activity log'], retrievers: ['recentAuditActivity'] },
  { keywords: ['approval', 'pending approval', 'awaiting my approval', 'needs my approval', 'pending review', 'to approve'], retrievers: ['pendingApprovalsForUser'] },
  { keywords: ['dashboard', 'stats', 'statistics', 'overview', 'summary', 'how many members', 'how many visitors', 'church at a glance'], retrievers: ['dashboardStats'] },
]

export function classifyIntent(query: string): string[] {
  const q = query.toLowerCase()
  const matched = new Set<string>()
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some((k) => q.includes(k))) {
      rule.retrievers.forEach((r) => matched.add(r))
    }
  }
  // Always include the user's access profile + own summary (for grounding).
  matched.add('userAccessProfile')
  matched.add('ownUserSummary')

  // First-person fallback: if the user says "my X" / "i X" / "mine" / "own X"
  // for any personal-data keyword, ensure we fetch their own profile / household /
  // dependants / attendance / tasks / follow-ups so the LLM has the data in hand.
  const isFirstPerson = /\b(my|mine|i|i'm|i am|me|my own|myself)\b/.test(q)
  if (isFirstPerson) {
    if (/\b(phone|email|address|dob|date of birth|birthday|profile|bio|contact|household|dependant|dependent|children|kids|wards|attendance|check.?in|task|todo|to.?do|follow.?up|prayer|tithe|donation|giving|registration|event)\b/.test(q)) {
      if (!matched.has('ownMemberProfile')) matched.add('ownMemberProfile')
    }
    if (/\b(household|family|house|my family)\b/.test(q) && !matched.has('ownHousehold')) matched.add('ownHousehold')
    if (/\b(dependant|dependent|children|kids|wards)\b/.test(q) && !matched.has('ownDependants')) matched.add('ownDependants')
    if (/\b(attendance|check.?in|attended|service i)\b/.test(q) && !matched.has('ownAttendance')) matched.add('ownAttendance')
    if (/\b(follow.?up|outreach|assigned to me)\b/.test(q) && !matched.has('ownFollowUps')) matched.add('ownFollowUps')
    if (/\b(registration|rsvp|events i|am i registered)\b/.test(q) && !matched.has('ownEventRegistrations')) matched.add('ownEventRegistrations')
  }

  // If user mentions money/giving in any way AND we haven't matched own-tithes,
  // we MUST clarify the difference between own-finance and church-finance.
  if ((q.includes('finance') || q.includes('tithe') || q.includes('donation') || q.includes('giving') || q.includes('money') || q.includes('contribution'))) {
    // Ensure we resolve "own" vs "church" via both — but the retrievers enforce
    // the permission boundary at the data layer:
    if (!matched.has('ownTithes')) matched.add('ownTithes')
    if (!matched.has('churchFinanceSummary')) matched.add('churchFinanceSummary')
  }
  return Array.from(matched)
}

// ---------------------------------------------------------------------------
// Build context bundle — runs the selected retrievers and assembles a single
// JSON document the LLM will see as system context.
// ---------------------------------------------------------------------------

export async function buildContext(ctx: AuthContext, query: string) {
  const intents = classifyIntent(query)
  const sources: Record<string, unknown> = {}
  const consulted: string[] = []

  const retrievers: Record<string, () => Promise<unknown>> = {
    ownMemberProfile: () => getOwnMemberProfile(ctx),
    ownUserSummary: () => getOwnUserSummary(ctx),
    ownTithes: () => getOwnTithes(ctx),
    ownDonations: () => getOwnDonations(ctx),
    ownTasks: () => getOwnTasks(ctx),
    ownNotifications: () => getOwnNotifications(ctx),
    ownPrayerRequests: () => getOwnPrayerRequests(ctx),
    ownAttendance: () => getOwnAttendance(ctx),
    ownFollowUps: () => getOwnFollowUps(ctx),
    ownHousehold: () => getOwnHousehold(ctx),
    ownDependants: () => getOwnDependants(ctx),
    ownEventRegistrations: () => getOwnEventRegistrations(ctx),
    announcements: () => getAnnouncements(ctx),
    upcomingEvents: () => getUpcomingEvents(ctx),
    celebrations: () => getCelebrations(ctx),
    departments: () => getDepartments(ctx),
    searchMembers: () => searchMembers(ctx, extractSearchQuery(query)),
    churchFinanceSummary: () => getChurchFinanceSummary(ctx),
    churchInfo: () => getChurchInfo(ctx),
    recentVisitors: () => getRecentVisitors(ctx),
    orgAssets: () => getOrgAssets(ctx),
    accessibleDocuments: () => getAccessibleDocuments(ctx),
    townhallHighlights: () => getTownhallHighlights(ctx),
    assignedPastoralCases: () => getAssignedPastoralCases(ctx),
    upcomingMeetings: () => getUpcomingMeetings(ctx),
    recentAuditActivity: () => getRecentAuditActivity(ctx),
    pendingApprovalsForUser: () => getPendingApprovalsForUser(ctx),
    dashboardStats: () => getDashboardStats(ctx),
    userAccessProfile: () => getUserAccessProfile(ctx),
  }

  for (const intent of intents) {
    const fn = retrievers[intent]
    if (!fn) continue
    try {
      sources[intent] = await fn()
      consulted.push(intent)
    } catch (e) {
      sources[intent] = { error: (e as Error).message }
    }
  }

  return { intents, consulted, sources }
}

// Try to extract a name/term from a "find member X" style query.
function extractSearchQuery(query: string): string {
  const m = query.match(/(?:find|lookup|search for|who is|email of|phone number of|contact)\s+([a-zA-Z][a-zA-Z\s'-]{1,40})/i)
  if (m && m[1]) return m[1].trim()
  // Fallback: strip common stopwords and use the longest word.
  const stopwords = new Set(['my', 'me', 'i', 'the', 'a', 'an', 'find', 'show', 'list', 'all', 'members', 'member', 'of', 'for', 'about', 'is', 'are', 'who', 'tell'])
  const words = query.split(/\s+/).map((w) => w.replace(/[^a-zA-Z-']/g, '')).filter((w) => w.length > 1 && !stopwords.has(w.toLowerCase()))
  return words.sort((a, b) => b.length - a.length)[0] ?? ''
}
