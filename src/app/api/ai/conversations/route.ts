// GET /api/ai/conversations — list current user's conversations
// POST /api/ai/conversations — create a new conversation (or reuse the latest "New conversation" empty one)

import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission, apiHandler, audit } from '@/lib/api'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('ai', 'view')
  const rows = await db.aiConversation.findMany({
    where: { userId: ctx.user.id, organizationId: ctx.organizationId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: { _count: { select: { messages: true } } },
  })
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      messageCount: r._count.messages,
    })),
  })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('ai', 'create')
  const body = await req.json().catch(() => ({}))
  const title = (body?.title as string)?.trim()?.slice(0, 100) || 'New conversation'

  // If the user's most recent conversation has zero messages AND the title matches,
  // reuse it rather than creating yet another empty thread.
  const lastEmpty = await db.aiConversation.findFirst({
    where: { userId: ctx.user.id, organizationId: ctx.organizationId, title, messages: { none: {} } },
    orderBy: { createdAt: 'desc' },
  })
  if (lastEmpty) {
    return NextResponse.json({
      id: lastEmpty.id,
      title: lastEmpty.title,
      createdAt: lastEmpty.createdAt.toISOString(),
      updatedAt: lastEmpty.updatedAt.toISOString(),
      messageCount: 0,
    })
  }

  const convo = await db.aiConversation.create({
    data: {
      userId: ctx.user.id,
      organizationId: ctx.organizationId,
      title,
    },
  })
  await audit(ctx, 'ai.conversation.create', 'ai_conversation', convo.id, { title })
  return NextResponse.json(
    {
      id: convo.id,
      title: convo.title,
      createdAt: convo.createdAt.toISOString(),
      updatedAt: convo.updatedAt.toISOString(),
      messageCount: 0,
    },
    { status: 201 },
  )
})
