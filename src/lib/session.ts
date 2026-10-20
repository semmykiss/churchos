// ChurchOS — stateless JWT session using HMAC-SHA256 (Node crypto, no external deps).
import { createHmac, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { db } from './db'

const SESSION_SECRET = process.env.SESSION_SECRET || 'churchos-dev-secret-change-me-in-production-32bytes!'
const COOKIE_NAME = 'churchos_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[security] SESSION_SECRET is not set. Using insecure default — set it before production deployment.')
}

interface SessionPayload {
  sub: string // user id
  email: string
  role: string
  organizationId: string
  departmentId?: string | null
  iat: number
  exp: number
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function sign(payload: SessionPayload): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verify(token: string): SessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const data = `${header}.${body}`
  const expected = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url')
  // timing-safe compare
  if (sig.length !== expected.length) return null
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (!timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i]
  return result === 0
}

export async function createSessionCookie(payload: Omit<SessionPayload, 'iat' | 'exp'>) {
  const now = Math.floor(Date.now() / 1000)
  const token = sign({ ...payload, iat: now, exp: now + SESSION_TTL_SECONDS })
  const store = await cookies()
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  return verify(token)
}

// Live user record from DB (with active check + last login refresh)
export async function getCurrentUser() {
  const session = await getSession()
  if (!session) return null
  const user = await db.user.findUnique({
    where: { id: session.sub },
    include: { organization: true, department: true },
  })
  if (!user || !user.active) return null
  return { user, session }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
