// ChurchOS — AI Events WebSocket mini-service.
//
// Broadcasts real-time module change events (member.create, finance.tithe.update,
// event.register, townhall.message, task.assign, etc.) to all connected clients.
//
// The Next.js API routes call POST http://localhost:3004/broadcast with the event
// payload; this service fans it out to every connected socket.io client.
//
// The AI assistant UI (ai-assistant.tsx) connects to this service in one of two
// ways (it probes the gateway relay first — see the connect() helper there):
//   1. Behind the Caddy gateway (:81 platform entry): io('/?XTransformPort=3004')
//   2. Next-served pages without the gateway (dev origin :3000): direct
//      io(`${location.protocol}//${location.hostname}:3004`)
// either way with { transports: ['websocket'] }, and displays a live "activity
// ticker" above the chat input.
//
// SOCKET PATH CONTRACT: the socket.io server uses its DEFAULT path
// ('/socket.io'). socket.io-client also defaults to '/socket.io', so both
// sides align. Do NOT change it to '/' — engine.io with path '/' intercepts
// EVERY http request and the REST routes below (/broadcast, /recent, /health)
// start returning {"code":0,"message":"Transport unknown"}. The Caddy dev
// proxy (Caddyfile) forwards the full request path, so '/socket.io' requests
// carrying ?XTransformPort=3004 land here untouched.
//
// The AI chat route (src/app/api/ai/chat/route.ts) also subscribes to recent
// events by calling GET http://localhost:3004/recent?limit=20 — this returns the
// last N events from the in-memory ring buffer, so the AI's system prompt can
// include "what just happened" context.
//
// Port: 3004 (fixed, not env-based — per project rules for mini-services).

import { createServer } from 'http'
import { Server } from 'socket.io'

const PORT = 3004
const RING_BUFFER_SIZE = 100

interface ChurchEvent {
  id: string
  organizationId: string
  module: string // 'members' | 'finance' | 'events' | 'townhall' | 'tasks' | 'pastoral' | 'announcements' | etc.
  action: string // 'create' | 'update' | 'delete' | 'confirm' | 'assign' | 'register' | 'send' | etc.
  title: string // human-readable, e.g. "New member registered"
  message: string // human-readable detail, e.g. "Blessing Eze was added to the member directory"
  refId?: string | null // the record ID (memberId, titheId, eventId, roomId, taskId, etc.)
  refType?: string | null // the record type ('member', 'tithe', 'event', 'chatRoom', etc.)
  actorName?: string | null // who triggered the event
  actorId?: string | null
  metadata?: Record<string, unknown> | null // optional extra context (NEVER includes financial amounts for non-finance-staff)
  isFinance?: boolean // if true, the event is finance-related and clients should hide amounts for non-finance users
  at: string // ISO timestamp
}

const httpServer = createServer((req, res) => {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // POST /broadcast — called by Next.js API routes to fan out an event.
  if (req.method === 'POST' && req.url === '/broadcast') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const event = JSON.parse(body) as ChurchEvent
        if (!event.module || !event.action) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'module + action required' }))
          return
        }
        // Stamp the event
        if (!event.id) event.id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        if (!event.at) event.at = new Date().toISOString()

        // Push to ring buffer
        ringBuffer.push(event)
        if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift()

        // Fan out to all connected clients. Each client filters by their orgId
        // and role on the frontend (so they only see events for their org + that
        // they're allowed to see).
        io.emit('church:event', event)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, id: event.id }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
    return
  }

  // GET /recent?limit=20&orgId=xxx — returns the last N events from the ring buffer.
  // Used by the AI chat route to inject "what just happened" into the system prompt.
  if (req.method === 'GET' && req.url?.startsWith('/recent')) {
    const url = new URL(req.url, 'http://localhost')
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20))
    const orgId = url.searchParams.get('orgId') ?? ''
    let events = ringBuffer
    if (orgId) events = events.filter((e) => e.organizationId === orgId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ events: events.slice(-limit).reverse() }))
    return
  }

  // GET /health — simple health check.
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount, buffered: ringBuffer.length }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

const io = new Server(httpServer, {
  // Keep socket.io's default path. '/' would let engine.io swallow the REST
  // routes handled by the httpServer above (Transport unknown errors).
  path: '/socket.io',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// In-memory ring buffer of recent events (last 100).
const ringBuffer: ChurchEvent[] = []

io.on('connection', (socket) => {
  console.log(`[ai-events] client connected: ${socket.id} (total: ${io.engine.clientsCount})`)

  // Send the last 20 events to the new client immediately so they see recent activity.
  socket.emit('church:recent', { events: ringBuffer.slice(-20).reverse() })

  socket.on('disconnect', (reason) => {
    console.log(`[ai-events] client disconnected: ${socket.id} (${reason})`)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[ai-events] WebSocket service listening on port ${PORT}`)
  console.log(`[ai-events] Broadcast endpoint: POST http://localhost:${PORT}/broadcast`)
  console.log(`[ai-events] Recent events:      GET  http://localhost:${PORT}/recent?limit=20`)
  console.log(`[ai-events] Health check:       GET  http://localhost:${PORT}/health`)
})
