// ChurchOS — Partner Portal auth + tenant lifecycle helpers.
import { db } from './db'
import { getCurrentUser } from './session'
import { ForbiddenError } from './permissions'

export interface PartnerContext {
  user: {
    id: string
    name: string
    email: string
    avatarUrl?: string | null
  }
  organizationId: string | null
}

/** Require a partner administrator. Throws ForbiddenError if not. */
export async function requirePartnerAdmin(): Promise<PartnerContext> {
  const current = await getCurrentUser()
  if (!current) throw new ForbiddenError('Authentication required.')
  if (!current.user.isPartnerAdmin) {
    throw new ForbiddenError('Partner administrator access required.')
  }
  return {
    user: {
      id: current.user.id,
      name: current.user.name,
      email: current.user.email,
      avatarUrl: current.user.avatarUrl,
    },
    organizationId: current.user.organizationId,
  }
}

/** Check if a tenant is accessible. */
export function isTenantAccessible(status: string | null | undefined): boolean {
  if (!status) return true
  return status === 'active' || status === 'trial'
}

/** Get a tenant's license/plan info + current usage. */
export async function getTenantUsage(organizationId: string) {
  const [org, users, members, branches, admins] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, include: { plan: true } }),
    db.user.count({ where: { organizationId } }),
    db.member.count({ where: { organizationId } }),
    db.branch.count({ where: { organizationId } }),
    db.user.count({ where: { organizationId, role: { in: ['church_admin', 'super_admin'] } } }),
  ])
  const plan = org?.plan
  return {
    plan,
    usage: { users, members, branches, admins },
    limits: plan ? {
      maxUsers: plan.maxUsers, maxMembers: plan.maxMembers,
      maxBranches: plan.maxBranches, maxAdmins: plan.maxAdmins,
    } : null,
    utilization: plan ? {
      users: plan.maxUsers ? Math.round((users / plan.maxUsers) * 100) : 0,
      members: plan.maxMembers ? Math.round((members / plan.maxMembers) * 100) : 0,
      branches: plan.maxBranches ? Math.round((branches / plan.maxBranches) * 100) : 0,
      admins: plan.maxAdmins ? Math.round((admins / plan.maxAdmins) * 100) : 0,
    } : null,
  }
}

/** Check license quota for a resource. Returns error message if exceeded. */
export async function checkLicenseQuota(
  organizationId: string,
  resource: 'users' | 'members' | 'branches' | 'admins',
): Promise<string | null> {
  const { plan, usage, limits } = await getTenantUsage(organizationId)
  if (!plan || !limits) return null
  const max = limits[`max${resource.charAt(0).toUpperCase() + resource.slice(1)}` as keyof typeof limits]
  const current = usage[resource]
  if (typeof max === 'number' && max > 0 && current >= max) {
    return `License limit reached: ${resource} (${current}/${max}). Please upgrade your plan to add more.`
  }
  return null
}

/** Partner audit log helper. */
export async function partnerAudit(
  ctx: PartnerContext,
  action: string,
  options: {
    organizationId?: string
    targetType?: string
    targetId?: string
    outcome?: string
    reason?: string
    metadata?: Record<string, unknown>
    ip?: string
  } = {},
) {
  try {
    await db.partnerAudit.create({
      data: {
        organizationId: options.organizationId ?? ctx.organizationId ?? null,
        actorId: ctx.user.id,
        action,
        targetType: options.targetType,
        targetId: options.targetId,
        outcome: options.outcome ?? 'success',
        reason: options.reason,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
        ip: options.ip,
      },
    })
  } catch (e) {
    console.error('[partner-audit] failed to write log', e)
  }
}
