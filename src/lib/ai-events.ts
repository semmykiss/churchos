// ChurchOS — AI Events broadcaster (server-side helper).
//
// API routes call `broadcastEvent(ctx, { module, action, title, message, ... })`
// right after they create/update/delete a record. This POSTs to the ai-events
// mini-service (port 3004), which fans the event out to all connected socket.io
// clients (the AI assistant UI + any future real-time subscribers).
//
// CRITICAL: This helper NEVER includes financial amounts in the event payload
// for non-finance-staff events. The caller can pass `isFinance: true` to flag
// an event as finance-related; the AI assistant UI then hides the amount for
// non-finance-staff users (showing only "a tithe was confirmed" instead of
// "a ₦50,000 tithe was confirmed").
//
// The broadcaster is fire-and-forget — if the ai-events service is down, the
// API route still succeeds (the event just isn't broadcast). This keeps the
// core write path resilient.

import type { AuthContext } from '@/lib/api'

export interface ChurchEvent {
  module: string
  action: string
  title: string
  message: string
  refId?: string | null
  refType?: string | null
  actorName?: string | null
  actorId?: string | null
  metadata?: Record<string, unknown> | null
  isFinance?: boolean
}

const AI_EVENTS_URL = 'http://localhost:3004/broadcast'

/**
 * Broadcast a module change event to all connected AI assistant clients.
 *
 * Fire-and-forget: if the ai-events service is unreachable, the error is
 * swallowed (logged to stderr) so the calling API route isn't affected.
 */
export async function broadcastEvent(ctx: AuthContext, event: ChurchEvent): Promise<void> {
  const payload = {
    organizationId: ctx.organizationId,
    module: event.module,
    action: event.action,
    title: event.title,
    message: event.message,
    refId: event.refId ?? null,
    refType: event.refType ?? null,
    actorName: ctx.user.name,
    actorId: ctx.user.id,
    metadata: event.metadata ?? null,
    isFinance: event.isFinance ?? false,
  }

  try {
    await fetch(AI_EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000), // 2s timeout — don't block the API route
    })
  } catch (e) {
    // Swallow — the ai-events service might be down. Don't break the write.
    console.error('[ai-events] broadcast failed (service may be down):', (e as Error).message)
  }
}

/**
 * Fetch recent events from the ai-events service. Used by the AI chat route
 * to inject "what just happened" into the system prompt.
 */
export async function fetchRecentEvents(
  organizationId: string,
  limit = 20,
): Promise<Array<{
  id: string
  module: string
  action: string
  title: string
  message: string
  refId?: string | null
  refType?: string | null
  actorName?: string | null
  isFinance?: boolean
  at: string
}>> {
  try {
    const res = await fetch(
      `http://localhost:3004/recent?limit=${limit}&orgId=${encodeURIComponent(organizationId)}`,
      { signal: AbortSignal.timeout(2000) },
    )
    if (!res.ok) return []
    const data = await res.json() as { events: unknown[] }
    return data.events as Array<{
      id: string
      module: string
      action: string
      title: string
      message: string
      refId?: string | null
      refType?: string | null
      actorName?: string | null
      isFinance?: boolean
      at: string
    }>
  } catch {
    return []
  }
}
