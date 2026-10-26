// ChurchOS — Visitor detail API
// GET    /api/visitors/[id]  — single visitor with follow-ups summary
// PATCH  /api/visitors/[id]  — update visitor fields, OR { action: 'convert' } → convert to member
// DELETE /api/visitors/[id]  — delete visitor (cascade follow-ups)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

type Ctx = Awaited<ReturnType<typeof requirePermission>>

async function getScopedVisitor(ctx: Ctx, id: string) {
  return db.visitor.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
}

export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('visitors', 'view')
    const { id } = await params

    const v = await db.visitor.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        followUps: {
          orderBy: { updatedAt: 'desc' },
          include: {
            _count: { select: { interactions: true } },
          },
        },
      },
    })
    if (!v) return NextResponse.json({ error: 'Visitor not found' }, { status: 404 })

    const canSeeNotes = can(ctx.role, 'followups', 'update')

    // ownerId has no FK relation on FollowUpTask — fetch owners (if any) separately
    const ownerIds = Array.from(new Set(v.followUps.map((f) => f.ownerId).filter((id): id is string => !!id)))
    const owners = ownerIds.length
      ? await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
      : []
    const ownerById = new Map(owners.map((u) => [u.id, u]))

    return NextResponse.json({
      id: v.id,
      firstName: v.firstName,
      lastName: v.lastName,
      phone: v.phone,
      email: v.email,
      address: v.address,
      referralSource: v.referralSource,
      firstVisitDate: v.firstVisitDate,
      consent: v.consent,
      convertedMemberId: v.convertedMemberId,
      createdAt: v.createdAt,
      followUps: v.followUps.map((f) => ({
        id: f.id,
        status: f.status,
        dueDate: f.dueDate,
        outcome: f.outcome,
        notes: canSeeNotes ? f.notes : null,
        ownerId: f.ownerId,
        owner: f.ownerId ? (ownerById.get(f.ownerId) ?? null) : null,
        interactions: f._count.interactions,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
    })
  },
)

interface PatchBody {
  action?: 'convert'
  firstName?: string
  lastName?: string
  phone?: string | null
  email?: string | null
  address?: string | null
  referralSource?: string | null
  consent?: boolean
  firstVisitDate?: string | null
}

export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('visitors', 'update')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody

    const existing = await getScopedVisitor(ctx, id)
    if (!existing) return NextResponse.json({ error: 'Visitor not found' }, { status: 404 })

    // ----- convert to member -----
    if (body.action === 'convert') {
      if (existing.convertedMemberId) {
        return NextResponse.json(
          { error: 'Visitor already converted', memberId: existing.convertedMemberId },
          { status: 409 },
        )
      }
      // Duplicate email check against members table (if visitor has an email)
      if (existing.email) {
        const dupMember = await db.member.findFirst({
          where: { email: existing.email, organizationId: ctx.organizationId },
          select: { id: true, memberId: true },
        })
        if (dupMember) {
          // Link existing member
          await db.visitor.update({
            where: { id },
            data: { convertedMemberId: dupMember.id },
          })
          await audit(ctx, 'visitors.convert', 'visitor', id, {
            memberId: dupMember.id,
            linked: true,
          })
          return NextResponse.json({
            ok: true,
            converted: true,
            memberId: dupMember.id,
            linked: true,
            message: 'Linked to existing member with same email',
          })
        }
      }

      // Generate a memberId (GCI/1000+N pattern)
      const count = await db.member.count({ where: { organizationId: ctx.organizationId } })
      const memberId = `GCI/${String(1000 + count + 1).padStart(4, '0')}`

      const member = await db.member.create({
        data: {
          organizationId: ctx.organizationId,
          memberId,
          firstName: existing.firstName,
          lastName: existing.lastName,
          email: existing.email ?? null,
          phone: existing.phone ?? null,
          address: existing.address ?? null,
          status: 'new_convert',
          dateJoined: existing.firstVisitDate ?? new Date(),
          notes: `Converted from visitor profile (ref: ${existing.referralSource ?? 'unknown'})`,
        },
      })

      await db.memberStatusHistory.create({
        data: {
          memberId: member.id,
          status: 'new_convert',
          reason: 'Converted from visitor profile',
        },
      })

      await db.visitor.update({
        where: { id },
        data: { convertedMemberId: member.id },
      })

      await audit(ctx, 'members.create', 'member', member.id, {
        firstName: member.firstName,
        lastName: member.lastName,
        memberId: member.memberId,
        status: member.status,
        source: 'visitor_conversion',
      })
      await audit(ctx, 'visitors.convert', 'visitor', id, {
        memberId: member.id,
      })

      return NextResponse.json({
        ok: true,
        converted: true,
        memberId: member.id,
        memberIdCode: member.memberId,
      })
    }

    // ----- regular field update -----
    const data: Record<string, unknown> = {}
    if (body.firstName !== undefined) {
      if (!body.firstName.trim()) {
        return NextResponse.json({ error: 'firstName cannot be empty' }, { status: 400 })
      }
      data.firstName = body.firstName.trim()
    }
    if (body.lastName !== undefined) {
      if (!body.lastName.trim()) {
        return NextResponse.json({ error: 'lastName cannot be empty' }, { status: 400 })
      }
      data.lastName = body.lastName.trim()
    }
    if (body.phone !== undefined) data.phone = body.phone?.trim() || null
    if (body.email !== undefined) {
      const newEmail = body.email?.trim() || null
      if (newEmail) {
        const dup = await db.visitor.findFirst({
          where: { email: newEmail, organizationId: ctx.organizationId, NOT: { id } },
          select: { id: true },
        })
        if (dup) {
          return NextResponse.json(
            { error: 'Another visitor with this email already exists.' },
            { status: 409 },
          )
        }
      }
      data.email = newEmail
    }
    if (body.address !== undefined) data.address = body.address?.trim() || null
    if (body.referralSource !== undefined) data.referralSource = body.referralSource?.trim() || null
    if (body.consent !== undefined) data.consent = !!body.consent
    if (body.firstVisitDate !== undefined) {
      data.firstVisitDate = body.firstVisitDate ? new Date(body.firstVisitDate) : new Date()
    }

    const updated = await db.visitor.update({ where: { id }, data })
    await audit(ctx, 'visitors.update', 'visitor', id, { fields: Object.keys(data) })

    return NextResponse.json({ id: updated.id, ok: true })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('visitors', 'delete')
    const { id } = await params
    const existing = await getScopedVisitor(ctx, id)
    if (!existing) return NextResponse.json({ error: 'Visitor not found' }, { status: 404 })

    await db.visitor.delete({ where: { id } })
    await audit(ctx, 'visitors.delete', 'visitor', id, {
      name: `${existing.firstName} ${existing.lastName}`,
    })
    return NextResponse.json({ ok: true, id })
  },
)
