// ChurchOS — Members CRM API
import { rateLimit } from '@/lib/rate-limiter'
// GET  /api/members       — list members (search, filter, server-side pagination)
// POST /api/members       — create a member (+ initial MemberStatusHistory + audit)
//
// Member role gets a DIRECTORY view (basic info, all org members — no PII).
// Staff roles get the full record. Filters: q, status, branchId, departmentId,
// maritalStatus, isWorker, gender.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { broadcastEvent } from '@/lib/ai-events'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { can } from '@/lib/permissions'
import { canAsync } from '@/lib/permissions-db'
import { hashPassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = [
  'visitor', 'new_convert', 'follow_up', 'active', 'inactive', 'transferred', 'deceased',
] as const
type Status = (typeof VALID_STATUSES)[number]

const VALID_GENDERS = ['male', 'female', 'other'] as const
const VALID_MARITAL = ['single', 'married', 'divorced', 'widowed', 'separated'] as const

interface ListResponse {
  items: any[]
  total: number
  page: number
  pageSize: number
  stats: { total: number; active: number; visitors: number; followUp: number }
  isDirectory?: boolean
}

// Roles that see the full directory record (PII included). Everyone else
// (member / guest) sees the BASIC directory view.
const FULL_VIEW_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader',
])

function isFullView(ctx: AuthContext): boolean {
  if ((ctx.user as any).isPartnerAdmin) return true
  return FULL_VIEW_ROLES.has(ctx.role)
}

function basicProjection(m: any) {
  return {
    id: m.id,
    memberId: m.memberId,
    firstName: m.firstName,
    lastName: m.lastName,
    preferredName: m.preferredName,
    photoUrl: m.photoUrl,
    status: m.status,
    membershipType: m.membershipType,
    dateJoined: m.dateJoined,
    branch: m.branch,
    // Linked login account (null when the member has no User login)
    account: m.account ? { id: m.account.id, name: m.account.name, role: m.account.role, active: m.account.active } : null,
    departments: (m.departmentMemberships ?? []).map((dm: any) => ({
      id: dm.department.id,
      name: dm.department.name,
    })),
    // No PII: phone/email/address/DOB/emergency/notes/privateNotes/etc. stripped.
  }
}

function fullProjection(m: any) {
  return {
    id: m.id,
    memberId: m.memberId,
    firstName: m.firstName,
    lastName: m.lastName,
    middleName: m.middleName,
    preferredName: m.preferredName,
    email: m.email,
    phone: m.phone,
    photoUrl: m.photoUrl,
    status: m.status,
    membershipType: m.membershipType,
    gender: m.gender,
    dateOfBirth: m.dateOfBirth,
    dateJoined: m.dateJoined,
    baptized: m.baptized,
    baptizedDate: m.baptizedDate,
    maritalStatus: m.maritalStatus ?? null,
    weddingAnniversary: m.weddingAnniversary ?? null,
    occupation: m.occupation ?? null,
    branch: m.branch,
    // Linked login account (null when the member has no User login)
    account: m.account ? { id: m.account.id, name: m.account.name, email: m.account.email, role: m.account.role, active: m.account.active } : null,
    departments: (m.departmentMemberships ?? []).map((dm: any) => ({
      id: dm.department.id,
      name: dm.department.name,
      color: dm.department.color,
      role: dm.role,
    })),
  }
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('members', 'view')
  if (!rateLimit(ctx.user.id, 'members', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const { organizationId } = ctx

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const status = sp.get('status') ?? ''
  const branchId = sp.get('branchId') ?? ''
  const departmentId = sp.get('departmentId') ?? ''
  const maritalStatus = sp.get('maritalStatus') ?? ''
  const isWorkerParam = sp.get('isWorker')
  const gender = sp.get('gender') ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '10', 10) || 10))

  // Build where clause — always org-scoped
  const where: any = { organizationId }
  if (status && VALID_STATUSES.includes(status as Status)) where.status = status
  if (branchId) where.branchId = branchId
  if (gender && VALID_GENDERS.includes(gender as (typeof VALID_GENDERS)[number])) {
    where.gender = gender
  }
  if (maritalStatus && VALID_MARITAL.includes(maritalStatus as (typeof VALID_MARITAL)[number])) {
    where.maritalStatus = maritalStatus
  }
  if (q) {
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { preferredName: { contains: q } },
      { email: { contains: q } },
      { phone: { contains: q } },
      { memberId: { contains: q } },
    ]
  }
  // isWorker: true=has dept membership, false=no dept membership.
  if (isWorkerParam === 'true' || isWorkerParam === '1') {
    where.departmentMemberships = { some: {} }
  } else if (isWorkerParam === 'false' || isWorkerParam === '0') {
    where.departmentMemberships = { none: {} }
  }
  // departmentId filter (any membership in that department).
  if (departmentId) {
    where.departmentMemberships = {
      ...(where.departmentMemberships || {}),
      some: { departmentId },
    }
  }

  const fullView = isFullView(ctx)

  const [items, total, statusGroups] = await Promise.all([
    db.member.findMany({
      where,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        branch: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, email: true, role: true, active: true } },
        departmentMemberships: {
          include: { department: { select: { id: true, name: true, color: true } } },
        },
      },
    }),
    db.member.count({ where }),
    db.member.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
  ])

  const stats = {
    total: statusGroups.reduce((s, g) => s + g._count, 0),
    active: statusGroups.find((g) => g.status === 'active')?._count ?? 0,
    visitors: statusGroups.find((g) => g.status === 'visitor')?._count ?? 0,
    followUp: statusGroups.find((g) => g.status === 'follow_up')?._count ?? 0,
  }

  const body: ListResponse = {
    items: items.map((m) => (fullView ? fullProjection(m) : basicProjection(m))),
    total,
    page,
    pageSize,
    stats,
    isDirectory: !fullView,
  }
  return NextResponse.json(body)
})

