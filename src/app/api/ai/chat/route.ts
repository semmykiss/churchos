// POST /api/ai/chat — send a message to the assistant and get a streaming reply.
//
// Body: { conversationId: string, message: string }
// Returns: text/event-stream of `data: { "delta": "..." }` chunks, terminated by
//          `data: { "done": true, "messageId": "...", "conversationId": "..." }`.
//
// CRITICAL: This route enforces permission-aware retrieval at the data layer BEFORE
// the LLM is invoked. The LLM never sees raw rows the user isn't allowed to see —
// only what buildContext() hands it.

import { type NextRequest } from 'next/server'
import { requirePermission, apiHandler, audit } from '@/lib/api'
import { ForbiddenError } from '@/lib/permissions'
import { db } from '@/lib/db'
import { buildContext } from '@/lib/ai/context'
import { buildSystemPrompt } from '@/lib/ai/prompt'
import { streamChat } from '@/lib/ai/llm'
import type { ChatCompletionMessage } from '@/lib/ai/types'

export const dynamic = 'force-dynamic'
// Streaming responses need a longer timeout (default is too short for AI completion).
export const maxDuration = 60

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('ai', 'create')
  const body = await req.json().catch(() => ({}))
  const conversationId = String(body?.conversationId ?? '')
  const userMessage = String(body?.message ?? '').trim()
  if (!conversationId) throw new Error('conversationId is required.')
  if (!userMessage) throw new Error('message is required.')
  if (userMessage.length > 4000) throw new Error('Message is too long (max 4000 chars).')

  // Verify the conversation belongs to this user.
  const convo = await db.aiConversation.findFirst({
    where: { id: conversationId, userId: ctx.user.id, organizationId: ctx.organizationId },
  })
  if (!convo) throw new ForbiddenError('Conversation not found.')

  // 1) Run permission-aware retrieval — this is the security boundary.
  const context = await buildContext(ctx, userMessage)
  const systemPrompt = buildSystemPrompt(ctx, context)

  // 2) Persist the user message (before invoking LLM, so it's never lost).
  await db.aiMessage.create({
    data: {
      conversationId: convo.id,
      role: 'user',
      content: userMessage,
      metadata: JSON.stringify({ intents: context.intents, consulted: context.consulted }),
    },
  })

  // Auto-title the conversation from the first user message.
  if (convo.title === 'New conversation') {
    const newTitle = userMessage.slice(0, 80) + (userMessage.length > 80 ? '…' : '')
    await db.aiConversation.update({ where: { id: convo.id }, data: { title: newTitle } }).catch(() => {})
  }

  // 3) Load conversation history (last 20 messages) for context continuity.
  const historyRows = await db.aiMessage.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: 'asc' },
    take: 40,
    select: { role: true, content: true },
  })
  // Map db roles (user/assistant) → chat roles. Drop the just-saved user message
  // at the end because we'll add it as the latest user message separately.
  const history: ChatCompletionMessage[] = historyRows.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  // 4) Stream the response back via Server-Sent Events.
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Track whether the client is still connected. If they disconnect
      // mid-stream, we still want to persist the assistant's response to DB
      // so the conversation history shows the answer.
      let clientGone = false
      const send = (obj: unknown) => {
        if (clientGone) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          // Client disconnected — stop trying to send.
          clientGone = true
        }
      }

      let producedContent = false
      try {
        send({ type: 'start', conversationId: convo.id })

        const fullText = await streamChat(
          {
            systemPrompt,
            messages: history,
            maxMessages: 20,
          },
          ({ delta }) => {
            producedContent = true
            send({ type: 'delta', delta })
          },
        )
        producedContent = !!fullText

        // 5) Persist the assistant message with retrieval metadata — even if the
        // client disconnected mid-stream, the user should still see this answer
        // when they reopen the conversation.
        let savedId: string | undefined
        try {
          const saved = await db.aiMessage.create({
            data: {
              conversationId: convo.id,
              role: 'assistant',
              content: fullText,
              metadata: JSON.stringify({
                intents: context.intents,
                consulted: context.consulted,
                sources: context.sources,
              }),
            },
          })
          savedId = saved.id
          await db.aiConversation.update({
            where: { id: convo.id },
            data: { updatedAt: new Date() },
          })
          await audit(ctx, 'ai.chat', 'ai_message', saved.id, {
            conversationId: convo.id,
            consulted: context.consulted,
          })
        } catch (persistErr) {
          // Persistence failed (DB issue) — log and surface to client.
          console.error('[ai.chat] persist failed:', persistErr)
          send({ type: 'error', message: 'Failed to save the assistant response.' })
        }

        send({ type: 'done', messageId: savedId, conversationId: convo.id })
      } catch (err: any) {
        const message = err?.message || 'AI completion failed.'
        // Only persist an error assistant message if we never produced any content
        // for the user. If the stream was interrupted but some content was already
        // sent, write what we have so far (or a graceful note) — NOT a confusing
        // error follow-up message.
        if (!producedContent) {
          try {
            await db.aiMessage.create({
              data: {
                conversationId: convo.id,
                role: 'assistant',
                content: `⚠️ I couldn't complete that request just now. ${message}`,
                metadata: JSON.stringify({ error: message }),
              },
            })
          } catch {}
          send({ type: 'error', message })
        } else {
          // We had partial content — send a clean "done" so the UI doesn't hang.
          send({ type: 'done', conversationId: convo.id })
        }
      } finally {
        try {
          controller.close()
        } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable proxy buffering
    },
  })
})
