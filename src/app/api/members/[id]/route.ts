// ChurchOS — Members detail API
// GET    /api/members/[id]   — single member with relations + finance (role-gated)
// PATCH  /api/members/[id]   — update fields, append status history when status changes
// DELETE /api/members/[id]   — hard delete (admin only), audit
//
// Scoping rules for GET:
//   - Member role viewing their OWN profile (id === ctx.memberId) → FULL detail.
//   - Member role viewing another member → BASIC directory info (no PII, NOT 403).
//   - Staff (full view roles) → FULL detail for all members.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler, type AuthContext } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = [
  'visitor', 'new_convert', 'follow_up', 'active', 'inactive', 'transferred', 'deceased',
] as const
const VALID_GENDERS = ['male', 'female', 'other'] as const

const FULL_VIEW_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'finance_officer',
  'department_head', 'department_assistant', 'unit_leader',
])

function isFullView(ctx: AuthContext, memberId?: string | null): boolean {
  if ((ctx.user as any).isPartnerAdmin) return true
  if (FULL_VIEW_ROLES.has(ctx.role)) return true
  // Member viewing their own linked profile → full detail.
  if (ctx.role === 'member' && memberId && ctx.memberId && memberId === ctx.memberId) return true
  return false
}

type Ctx = Awaited<ReturnType<typeof requirePermission>>

async function getScopedMember(ctx: Ctx, id: string) {
  return db.member.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
}

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'view')
  const { id } = await params
  const member = await db.member.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      branch: { select: { id: true, name: true, location: true } },
      departmentMemberships: {
        include: {
          department: {
            select: { id: true, name: true, color: true, description: true },
          },
        },
      },
      statusHistory: { orderBy: { changedAt: 'desc' }, take: 30 },
      followUpOwner: { select: { id: true, name: true, email: true } },
    },
  })
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const fullView = isFullView(ctx, member.id)

  // ---- BASIC directory view (members viewing others) ----
  if (!fullView) {
    return NextResponse.json({
      id: member.id,
      memberId: member.memberId,
      firstName: member.firstName,
      lastName: member.lastName,
      preferredName: member.preferredName,
      photoUrl: member.photoUrl,
      status: member.status,
      dateJoined: member.dateJoined,
      branch: member.branch,
      departments: member.departmentMemberships.map((dm) => ({
        id: dm.department.id,
        name: dm.department.name,
      })),
      // PII (phone/email/address/DOB/emergency/etc.) intentionally stripped.
      isDirectory: true,
    })
  }

  // ---- FULL detail view (staff OR self) ----
  const [attendanceCount, donationAgg] = await Promise.all([
    db.attendanceRecord.count({ where: { memberId: member.id } }),
    can(ctx.role, 'finance', 'view')
      ? db.donation.aggregate({
          where: { memberId: member.id, status: 'confirmed' },
          _sum: { amount: true },
          _count: true,
        })
      : Promise.resolve(null),
  ])

  const canSeePrivate = can(ctx.role, 'members', 'update')

  return NextResponse.json({
    id: member.id,
    memberId: member.memberId,
    firstName: member.firstName,
    lastName: member.lastName,
    middleName: member.middleName,
    preferredName: member.preferredName,
    email: member.email,
    phone: member.phone,
    photoUrl: member.photoUrl,
    gender: member.gender,
    dateOfBirth: member.dateOfBirth,
    address: member.address,
    emergencyName: member.emergencyName,
    emergencyPhone: member.emergencyPhone,
    status: member.status,
    isMinor: member.isMinor,
    guardianName: member.guardianName,
    dateJoined: member.dateJoined,
    baptized: member.baptized,
    baptizedDate: member.baptizedDate,
    maritalStatus: member.maritalStatus ?? null,
    weddingAnniversary: member.weddingAnniversary ?? null,
    occupation: member.occupation ?? null,
    notes: member.notes,
    privateNotes: canSeePrivate ? member.privateNotes : null,
    branch: member.branch,
    departments: member.departmentMemberships.map((dm) => ({
      id: dm.department.id,
      name: dm.department.name,
      color: dm.department.color,
      role: dm.role,
      joinedAt: dm.joinedAt,
    })),
    statusHistory: member.statusHistory.map((h) => ({
      id: h.id,
      status: h.status,
      reason: h.reason,
      changedAt: h.changedAt,
    })),
    attendanceCount,
    donations: donationAgg
      ? { total: donationAgg._sum.amount ?? 0, count: donationAgg._count }
      : null,
    followUpOwner: member.followUpOwner,
    isDirectory: false,
  })
})

