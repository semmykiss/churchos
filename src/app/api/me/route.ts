import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { apiHandler } from '@/lib/api'
import { type Action, type Module } from '@/lib/permissions'
import { getEffectiveMatrix } from '@/lib/permissions-db'

export const GET = apiHandler(async () => {
  const current = await getCurrentUser()
  if (!current) return NextResponse.json({ user: null })
  const { user, session } = current

  // Load the DB-driven effective matrix so the client shell can reflect
  // custom roles + edited permissions for nav visibility.
  const effective = await getEffectiveMatrix(user.organizationId).catch(() => null)
  const roleInfo = effective?.roles.find((r) => r.name === user.role) ?? null
  const rolePerms = effective?.matrix[user.role] ?? {}
  const visibleModules = Object.keys(rolePerms).filter((m) => rolePerms[m]?.length) as Module[]
  const allowedActions: Record<string, Action[]> = rolePerms

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      departmentName: user.department?.name ?? null,
      memberId: user.memberId ?? null,
      isPartnerAdmin: user.isPartnerAdmin,
      orgStatus: user.organization?.status ?? 'active',
      roleLabel: roleInfo?.label ?? null,
      roleColor: roleInfo?.color ?? null,
      roleIsSystem: roleInfo?.isSystem ?? false,
    },
    // Client-side permission snapshot (for nav visibility + button gating).
    permissions: {
      modules: visibleModules,
      allowed: allowedActions,
      roleActive: roleInfo?.active ?? true,
    },
    session,
    organization: {
      id: user.organization.id,
      name: user.organization.name,
      slug: user.organization.slug,
      logoUrl: user.organization.logoUrl,
      address: user.organization.address,
      phone: user.organization.phone,
      email: user.organization.email,
      currency: user.organization.currency,
      timezone: user.organization.timezone,
    },
  })
})
