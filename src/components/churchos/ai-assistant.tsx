'use client'

// ChurchOS — Floating AI Assistant (Task UI-AI-ASSISTANT)
//
// A bottom-right floating button (emerald gradient + Sparkles icon) that opens
// a chat panel. On desktop (lg+) the panel is a fixed-position ~440px × 70vh
// card animated with Framer Motion. On mobile it renders as a full-screen
// shadcn `Sheet`.
//
// Streams responses from `POST /api/ai/chat` (Server-Sent Events), accumulates
// `delta` chunks live, persists the active conversation id in `localStorage`,
// and supports conversation switching / renaming / deletion. Hides itself when
// the user can't access the `ai` module.
//
// Theme: emerald/teal accents — NO indigo / blue anywhere.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { KeyboardEvent, UIEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from 'socket.io-client'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sparkles, X, Send, Square, Plus, MessageSquare,
  ChevronLeft, Pencil, Trash2, Check, Activity, Zap,
} from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { useAuth } from '@/lib/auth-store'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ---------- Types ----------
interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  metadata?: unknown
  createdAt: string
}

interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[]
}

type SSEEvent =
  | { type: 'start'; conversationId: string }
  | { type: 'delta'; delta: string }
  | { type: 'done'; messageId: string; conversationId: string }
  | { type: 'error'; message: string }

/** Deployment-level configuration problems get a friendly setup card instead
 *  of a raw error bubble (missing LLM_API_KEY, exhausted balance, bad model). */
function isSetupError(msg: string): boolean {
  return /LLM_API_KEY|not configured|Insufficient balance|no resource package|LLM API error 40[14]/i.test(msg)
}

// Live event from the ai-events WebSocket service (port 3004).
// `isFinance` events have their metadata (amounts) stripped on the server for
// non-finance-staff users — the client just sees the title + message.
interface LiveEvent {
  id: string
  organizationId?: string
  module: string
  action: string
  title: string
  message: string
  refId?: string | null
  refType?: string | null
  actorName?: string | null
  isFinance?: boolean
  at: string
}

// ---------- Constants ----------
const STORAGE_KEY = 'churchos:ai:activeConversationId'

// ---------- Local thread store (serverless-friendly) ----------
// On Vercel each lambda has an ephemeral DB copy, so the server-side message
// history can be incomplete between requests. We keep the full thread in
// localStorage per conversation and merge it with whatever the server returns,
// so the UI thread never loses messages. Also sent as `history` to the chat
// API for multi-turn context when server history is empty.
const threadKey = (convId: string) => `churchos:ai:thread:${convId}`
function loadLocalThread(convId: string | null): ChatMessage[] {
  if (!convId) return []
  try {
    const raw = localStorage.getItem(threadKey(convId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr)
      ? arr.filter((m: ChatMessage) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      : []
  } catch {
    return []
  }
}
function saveLocalThread(convId: string | null, msgs: ChatMessage[]) {
  if (!convId) return
  try {
    localStorage.setItem(threadKey(convId), JSON.stringify(msgs.slice(-60)))
  } catch { /* quota — ignore */ }
}
function mergeThreads(server: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
  // Server messages win for the same id; local fills gaps (dedupe by id + content+role).
  const seen = new Set<string>()
  const out: ChatMessage[] = []
  for (const m of server) {
    const k = m.id
    if (k && seen.has(k)) continue
    if (k) seen.add(k)
    out.push(m)
  }
  for (const m of local) {
    const kContent = `${m.role}:${m.content.slice(0, 120)}`
    if (m.id && seen.has(m.id)) continue
    if (seen.has(kContent)) continue
    seen.add(m.id || kContent)
    out.push(m)
  }
  return out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
}
const SUGGESTED_PROMPTS = [
  "What's my profile info?",
  'Show my giving history',
  'Any upcoming events?',
  "Who's celebrating a birthday this month?",
]

// ---------- Helpers ----------
function loadStoredConversationId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function saveStoredConversationId(id: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore quota / privacy mode errors */
  }
}

// ---------- Markdown rendering ----------
// Lightweight styling without @tailwindcss/typography — uses arbitrary variants.
const MARKDOWN_WRAPPER_CLASS =
  'text-sm leading-relaxed [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ' +
  '[&_ul]:my-1.5 [&_ol]:my-1.5 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-5 ' +
  '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-1 ' +
  '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 ' +
  '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 ' +
  '[&_strong]:font-semibold ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:border-emerald-500/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground ' +
  '[&_hr]:my-3 [&_hr]:border-border/40'

const markdownComponents: Components = {
  pre({ children }) {
    return (
      <pre className="bg-muted/70 dark:bg-zinc-900/60 rounded-lg p-2.5 overflow-x-auto my-2 text-xs border border-border/40">
        {children}
      </pre>
    )
  },
  code({ className, children, ...rest }) {
    if (className && /language-/.test(className)) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      )
    }
    return (
      <code
        className="rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1 py-0.5 text-[0.85em] font-mono"
        {...rest}
      >
        {children}
      </code>
    )
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-600 dark:text-emerald-400 underline underline-offset-2"
      >
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    )
  },
  th({ children }) {
    return (
      <th className="border border-border/60 bg-muted/40 px-2 py-1 text-left font-semibold">
        {children}
      </th>
    )
  },
  td({ children }) {
    return <td className="border border-border/60 px-2 py-1">{children}</td>
  },
}

