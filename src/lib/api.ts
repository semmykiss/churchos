// ChurchOS — shared API helpers: auth, permission checks, audit logging, JSON responses.
import { NextResponse } from 'next/server'
import { getCurrentUser } from './session'
import { ForbiddenError, type Action, type Module } from './permissions'
import { canAsync } from './permissions-db'
import { db } from './db'

export type AuthUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>['user']
export type AuthContext = {
  // `department` is optional: some callers build an AuthContext from a user row
  // fetched WITHOUT the department include (e.g. POST /api/auth). All other
  // fields stay required so `ctx.user.name`/`memberId`/... remain type-safe.
  user: Omit<AuthUser, 'department'> & { department?: AuthUser['department'] }
  organizationId: string
  role: string
  departmentId?: string | null
  /** Linked Member record id (for member self-service scoping). Null for staff-only accounts. */
  memberId?: string | null
}

export async function requireUser(): Promise<AuthContext> {
  const current = await getCurrentUser()
  if (!current) throw new ForbiddenError('Authentication required.')
  return {
    user: current.user,
    organizationId: current.user.organizationId,
    role: current.user.role,
    departmentId: current.user.departmentId,
    memberId: current.user.memberId,
  }
}

export async function requirePermission(mod: Module, action: Action): Promise<AuthContext> {
  const ctx = await requireUser()
  // Partner admins bypass module permission checks (platform-wide).
  if ((ctx.user as any).isPartnerAdmin) return ctx
  // Tenant suspension enforcement: suspended/expired/terminated tenants cannot
  // access protected modules (only their own profile/settings for read).
  const orgStatus = (ctx.user as any).organization?.status
  if (orgStatus && orgStatus !== 'active' && orgStatus !== 'trial') {
    if (mod !== 'settings') {
      throw new ForbiddenError(
        orgStatus === 'suspended'
          ? 'This church account has been suspended. Please contact the platform provider.'
          : `This church account is ${orgStatus}. Please contact the platform provider.`,
      )
    }
  }
  // Server-side enforcement uses the DB-driven effective matrix (editable via Access Control).
  const allowed = await canAsync(ctx.organizationId, ctx.role, mod, action).catch(() => false)
  if (!allowed) {
    throw new ForbiddenError(`Role "${ctx.role}" cannot ${action} on module "${mod}".`)
  }
  return ctx
}

export async function audit(
  ctx: AuthContext,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await db.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        action,
        targetType,
        targetId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })
  } catch (e) {
    console.error('[audit] failed to write log', e)
  }
}

// Wrap an API handler with structured error handling.
// Return-type constraint is `Promise<Response>` (not NextResponse): streaming
// routes legitimately return a bare `new Response(stream)` for SSE. NextResponse
// extends Response, so every NextResponse-returning route still satisfies it.
export function apiHandler<T extends (...args: any[]) => Promise<Response>>(
  handler: T,
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args)
    } catch (err: any) {
      if (err instanceof ForbiddenError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status },
        )
      }
      console.error('[api] error', err)
      const message = err?.message || 'Internal server error'
      const status = err?.status || 500
      return NextResponse.json({ error: message }, { status })
    }
  }) as T
}

// Zod-like simple validation: pick fields from body
export function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const k of keys) if (k in obj) out[k] = obj[k]
  return out
}