interface PatchBody {
  firstName?: string
  lastName?: string
  middleName?: string | null
  preferredName?: string | null
  email?: string | null
  phone?: string | null
  gender?: string | null
  dateOfBirth?: string | null
  memberId?: string | null
  status?: string
  statusReason?: string
  branchId?: string | null
  baptized?: boolean
  baptizedDate?: string | null
  address?: string | null
  emergencyName?: string | null
  emergencyPhone?: string | null
  isMinor?: boolean
  guardianName?: string | null
  notes?: string | null
  privateNotes?: string | null
  photoUrl?: string | null
  departmentIds?: string[]
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'update')
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const existing = await getScopedMember(ctx, id)
  if (!existing) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const data: Record<string, unknown> = {}
  const setStr = (k: string, v?: string | null) => {
    if (v !== undefined) data[k] = v?.trim() ? v.trim() : null
  }
  if (body.firstName !== undefined) {
    if (!body.firstName.trim()) return NextResponse.json({ error: 'firstName cannot be empty' }, { status: 400 })
    data.firstName = body.firstName.trim()
  }
  if (body.lastName !== undefined) {
    if (!body.lastName.trim()) return NextResponse.json({ error: 'lastName cannot be empty' }, { status: 400 })
    data.lastName = body.lastName.trim()
  }
  setStr('middleName', body.middleName)
  setStr('preferredName', body.preferredName)
  setStr('email', body.email)
  setStr('phone', body.phone)
  setStr('address', body.address)
  setStr('emergencyName', body.emergencyName)
  setStr('emergencyPhone', body.emergencyPhone)
  setStr('guardianName', body.guardianName)
  setStr('notes', body.notes)
  setStr('photoUrl', body.photoUrl)
  setStr('memberId', body.memberId)

  if (body.gender !== undefined) {
    data.gender = body.gender && VALID_GENDERS.includes(body.gender as (typeof VALID_GENDERS)[number])
      ? body.gender
      : null
  }
  if (body.dateOfBirth !== undefined) {
    data.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null
  }
  if (body.baptizedDate !== undefined) {
    data.baptizedDate = body.baptizedDate ? new Date(body.baptizedDate) : null
  }
  if (body.baptized !== undefined) data.baptized = !!body.baptized
  if (body.isMinor !== undefined) data.isMinor = !!body.isMinor
  if (body.branchId !== undefined) {
    if (body.branchId) {
      const branch = await db.branch.findFirst({
        where: { id: body.branchId, organizationId: ctx.organizationId },
      })
      if (!branch) return NextResponse.json({ error: 'Invalid branch' }, { status: 400 })
      data.branchId = body.branchId
    } else {
      data.branchId = null
    }
  }

  let statusHistoryCreated: { status: string; reason: string | null } | null = null
  if (body.status !== undefined && body.status !== existing.status) {
    if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
    }
    data.status = body.status
    statusHistoryCreated = {
      status: body.status,
      reason: body.statusReason?.trim() || `Status changed from ${existing.status} to ${body.status}`,
    }
  }

  if (body.privateNotes !== undefined) {
    data.privateNotes = body.privateNotes?.trim() || null
  }

  let departmentOps: Promise<unknown>[] = []
  if (Array.isArray(body.departmentIds)) {
    const newIds = Array.from(new Set(body.departmentIds.filter(Boolean)))
    const valid = await db.department.findMany({
      where: { id: { in: newIds }, organizationId: ctx.organizationId },
      select: { id: true },
    })
    const validIds = new Set(valid.map((d) => d.id))
    if (validIds.size !== newIds.length) {
      return NextResponse.json({ error: 'One or more invalid departmentIds' }, { status: 400 })
    }
    // Preserve existing membership roles (leader/assistant/secretary) when
    // re-syncing department assignments. Previously this code deleted ALL
    // memberships and re-created each with role:'member', silently downgrading
    // department leaders when their profile was edited for unrelated fields.
    const existingMemberships = await db.departmentMembership.findMany({
      where: { memberId: id },
      select: { departmentId: true, role: true },
    })
    const existingRoleByDept = new Map(existingMemberships.map((m) => [m.departmentId, m.role]))
    const newIdsSet = new Set(newIds)
    const toRemove = existingMemberships.filter((m) => !newIdsSet.has(m.departmentId))
    const toAdd = newIds.filter((deptId) => !existingRoleByDept.has(deptId))
    departmentOps = [
      ...toRemove.map((m) =>
        db.departmentMembership
          .deleteMany({ where: { memberId: id, departmentId: m.departmentId } })
          .catch(() => null),
      ),
      ...toAdd.map((deptId) =>
        db.departmentMembership
          .create({ data: { memberId: id, departmentId: deptId, role: 'member' } })
          .catch(() => null),
      ),
    ]
  }

  const updated = await db.$transaction(async (tx) => {
    const m = await tx.member.update({ where: { id }, data })
    if (statusHistoryCreated) {
      await tx.memberStatusHistory.create({
        data: {
          memberId: id,
          status: statusHistoryCreated.status,
          reason: statusHistoryCreated.reason,
        },
      })
    }
    return m
  })

  if (departmentOps.length) {
    await Promise.all(departmentOps)
  }

  await audit(ctx, 'members.update', 'member', id, {
    fields: Object.keys(data),
    statusChanged: !!statusHistoryCreated,
  })

  return NextResponse.json({ id: updated.id, ok: true })
})

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('members', 'delete')
  const { id } = await params
  const existing = await getScopedMember(ctx, id)
  if (!existing) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  await db.member.delete({ where: { id } })
  await audit(ctx, 'members.delete', 'member', id, {
    name: `${existing.firstName} ${existing.lastName}`,
    memberId: existing.memberId,
  })
  return NextResponse.json({ ok: true, id })
})