// ---------- Main export ----------
export function AiAssistant() {
  const user = useAuth((s) => s.user)
  const canView = useAuth((s) => s.canClient('ai', 'view'))
  const [open, setOpen] = useState(false)
  // Lazy-initialize from localStorage — runs once on first client render.
  // On SSR (window undefined) returns null; on the client, reads the stored id.
  // No DOM depends on activeId during the initial render (the panel is closed
  // by default), so there's no hydration mismatch to worry about.
  const [activeId, setActiveId] = useState<string | null>(() => loadStoredConversationId())

  // Persist activeId to localStorage whenever it changes.
  useEffect(() => {
    saveStoredConversationId(activeId)
  }, [activeId])

  // Graceful degradation — render nothing when user can't access the ai module.
  if (!user || !canView) return null

  return (
    <>
      <FloatingButton open={open} onOpen={() => setOpen(true)} />
      <ChatPanel
        open={open}
        onClose={() => setOpen(false)}
        activeId={activeId}
        setActiveId={setActiveId}
      />
    </>
  )
}

// ---------- Floating button ----------
function FloatingButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <AnimatePresence>
      {!open && (
        <motion.button
          key="ai-fab"
          type="button"
          aria-label="Open AI assistant"
          onClick={onOpen}
          initial={{ opacity: 0, scale: 0.5, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.5, y: 16 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed bottom-6 right-6 z-50 size-14 rounded-full grid place-items-center text-white shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/50 hover:scale-105 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background bg-gradient-to-br from-emerald-500 to-teal-600"
        >
          {/* subtle pulsing glow ring (always-on; we have no real "unread" signal) */}
          <span
            className="absolute -inset-1 rounded-full bg-emerald-400/30 blur-md animate-pulse"
            aria-hidden
          />
          <span className="absolute inset-0 rounded-full ring-1 ring-white/20" aria-hidden />
          <Sparkles className="size-6 relative" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}

// ---------- Chat panel (responsive: mobile Sheet + desktop card) ----------
function ChatPanel({
  open,
  onClose,
  activeId,
  setActiveId,
}: {
  open: boolean
  onClose: () => void
  activeId: string | null
  setActiveId: (id: string | null) => void
}) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="bottom"
          className="h-[100dvh] w-full max-w-full p-0 [&>button]:hidden flex flex-col"
        >
          <SheetTitle className="sr-only">AI Assistant</SheetTitle>
          <ChatPanelContent
            open={open}
            onClose={onClose}
            activeId={activeId}
            setActiveId={setActiveId}
          />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="ai-panel-desktop"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed bottom-24 right-6 z-50 w-[min(440px,calc(100vw-3rem))] h-[70vh] max-h-[640px] flex flex-col bg-card text-card-foreground rounded-2xl border border-emerald-500/25 shadow-2xl shadow-emerald-900/15 overflow-hidden ring-1 ring-black/5 dark:ring-white/5"
        >
          <ChatPanelContent
            open={open}
            onClose={onClose}
            activeId={activeId}
            setActiveId={setActiveId}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ---------- Chat panel inner content ----------
function ChatPanelContent({
  open: _open,
  onClose,
  activeId,
  setActiveId,
}: {
  open: boolean
  onClose: () => void
  activeId: string | null
  setActiveId: (id: string | null) => void
}) {
  const queryClient = useQueryClient()

  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [liveAssistantContent, setLiveAssistantContent] = useState('')
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<ChatMessage | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showList, setShowList] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [atBottom, setAtBottom] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // --- Conversation list query (only fetch when panel is open) ---
  const convListQ = useQuery<{ items: ConversationSummary[] }>({
    queryKey: ['ai', 'conversations'],
    queryFn: async () => {
      const res = await fetch('/api/ai/conversations')
      if (!res.ok) throw new Error('Failed to load conversations')
      return res.json()
    },
    enabled: _open,
  })

  // --- Active conversation query ---
  const convQ = useQuery<ConversationDetail>({
    queryKey: ['ai', 'conversation', activeId],
    queryFn: async () => {
      const res = await fetch(`/api/ai/conversations/${activeId}`)
      if (res.status === 404) {
        // Active conversation was deleted externally — clear it.
        setActiveId(null)
        throw new Error('Conversation not found')
      }
      if (!res.ok) throw new Error('Failed to load conversation')
      return res.json()
    },
    enabled: _open && !!activeId,
    retry: false,
  })

  // Clear activeId on hard error (deleted convo, etc).
  useEffect(() => {
    if (activeId && convQ.isError) {
      setActiveId(null)
    }
  }, [activeId, convQ.isError, setActiveId])

  // Abort any in-flight stream when the panel unmounts or closes.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const serverMessages = convQ.data?.messages ?? []
  const activeTitle = convQ.data?.title ?? 'New conversation'

  // Merge server messages + local thread (serverless-safe) + optimistic user message + live streaming assistant msg.
  const localThread = useMemo(() => loadLocalThread(activeId), [activeId, convQ.data])
  const displayedMessages = useMemo<ChatMessage[]>(() => {
    const arr: ChatMessage[] = mergeThreads(serverMessages, localThread)
    if (optimisticUserMsg) arr.push(optimisticUserMsg)
    if (streaming) {
      arr.push({
        id: '__streaming__',
        role: 'assistant',
        content: liveAssistantContent,
        createdAt: new Date().toISOString(),
      })
    }
    return arr
  }, [serverMessages, localThread, optimisticUserMsg, streaming, liveAssistantContent])

  const showSuggestions = !activeId || serverMessages.length === 0

  // ---------- Live events WebSocket ----------
  // Connects to the ai-events mini-service (port 3004) and shows a live
  // "activity ticker" of what's happening across the church system in real
  // time — new members, tithe confirmations, event registrations, townhall
  // messages, task assignments, etc. Clicking an event sends it to the AI as
  // a question ("tell me about X").
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([])
  const user = useAuth((s) => s.user)
  useEffect(() => {
    if (!open || !user) return
    let socket: ReturnType<typeof io> | null = null
    try {
      socket = io('/?XTransformPort=3004', { transports: ['websocket'], reconnection: true })
    } catch {
      return
    }
    const onRecent = (data: { events: LiveEvent[] }) => {
      if (data?.events?.length) setLiveEvents(data.events.slice(0, 8))
    }
    const onEvent = (event: LiveEvent) => {
      // Only show events for the current user's org (the service fans out to all
      // clients; clients filter by orgId).
      if (event.organizationId && user.organizationId && event.organizationId !== user.organizationId) return
      setLiveEvents((prev) => [event, ...prev].slice(0, 8))
    }
    socket.on('church:recent', onRecent)
    socket.on('church:event', onEvent)
    return () => {
      socket?.off('church:recent', onRecent)
      socket?.off('church:event', onEvent)
      socket?.disconnect()
    }
  }, [open, user])

  // Auto-scroll to bottom when new content arrives (unless user scrolled up).
  useEffect(() => {
    if (!atBottom) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [displayedMessages, atBottom])

  // Force-scroll to bottom on conversation switch.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setAtBottom(true)
  }, [activeId])

  // Auto-grow the textarea up to a max height.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  // --- Mutations ---
  const patchTitleMut = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await fetch(`/api/ai/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error('Failed to update title')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversation', activeId] })
      toast.success('Conversation renamed')
    },
    onError: () => toast.error('Failed to rename conversation'),
  })

  const newConvMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ai/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('Failed to create conversation')
      return res.json()
    },
    onSuccess: (data: ConversationSummary) => {
      setActiveId(data.id)
      setShowList(false)
      setInput('')
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
    },
    onError: () => toast.error('Failed to create conversation'),
  })

  const deleteConvMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ai/conversations/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete conversation')
      return res.json()
    },
    onSuccess: (_data, deletedId) => {
      if (deletedId === activeId) setActiveId(null)
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
      toast.success('Conversation deleted')
    },
    onError: () => toast.error('Failed to delete conversation'),
  })

  // --- SSE streaming send ---
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || streaming) return

      // 1) Ensure we have an active conversation.
      let convId = activeId
      if (!convId) {
        try {
          const res = await fetch('/api/ai/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          if (!res.ok) throw new Error('Failed to create conversation')
          const data: ConversationSummary = await res.json()
          convId = data.id
          setActiveId(data.id)
          queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
        } catch {
          toast.error('Failed to start a new conversation')
          return
        }
      }

      // 2) Optimistic user message + reset streaming state.
      const userMsg: ChatMessage = {
        id: `opt-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      }
      setOptimisticUserMsg(userMsg)
      setInput('')
      setErrorMsg(null)
      setStreaming(true)
      setLiveAssistantContent('')

      const controller = new AbortController()
      abortRef.current = controller
      let streamedText = '' // accumulated delta text (closures see fresh value)

      try {
        // Build client-side history (last 20 turns of the merged thread, before
        // this message) — used by the server when its DB history is empty
        // (per-lambda ephemeral DB on serverless).
        const threadBefore = mergeThreads(convQ.data?.messages ?? [], loadLocalThread(convId))
          .filter((m) => !(m.role === 'user' && m.content === trimmed))
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content }))

        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: convId, message: trimmed, history: threadBefore }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          const errData = await res.json().catch(() => null)
          throw new Error(errData?.error || `Request failed (${res.status})`)
        }

        // 3) Read the SSE stream.
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          for (const evt of events) {
            const dataLines = evt
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
            if (dataLines.length === 0) continue
            const payload = dataLines.join('\n')
            let data: SSEEvent
            try {
              data = JSON.parse(payload)
            } catch {
              continue
            }
            if (data.type === 'start') {
              // server confirmed the conversationId
            } else if (data.type === 'delta') {
              streamedText += data.delta
              setLiveAssistantContent((prev) => prev + data.delta)
            } else if (data.type === 'done') {
              setStreaming(false)
              setLiveAssistantContent('')
              // Persist the full turn to the local thread store so the UI
              // keeps it even when the server DB copy is a different lambda.
              try {
                const thread = loadLocalThread(convId)
                thread.push(userMsg)
                if (streamedText.trim()) {
                  thread.push({
                    id: data.messageId || `local-${Date.now()}`,
                    role: 'assistant',
                    content: streamedText,
                    createdAt: new Date().toISOString(),
                  })
                }
                saveLocalThread(convId, thread)
              } catch { /* ignore */ }
              // Refetch to pick up the persisted assistant message,
              // then clear the optimistic user message (avoids duplicate display).
              try {
                await queryClient.invalidateQueries({
                  queryKey: ['ai', 'conversation', convId],
                })
              } catch {
                /* ignore */
              }
              queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
              setOptimisticUserMsg(null)
            } else if (data.type === 'error') {
              setStreaming(false)
              setLiveAssistantContent('')
              setErrorMsg(data.message)
              toast.error(data.message || 'AI completion failed')
              // Server persists an assistant error message — refetch to show it.
              try {
                await queryClient.invalidateQueries({
                  queryKey: ['ai', 'conversation', convId],
                })
              } catch {
                /* ignore */
              }
              setOptimisticUserMsg(null)
            }
          }
        }
      } catch (err) {
        const e = err as Error
        if (e?.name === 'AbortError') {
          // User clicked Stop — clear optimistic after a refetch so any
          // server-saved user message remains visible.
          setStreaming(false)
          setLiveAssistantContent('')
          try {
            await queryClient.invalidateQueries({
              queryKey: ['ai', 'conversation', convId],
            })
          } catch {
            /* ignore */
          }
          queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
          setOptimisticUserMsg(null)
        } else {
          setStreaming(false)
          setLiveAssistantContent('')
          const msg = e?.message || 'Streaming failed'
          setErrorMsg(msg)
          toast.error(msg)
        }
      } finally {
        abortRef.current = null
      }
    },
    [activeId, streaming, setActiveId, queryClient],
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setAtBottom(distance < 80)
  }

  const startEditTitle = () => {
    setDraftTitle(activeTitle)
    setEditingTitle(true)
  }
  const commitTitle = () => {
    if (!activeId || !draftTitle.trim()) {
      setEditingTitle(false)
      return
    }
    patchTitleMut.mutate({ id: activeId, title: draftTitle.trim() })
    setEditingTitle(false)
  }
  const cancelEditTitle = () => {
    setEditingTitle(false)
    setDraftTitle(activeTitle)
  }

  return (
    <div className="flex flex-col h-full bg-card text-card-foreground relative">
      {/* ---------- Header ---------- */}
      <header className="flex items-center gap-2 px-3 h-14 border-b border-border/60 shrink-0 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent">
        <div className="size-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shrink-0 shadow-sm shadow-emerald-500/30">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          {editingTitle && activeId ? (
            <div className="flex items-center gap-1">
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle()
                  if (e.key === 'Escape') cancelEditTitle()
                }}
                onBlur={commitTitle}
                autoFocus
                aria-label="Edit conversation title"
                className="h-7 text-sm"
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                onClick={commitTitle}
                aria-label="Save title"
              >
                <Check className="size-3.5" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={activeId ? startEditTitle : undefined}
              className="text-left min-w-0 w-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 rounded-sm"
              disabled={!activeId}
              title={activeId ? 'Click to rename' : undefined}
            >
              <p className="text-sm font-semibold leading-tight truncate text-foreground">
                AI Assistant
              </p>
              <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                {activeId ? (
                  <>
                    <span className="truncate">{convQ.isLoading ? 'Loading…' : activeTitle}</span>
                    <Pencil className="size-3 opacity-0 group-hover:opacity-60 shrink-0" />
                  </>
                ) : (
                  'Ask anything about your church'
                )}
              </p>
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => newConvMut.mutate()}
            aria-label="New conversation"
            disabled={newConvMut.isPending}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => setShowList(true)}
            aria-label="Conversation history"
          >
            <MessageSquare className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={onClose}
            aria-label="Close AI assistant"
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {/* ---------- Messages area ---------- */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-500/30 [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {convQ.isLoading && activeId ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Skeleton className="h-9 w-3/4 rounded-2xl rounded-br-md" />
            </div>
            <div className="flex justify-start gap-2">
              <Skeleton className="size-6 rounded-full shrink-0" />
              <Skeleton className="h-16 w-full rounded-2xl rounded-bl-md" />
            </div>
          </div>
        ) : displayedMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="size-14 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 grid place-items-center text-emerald-600 dark:text-emerald-300 mb-4 ring-1 ring-emerald-500/20">
              <Sparkles className="size-7" />
            </div>
            <h3 className="text-base font-semibold">How can I help?</h3>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-[280px]">
              Ask about your church members, events, giving, attendance, and more.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedMessages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                streaming={msg.id === '__streaming__'}
              />
            ))}
            {errorMsg && (
              isSetupError(errorMsg) ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <Sparkles className="size-3.5" /> AI setup required on this deployment
                  </div>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Get a Z.ai API key (z.ai → API Keys).</li>
                    <li>Add it as <code className="text-foreground bg-muted px-1 rounded">LLM_API_KEY</code> in Vercel → Settings → Environment Variables.</li>
                    <li>Redeploy — the assistant runs on GLM 4.5 Flash (free).</li>
                  </ol>
                </div>
              ) : (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {errorMsg}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* ---------- Live Events Ticker ---------- */}
      {liveEvents.length > 0 && (
        <div className="border-t border-border/60 shrink-0 bg-background/60 backdrop-blur px-3 pt-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <Activity className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Live activity</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {liveEvents.slice(0, 6).map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => sendMessage(`Tell me about this recent event: ${ev.title} — ${ev.message}`)}
                className="shrink-0 text-left text-[11px] rounded-lg border border-border/60 bg-muted/40 hover:bg-emerald-500/10 hover:border-emerald-500/40 px-2 py-1.5 transition-colors max-w-[200px]"
                title={ev.message}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  {ev.isFinance ? (
                    <Zap className="size-2.5 text-amber-500 shrink-0" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                  )}
                  <span className="font-medium text-foreground truncate">{ev.title}</span>
                </div>
                <p className="text-muted-foreground line-clamp-1 text-[10px]">{ev.message}</p>
                <p className="text-muted-foreground/60 text-[9px] mt-0.5">{relativeTime(ev.at)}{ev.actorName ? ` · ${ev.actorName}` : ''}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Suggestions + Input ---------- */}
      <div className="border-t border-border/60 shrink-0 bg-background/60 backdrop-blur p-3 space-y-2">
        {showSuggestions && !streaming && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => sendMessage(p)}
                className="text-xs rounded-full border border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 hover:border-emerald-500/50 px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={streaming ? 'AI is responding…' : 'Ask anything…  (Enter to send, Shift+Enter for newline)'}
            rows={1}
            disabled={streaming}
            aria-label="Message AI assistant"
            className="flex-1 resize-none rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 max-h-40 disabled:opacity-60"
          />
          {streaming ? (
            <Button
              size="icon"
              variant="destructive"
              className="size-9 rounded-xl shrink-0"
              onClick={handleStop}
              aria-label="Stop streaming"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="size-9 rounded-xl shrink-0 bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white border-0"
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              aria-label="Send message"
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* ---------- Conversation list overlay ---------- */}
      <AnimatePresence>
        {showList && (
          <motion.div
            key="conv-list"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute inset-0 z-20 bg-card flex flex-col"
          >
            <header className="flex items-center gap-2 px-3 h-14 border-b border-border/60 shrink-0 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent">
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => setShowList(false)}
                aria-label="Back to chat"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <h2 className="text-sm font-semibold flex-1">Conversations</h2>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                onClick={() => newConvMut.mutate()}
                disabled={newConvMut.isPending}
              >
                <Plus className="size-3.5" /> New
              </Button>
            </header>
            <div className="flex-1 overflow-y-auto p-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-500/30">
              {convListQ.isLoading ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 rounded-lg" />
                  ))}
                </div>
              ) : (convListQ.data?.items?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 px-4">
                  <MessageSquare className="size-8 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No conversations yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Start a new one above, or just ask a question.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {convListQ.data!.items.map((c) => (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setActiveId(c.id)
                        setShowList(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setActiveId(c.id)
                          setShowList(false)
                        }
                      }}
                      className={cn(
                        'group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
                        c.id === activeId
                          ? 'bg-emerald-500/10'
                          : 'hover:bg-accent/60',
                      )}
                    >
                      <MessageSquare
                        className={cn(
                          'size-4 shrink-0',
                          c.id === activeId
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-muted-foreground',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'text-sm truncate',
                            c.id === activeId
                              ? 'font-medium text-emerald-700 dark:text-emerald-300'
                              : 'text-foreground',
                          )}
                        >
                          {c.title || 'Untitled'}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70">
                          {relativeTime(c.updatedAt)} · {c.messageCount} msg
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 opacity-0 group-hover:opacity-100 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteConvMut.mutate(c.id)
                        }}
                        aria-label={`Delete ${c.title || 'conversation'}`}
                      >
                        <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------- Message bubble ----------