interface CreateBody {
  firstName?: string
  lastName?: string
  middleName?: string
  preferredName?: string
  email?: string | null
  phone?: string | null
  phoneSecondary?: string | null
  gender?: string | null
  dateOfBirth?: string | null
  placeOfBirth?: string | null
  nationality?: string | null
  stateOfOrigin?: string | null
  memberId?: string | null
  status?: string
  membershipType?: string | null
  orgUnitType?: string | null
  baptized?: boolean
  baptizedDate?: string | null
  branchId?: string | null
  address?: string | null
  city?: string | null
  stateProvince?: string | null
  country?: string | null
  postalCode?: string | null
  emergencyName?: string | null
  emergencyPhone?: string | null
  emergencyRelationship?: string | null
  isMinor?: boolean
  guardianName?: string | null
  dateJoined?: string | null
  formerChurch?: string | null
  occupation?: string | null
  employer?: string | null
  educationLevel?: string | null
  languages?: string | null
  maritalStatus?: string | null
  weddingAnniversary?: string | null
  householdName?: string | null
  headOfHousehold?: boolean
  spouseName?: string | null
  spouseMemberId?: string | null
  communicationPreference?: string | null
  photoConsent?: boolean
  dataConsent?: boolean
  notes?: string | null
  privateNotes?: string | null
  photoUrl?: string | null
  // Optional: create a login account at inception
  createLogin?: boolean
  loginEmail?: string
  loginPassword?: string
  loginRole?: string
  loginDepartmentId?: string | null
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('members', 'create')
  if (!rateLimit(ctx.user.id, 'members', 20, 60_000)) return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 })
  const body = (await req.json().catch(() => ({}))) as CreateBody

  // Manual validation — keep consistent with foundation's `pick` style.
  if (!body.firstName || typeof body.firstName !== 'string' || !body.firstName.trim()) {
    return NextResponse.json({ error: 'firstName is required' }, { status: 400 })
  }
  if (!body.lastName || typeof body.lastName !== 'string' || !body.lastName.trim()) {
    return NextResponse.json({ error: 'lastName is required' }, { status: 400 })
  }
  if (body.email && typeof body.email !== 'string') {
    return NextResponse.json({ error: 'email must be a string' }, { status: 400 })
  }
  const status =
    body.status && VALID_STATUSES.includes(body.status as Status) ? body.status! : 'visitor'
  const gender =
    body.gender && VALID_GENDERS.includes(body.gender as (typeof VALID_GENDERS)[number])
      ? body.gender
      : null

  // Verify branch belongs to org if provided
  if (body.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: body.branchId, organizationId: ctx.organizationId },
    })
    if (!branch) {
      return NextResponse.json({ error: 'Invalid branch' }, { status: 400 })
    }
  }

  // Unique email check (soft — only when provided)
  if (body.email) {
    const exists = await db.member.findFirst({
      where: { email: body.email, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (exists) {
      return NextResponse.json(
        { error: 'A member with this email already exists.' },
        { status: 409 },
      )
    }
  }

  // Auto-generate memberId if not provided (GCI/000X pattern)
  let memberId = body.memberId?.trim() || null
  if (!memberId) {
    const count = await db.member.count({ where: { organizationId: ctx.organizationId } })
    memberId = `GCI/${String(1000 + count + 1).padStart(4, '0')}`
  }

  const created = await db.member.create({
    data: {
      organizationId: ctx.organizationId,
      branchId: body.branchId || null,
      memberId,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      middleName: body.middleName?.trim() || null,
      preferredName: body.preferredName?.trim() || null,
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      phoneSecondary: body.phoneSecondary?.trim() || null,
      gender,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
      placeOfBirth: body.placeOfBirth?.trim() || null,
      nationality: body.nationality?.trim() || null,
      stateOfOrigin: body.stateOfOrigin?.trim() || null,
      status,
      membershipType: body.membershipType || 'member',
      orgUnitType: body.orgUnitType || null,
      baptized: !!body.baptized,
      baptizedDate: body.baptizedDate ? new Date(body.baptizedDate) : null,
      address: body.address?.trim() || null,
      city: body.city?.trim() || null,
      stateProvince: body.stateProvince?.trim() || null,
      country: body.country?.trim() || null,
      postalCode: body.postalCode?.trim() || null,
      emergencyName: body.emergencyName?.trim() || null,
      emergencyPhone: body.emergencyPhone?.trim() || null,
      emergencyRelationship: body.emergencyRelationship?.trim() || null,
      isMinor: !!body.isMinor,
      guardianName: body.guardianName?.trim() || null,
      dateJoined: body.dateJoined ? new Date(body.dateJoined) : new Date(),
      formerChurch: body.formerChurch?.trim() || null,
      occupation: body.occupation?.trim() || null,
      employer: body.employer?.trim() || null,
      educationLevel: body.educationLevel || null,
      languages: body.languages?.trim() || null,
      maritalStatus: body.maritalStatus || null,
      weddingAnniversary: body.weddingAnniversary ? new Date(body.weddingAnniversary) : null,
      householdName: body.householdName?.trim() || null,
      headOfHousehold: !!body.headOfHousehold,
      spouseName: body.spouseName?.trim() || null,
      spouseMemberId: body.spouseMemberId?.trim() || null,
      communicationPreference: body.communicationPreference || 'sms',
      photoConsent: !!body.photoConsent,
      dataConsent: !!body.dataConsent,
      notes: body.notes?.trim() || null,
      privateNotes:
        can(ctx.role, 'members', 'update') ? body.privateNotes?.trim() || null : null,
      photoUrl: body.photoUrl?.trim() || null,
    },
    include: { branch: { select: { id: true, name: true } } },
  })

  // Initial status history
  await db.memberStatusHistory.create({
    data: { memberId: created.id, status, reason: 'Initial status on member creation' },
  })

  // Optionally create a login account at inception
  let loginCreated = false
  if (body.createLogin && body.loginEmail && body.loginPassword) {
    const loginEmail = body.loginEmail.trim().toLowerCase()
    const existingUser = await db.user.findUnique({ where: { email: loginEmail } })
    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this login email already exists.' },
        { status: 409 },
      )
    }
    // PRIV-ESC guard: only settings:manage holders may choose a custom login
    // role (members:create alone must never mint privileged accounts). The
    // default 'member' role is always allowed. Super Admin creation is
    // reserved to Super Admin callers (mirrors settings/users POST).
    let loginRole: string = 'member'
    const requestedRole = typeof body.loginRole === 'string' ? body.loginRole.trim() : ''
    if (requestedRole && requestedRole !== 'member') {
      const canManageSettings = await canAsync(ctx.organizationId, ctx.role, 'settings', 'manage').catch(() => false)
      if (!canManageSettings || (requestedRole === 'super_admin' && ctx.role !== 'super_admin')) {
        // Clamp to plain member and record the attempt
        await audit(ctx, 'members.loginRole.clamped', 'user', ctx.user.id, {
          requestedRole,
          forcedRole: 'member',
          member: created.id,
          reason: !canManageSettings
            ? 'caller lacks settings:manage'
            : 'only Super Admins can create Super Admin accounts',
        })
      } else {
        // Custom role must exist + be active in THIS org (same as access/assign)
        const roleRecord = await db.role.findFirst({
          where: { organizationId: ctx.organizationId, name: requestedRole, active: true },
          select: { id: true, name: true },
        })
        if (!roleRecord) {
          return NextResponse.json({ error: 'Invalid login role' }, { status: 400 })
        }
        loginRole = requestedRole
      }
    }
    const user = await db.user.create({
      data: {
        organizationId: ctx.organizationId,
        email: loginEmail,
        name: `${created.firstName} ${created.lastName}`,
        passwordHash: hashPassword(body.loginPassword),
        role: loginRole,
        phone: created.phone,
        memberId: created.id,
        departmentId: body.loginDepartmentId || null,
        active: true,
      },
    })
    loginCreated = true
    // Create a DepartmentMembership so the new member appears in the
    // department's roster (Departments module + Dashboard dept activity counts).
    // Without this, User.departmentId is set (access scope) but the member is
    // invisible in the Departments module — the exact inconsistency the user
    // reported.
    if (body.loginDepartmentId) {
      await db.departmentMembership.create({
        data: { memberId: created.id, departmentId: body.loginDepartmentId, role: 'member' },
      }).catch(() => null) // ignore duplicate-key race
    }
    await audit(ctx, 'settings.user.create', 'user', user.id, {
      email: loginEmail, role: loginRole, fromMemberCreation: created.id,
    })
  }

  await audit(ctx, 'members.create', 'member', created.id, {
    name: `${created.firstName} ${created.lastName}`,
    memberId: created.memberId,
    status,
    loginCreated,
  })

  // Broadcast to the AI assistant live events feed
  await broadcastEvent(ctx, {
    module: 'members',
    action: 'create',
    title: 'New member registered',
    message: `${created.firstName} ${created.lastName} was added to the member directory${created.memberId ? ` (ID: ${created.memberId})` : ''}.`,
    refId: created.id,
    refType: 'member',
  })

  return NextResponse.json({ ...created, loginCreated }, { status: 201 })
})
