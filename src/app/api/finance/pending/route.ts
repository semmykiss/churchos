// ChurchOS — Pending giving submissions (tithes + donations awaiting approval)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const ctx = await requirePermission('finance', 'view')
  if (ctx.role === 'member') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  const [pendingDonations, pendingTithes] = await Promise.all([
    db.donation.findMany({
      where: { organizationId: ctx.organizationId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } }, fund: { select: { id: true, name: true } } },
    }),
    db.tithe.findMany({
      where: { organizationId: ctx.organizationId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { member: { select: { id: true, firstName: true, lastName: true, memberId: true } } },
    }),
  ])
  const donations = pendingDonations.map((d) => ({ id: d.id, kind: 'donation' as const, amount: d.amount, method: d.method, reference: d.reference, date: d.donatedAt.toISOString(), memberId: d.memberId, donorName: d.donorName, member: d.member ? { id: d.member.id, name: `${d.member.firstName} ${d.member.lastName}`, memberId: d.member.memberId } : null, fund: d.fund }))
  const tithes = pendingTithes.map((t) => ({ id: t.id, kind: 'tithe' as const, amount: t.amount, method: t.method, reference: t.reference, titheMonth: t.titheMonth.toISOString(), memberId: t.memberId, member: t.member ? { id: t.member.id, name: `${t.member.firstName} ${t.member.lastName}`, memberId: t.member.memberId } : null }))
  return NextResponse.json({ donations, tithes, counts: { donations: donations.length, tithes: tithes.length, total: donations.length + tithes.length } })
})