function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage
  streaming: boolean
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-emerald-500 to-teal-600 text-white px-3.5 py-2 text-sm shadow-sm shadow-emerald-500/20">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    )
  }

  // Assistant
  const isThinking = streaming && !message.content
  return (
    <div className="flex justify-start gap-2">
      <div className="size-6 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 grid place-items-center text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5 ring-1 ring-emerald-500/15">
        <Sparkles className="size-3.5" />
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted/60 dark:bg-zinc-900/40 border border-border/40 px-3.5 py-2.5 text-sm">
        {isThinking ? (
          <ThinkingDots />
        ) : (
          <div className={MARKDOWN_WRAPPER_CLASS}>
            <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
            {streaming && (
              <span
                className="inline-block size-3 align-text-bottom ml-0.5 rounded-full bg-emerald-500 animate-pulse"
                aria-hidden
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="AI is thinking">
      <span
        className="size-2 rounded-full bg-emerald-500/70 animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="size-2 rounded-full bg-emerald-500/70 animate-bounce"
        style={{ animationDelay: '120ms' }}
      />
      <span
        className="size-2 rounded-full bg-emerald-500/70 animate-bounce"
        style={{ animationDelay: '240ms' }}
      />
      <span className="ml-2 text-xs text-muted-foreground">Thinking…</span>
    </div>
  )
}
