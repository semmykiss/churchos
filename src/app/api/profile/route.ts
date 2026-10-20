// ChurchOS — Profile / My Account API
// GET   /api/profile                       — current user's profile (any auth user)
// PATCH /api/profile {name?, phone?, avatarUrl?}  — update self
// POST  /api/profile {action:'changePassword', oldPassword, newPassword}  — change password (audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, audit, apiHandler } from '@/lib/api'
import { hashPassword, verifyPassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const ctx = await requireUser()
  const user = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: {
      id: true, name: true, email: true, role: true, phone: true,
      avatarUrl: true, active: true, departmentId: true, lastLoginAt: true,
      createdAt: true,
      department: { select: { id: true, name: true } },
      organization: {
        select: { id: true, name: true, slug: true, currency: true, timezone: true },
      },
    },
  })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  return NextResponse.json({
    user,
    canChangePassword: true,
  })
})

interface PatchBody {
  name?: string
  phone?: string | null
  avatarUrl?: string | null
  action?: 'changePassword'
  oldPassword?: string
  newPassword?: string
}

export const PATCH = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const body = (await req.json().catch(() => ({}))) as PatchBody

  // Profile field updates only (no email/role — those go through settings)
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }
    data.name = body.name.trim()
  }
  if (body.phone !== undefined) {
    data.phone = typeof body.phone === 'string' ? body.phone.trim() || null : null
  }
  if (body.avatarUrl !== undefined) {
    data.avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() || null : null
  }

  const updated = await db.user.update({ where: { id: ctx.user.id }, data })
  await audit(ctx, 'profile.update', 'user', ctx.user.id, { fields: Object.keys(data) })
  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    phone: updated.phone,
    avatarUrl: updated.avatarUrl,
    ok: true,
  })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const body = (await req.json().catch(() => ({}))) as PatchBody

  if (body.action !== 'changePassword') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (
    typeof body.oldPassword !== 'string' ||
    typeof body.newPassword !== 'string' ||
    body.newPassword.length < 6
  ) {
    return NextResponse.json(
      { error: 'New password must be at least 6 characters.' },
      { status: 400 },
    )
  }

  const user = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { passwordHash: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (!verifyPassword(body.oldPassword, user.passwordHash)) {
    await audit(ctx, 'auth.password.fail', 'user', ctx.user.id, {})
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
  }

  const newHash = hashPassword(body.newPassword)
  await db.user.update({
    where: { id: ctx.user.id },
    data: { passwordHash: newHash },
  })

  await audit(ctx, 'auth.password.change', 'user', ctx.user.id, {})
  return NextResponse.json({ ok: true })
})
