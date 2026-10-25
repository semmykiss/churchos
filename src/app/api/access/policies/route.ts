// ChurchOS — Access Control · Approval policies (Task ID 26)
// GET  /api/access/policies — list approval policies (SoD).
// POST /api/access/policies — create approval policy.
//      Body: { name, action, description?, requiresApproval?, approverRoleId?,
//              selfApprovalBlocked?, minApprovers? }
//
// Permission: can('access','manage')
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { refreshMatrixCache } from '@/lib/permissions-db'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('access', 'view')
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'

  const where: Record<string, unknown> = { organizationId: ctx.organizationId }
  if (activeOnly) where.active = true

  const [policies, approverRoles] = await Promise.all([
    db.approvalPolicy.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    }),
    db.role.findMany({
      where: { organizationId: ctx.organizationId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, label: true, color: true, isSystem: true },
    }),
  ])

  // Hydrate approverRoleId → role info manually (ApprovalPolicy has no relation to Role)
  const approverRoleIdSet = new Set(policies.map((p) => p.approverRoleId).filter(Boolean) as string[])
  const approverRoleMap = approverRoleIdSet.size
    ? new Map((await db.role.findMany({
        where: { id: { in: [...approverRoleIdSet] } },
        select: { id: true, name: true, label: true, color: true },
      })).map((r) => [r.id, r]))
    : new Map()

  return NextResponse.json({
    policies: policies.map((p) => ({
      id: p.id,
      name: p.name,
      action: p.action,
      description: p.description,
      requiresApproval: p.requiresApproval,
      approverRoleId: p.approverRoleId,
      approverRole: p.approverRoleId ? approverRoleMap.get(p.approverRoleId) ?? null : null,
      selfApprovalBlocked: p.selfApprovalBlocked,
      minApprovers: p.minApprovers,
      active: p.active,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    approverRoles,
    total: policies.length,
  })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('access', 'manage')
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const name = String(body.name ?? '').trim()
  const action = String(body.action ?? '').trim()
  if (!name || !action) {
    return NextResponse.json({ error: 'name and action are required' }, { status: 400 })
  }
  const description = body.description ? String(body.description).trim() : null
  const requiresApproval = typeof body.requiresApproval === 'boolean' ? body.requiresApproval : true
  const approverRoleId = body.approverRoleId ? String(body.approverRoleId).trim() : null
  const selfApprovalBlocked = typeof body.selfApprovalBlocked === 'boolean' ? body.selfApprovalBlocked : true
  const minApprovers = Math.max(1, Math.min(10, parseInt(String(body.minApprovers ?? '1'), 10) || 1))

  // Validate approverRole is in the same org (if provided)
  if (approverRoleId) {
    const approver = await db.role.findFirst({
      where: { id: approverRoleId, organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!approver) {
      return NextResponse.json({ error: 'Approver role not found in this organization.' }, { status: 400 })
    }
  }

  const policy = await db.approvalPolicy.create({
    data: {
      organizationId: ctx.organizationId,
      name,
      action,
      description,
      requiresApproval,
      approverRoleId,
      selfApprovalBlocked,
      minApprovers,
      active: true,
    },
  })

  await audit(ctx, 'access.policy.create', 'approval_policy', policy.id, {
    name, action, requiresApproval, approverRoleId, minApprovers,
  })
  refreshMatrixCache(ctx.organizationId)

  return NextResponse.json({ policy }, { status: 201 })
})
