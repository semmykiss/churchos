import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { createSessionCookie, clearSessionCookie } from '@/lib/session'
import { apiHandler, audit } from '@/lib/api'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

// Simple in-memory rate limiter for auth attempts
const attempts = new Map<string, { count: number; first: number }>()
const WINDOW = 60_000
const MAX = 10

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now - entry.first > WINDOW) {
    attempts.set(ip, { count: 1, first: now })
    return true
  }
  entry.count += 1
  return entry.count <= MAX
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a minute.' }, { status: 429 })
  }
  const body = await req.json()
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 400 })
  }
  const { email, password } = parsed.data
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { organization: true },
  })
  if (!user || !user.passwordHash || !user.active) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  await createSessionCookie({
    sub: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    departmentId: user.departmentId,
  })
  await audit(
    { user, organizationId: user.organizationId, role: user.role, departmentId: user.departmentId },
    'auth.login', 'user', user.id,
  )
  return NextResponse.json({
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      organizationId: user.organizationId, departmentId: user.departmentId,
    },
    organization: { name: user.organization.name, currency: user.organization.currency, timezone: user.organization.timezone },
  })
})

export const DELETE = apiHandler(async () => {
  await clearSessionCookie()
  return NextResponse.json({ ok: true })
})
