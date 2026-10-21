import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { apiHandler } from '@/lib/api'

export const GET = apiHandler(async () => {
  const current = await getCurrentUser()
  if (!current) return NextResponse.json({ user: null })
  const { user, session } = current
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
