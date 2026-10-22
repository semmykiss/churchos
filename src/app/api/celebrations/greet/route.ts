// ChurchOS — Celebrations greet API
// POST /api/celebrations/greet {memberId, type, message?}
//   Creates an in-app Notification for the celebrant's linked user account.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

interface Body {
  memberId?: string
  type?: string
  message?: string
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const body = (await req.json().catch(() => ({}))) as Body
  const memberId = body.memberId?.toString().trim()
  const type = (body.type ?? 'birthday').toString().toLowerCase()
  if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
  if (!['birthday', 'anniversary'].includes(type)) {
    return NextResponse.json({ error: 'type must be birthday or anniversary' }, { status: 400 })
  }

  const member = await db.member.findFirst({
    where: { id: memberId, organizationId: ctx.organizationId },
    include: { account: { select: { id: true, name: true } } },
  })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!member.account?.id) {
    return NextResponse.json(
      { error: 'This celebrant does not have a linked user account yet. Try sending them a personal message instead.' },
      { status: 400 },
    )
  }

  const senderName = ctx.user.name
  const defaultMsg = type === 'birthday'
    ? `Happy Birthday, ${member.firstName}! 🎉 Wishing you a beautiful year ahead.`
    : `Happy Anniversary, ${member.firstName}! 💍 May your love continue to grow.`
  const message = (body.message ?? '').toString().trim() || defaultMsg

  const notif = await db.notification.create({
    data: {
      userId: member.account.id,
      organizationId: ctx.organizationId,
      title: type === 'birthday' ? 'Birthday Greeting 🎂' : 'Anniversary Greeting 💐',
      message: `${senderName} sent you a greeting:\n"${message}"`,
      link: `celebrations:${type}`,
    },
  })

  await audit(ctx, 'celebrations.greet', 'member', member.id, {
    type,
    notificationId: notif.id,
  })
  return NextResponse.json({ ok: true, sent: true, notificationId: notif.id }, { status: 201 })
})
