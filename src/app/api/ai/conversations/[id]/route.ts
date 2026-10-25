// GET    /api/ai/conversations/[id] — conversation detail + recent messages
// PATCH  /api/ai/conversations/[id] — rename conversation
// DELETE /api/ai/conversations/[id] — delete conversation + all messages

import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission, apiHandler, audit } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function loadOwned(ctx: Awaited<ReturnType<typeof requirePermission>>, id: string) {
  const convo = await db.aiConversation.findFirst({
    where: { id, userId: ctx.user.id, organizationId: ctx.organizationId },
  })
  if (!convo) throw new ForbiddenError('Conversation not found.')
  return convo
}

export const GET = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('ai', 'view')
  const { id } = await params
  // Serverless isolation: the conversation may live in another lambda's
  // ephemeral DB copy. Rather than 404-ing (which makes the client drop its
  // thread), return a synthetic empty conversation — the chat endpoint
  // find-or-creates the real row on the next message.
  const convo = await db.aiConversation.findFirst({
    where: { id, userId: ctx.user.id, organizationId: ctx.organizationId },
  })
  if (!convo) {
    return NextResponse.json({
      id,
      title: 'New conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    })
  }
  const messages = await db.aiMessage.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: {
      id: true,
      role: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  })
  return NextResponse.json({
    id: convo.id,
    title: convo.title,
    createdAt: convo.createdAt.toISOString(),
    updatedAt: convo.updatedAt.toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      createdAt: m.createdAt.toISOString(),
    })),
  })
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('ai', 'create')
  const { id } = await params
  const convo = await loadOwned(ctx, id)
  const body = await req.json().catch(() => ({}))
  const title = (body?.title as string)?.trim()?.slice(0, 100)
  if (!title) throw new Error('Title is required.')
  const updated = await db.aiConversation.update({
    where: { id: convo.id },
    data: { title },
  })
  await audit(ctx, 'ai.conversation.rename', 'ai_conversation', convo.id, { title })
  return NextResponse.json({ id: updated.id, title: updated.title })
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('ai', 'create')
  const { id } = await params
  const convo = await loadOwned(ctx, id)
  await db.aiConversation.delete({ where: { id: convo.id } })
  await audit(ctx, 'ai.conversation.delete', 'ai_conversation', convo.id, {})
  return NextResponse.json({ ok: true })
})
