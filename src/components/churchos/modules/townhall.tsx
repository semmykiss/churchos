'use client'

// =============================================================================
// ChurchOS — Town Hall module (redesigned v3)
// -----------------------------------------------------------------------------
// Modern 3-column chat UI:
//   1.  Slim nav rail (left, ~64px) — brand mark + back-to-app.
//   2.  Chat list sidebar (~340px) — Chats header, search, DM stories row,
//       Recent room list with avatars + unread badges.
//   3.  Chat area (flex-1) — header + message stream + pill input + send btn.
//   4.  Emerald/teal theme (5-theme picker kept; default emerald).
//   5.  WhatsApp-style bubbles (mine right / others left, avatars, timestamps,
//       reactions, read receipts, attachments, threads, edit/delete).
//   6.  Message actions menu (Reply / React / Pin / Edit within 5min / Delete).
//   7.  Pinned-messages banner (collapsible, amber tinted).
//   8.  Date separators + unread divider.
//   9.  Smart polling (5s messages / 15s rooms).
//  10.  Auto-scroll on new messages + scroll to first unread on room open.
//  11.  Mobile: sidebar becomes a Sheet.
//  12.  @mention overlay + emoji picker.
// =============================================================================

import { useState, useMemo, useEffect, useRef, useCallback, createElement } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/lib/auth-store'
import { relativeTime, formatDate, initials } from '@/lib/format'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui/popover'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from '@/components/ui/collapsible'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import {
  MessageSquare, Send, Plus, Search, Settings2, Reply as ReplyIcon, Trash2,
  Hash, Users, Megaphone, User as UserIcon, X, AtSign, Smile, MoreVertical,
  CheckCheck, MessageCircle, Pin, PinOff, Pencil, Paperclip,
  FileText, Download, ChevronDown, Check, Menu as MenuIcon, Phone, Video,
  Home, Bell, BellOff,
} from 'lucide-react'
import { EmptyState } from '@/components/churchos/ui'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RoomType = 'townhall' | 'department' | 'role' | 'group' | 'direct'

interface Room {
  id: string
  name: string
  description?: string | null
  type: RoomType
  refId?: string | null
  createdBy?: string | null
  createdAt: string
  updatedAt?: string
  lastMessage?: {
    id: string
    body: string
    senderName: string
    senderId: string
    createdAt: string
  } | null
  unread: number
}

interface ReactionSummary {
  count: number
  userIds: string[]
}

interface ChatReply {
  id: string
  senderId: string
  senderName: string
  body: string
  createdAt: string
  editedAt?: string | null
  reactions: Record<string, ReactionSummary>
  isOwn?: boolean
}

interface ChatMessage {
  id: string
  roomId: string
  senderId: string
  senderName: string
  body: string
  parentId?: string | null
  createdAt: string
  editedAt?: string | null
  isPinned?: boolean
  attachmentUrl?: string | null
  attachmentName?: string | null
  attachmentType?: string | null
  reactions: Record<string, ReactionSummary>
  readBy: number
  readByEveryone: boolean
  isOwn: boolean
  replies?: ChatReply[]
}

interface PinnedMessage {
  id: string
  senderName: string
  body: string
  createdAt: string
}

interface MemberLite {
  id: string
  firstName: string
  lastName: string
  preferredName?: string | null
  photoUrl?: string | null
  memberId?: string | null
  status?: string
}

interface DeptLite {
  id: string
  name: string
  color?: string | null
}

interface PendingAttachment {
  url: string
  name: string
  type: string
  isImage: boolean
}

interface RoomDetailResponse {
  room: {
    id: string
    name: string
    description?: string | null
    type: RoomType
    refId?: string | null
    createdBy?: string | null
    createdAt: string
  }
  messages: ChatMessage[]
  pinnedMessages: PinnedMessage[]
}

interface RoomsResponse {
  rooms: Room[]
}

// ---------------------------------------------------------------------------
// Themes (5)
// ---------------------------------------------------------------------------
type ChatTheme = 'default' | 'ocean' | 'sunset' | 'forest' | 'slate'

interface ThemeConfig {
  value: ChatTheme
  label: string
  desc: string
  mine: string
  others: string
  dot: string
  mineText: string
  accent: string
}

const THEMES: ThemeConfig[] = [
  {
    value: 'default', label: 'Default', desc: 'Emerald',
    mine: 'bg-emerald-600 text-white rounded-br-sm',
    others: 'bg-muted text-foreground rounded-bl-sm',
    dot: 'bg-emerald-500',
    mineText: 'text-emerald-50',
    accent: 'from-emerald-500 to-teal-600',
  },
  {
    value: 'ocean', label: 'Ocean', desc: 'Blue',
    mine: 'bg-blue-600 text-white rounded-br-sm',
    others: 'bg-muted text-foreground rounded-bl-sm',
    dot: 'bg-blue-600',
    mineText: 'text-blue-50',
    accent: 'from-blue-500 to-cyan-600',
  },
  {
    value: 'sunset', label: 'Sunset', desc: 'Rose',
    mine: 'bg-rose-600 text-white rounded-br-sm',
    others: 'bg-muted text-foreground rounded-bl-sm',
    dot: 'bg-rose-500',
    mineText: 'text-rose-50',
    accent: 'from-rose-500 to-orange-600',
  },
  {
    value: 'forest', label: 'Forest', desc: 'Teal',
    mine: 'bg-teal-700 text-white rounded-br-sm',
    others: 'bg-muted text-foreground rounded-bl-sm',
    dot: 'bg-teal-600',
    mineText: 'text-teal-50',
    accent: 'from-teal-500 to-emerald-700',
  },
  {
    value: 'slate', label: 'Slate', desc: 'Dark',
    mine: 'bg-slate-700 text-white dark:bg-slate-800 rounded-br-sm',
    others: 'bg-muted text-foreground rounded-bl-sm',
    dot: 'bg-slate-700',
    mineText: 'text-slate-50',
    accent: 'from-slate-600 to-slate-800',
  },
]

const REACTION_EMOJIS = ['👍', '❤️', '🙏', '🎉', '😂', '😮', '😢', '👏']

const EMOJI_PICKER_LIST: string[] = [
  '😀', '😂', '🥰', '😍', '😘', '😎', '🤩', '😇', '🙂', '😉',
  '😢', '😭', '😔', '😡', '🤔', '😴', '🤯', '😱', '😏', '🤗',
  '👍', '👎', '👏', '🙏', '🙌', '💪', '🎉', '🔥', '💯', '✨',
]

const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'department_head', 'unit_leader',
])

function useChatTheme(): [ChatTheme, (t: ChatTheme) => void] {
  const [theme, setThemeState] = useState<ChatTheme>(() => {
    if (typeof localStorage === 'undefined') return 'default'
    try {
      const saved = localStorage.getItem('churchos:chat-theme-v2') as ChatTheme | null
      return saved && THEMES.some((t) => t.value === saved) ? saved : 'default'
    } catch {
      return 'default'
    }
  })
  const setter = useCallback((t: ChatTheme) => {
    setThemeState(t)
    try { localStorage.setItem('churchos:chat-theme-v2', t) } catch { /* ignore */ }
  }, [])
  return [theme, setter]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function roomTypeIcon(type: RoomType) {
  switch (type) {
    case 'townhall': return Megaphone
    case 'department': return Hash
    case 'role': return Users
    case 'group': return MessageCircle
    case 'direct': return UserIcon
    default: return MessageSquare
  }
}

function roomTypeLabel(type: RoomType) {
  switch (type) {
    case 'townhall': return 'Town Hall'
    case 'department': return 'Dept'
    case 'role': return 'Role'
    case 'group': return 'Group'
    case 'direct': return 'DM'
    default: return type
  }
}

function roomTypeBadgeClass(type: RoomType) {
  switch (type) {
    case 'townhall': return 'bg-primary/10 text-primary border-primary/20'
    case 'department': return 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20'
    case 'role': return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
    case 'group': return 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20'
    case 'direct': return 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

function roomIconWrap(type: RoomType) {
  switch (type) {
    case 'townhall': return 'bg-primary/10 text-primary'
    case 'department': return 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
    case 'role': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    case 'group': return 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
    case 'direct': return 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
    default: return 'bg-muted text-muted-foreground'
  }
}

function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
  }).format(d)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function dayLabel(date: Date): string {
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(date, today)) return 'Today'
  if (isSameDay(date, yesterday)) return 'Yesterday'
  return formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function isImageAttachment(type?: string | null): boolean {
  return !!type && type.startsWith('image/')
}

function isDeletedBody(body: string | undefined | null): boolean {
  return !!body && body.includes('This message was deleted')
}

function within5Min(createdAt: string | Date): boolean {
  const d = typeof createdAt === 'string' ? new Date(createdAt) : createdAt
  return Date.now() - d.getTime() < 5 * 60 * 1000
}

function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function renderBody(body: string, search?: string): ReactNode {
  const mentionParts = body.split(/(@[A-Za-z][A-Za-z'-]+(?:\s[A-Za-z][A-Za-z'-]+)?)/g)
  const q = search?.trim().toLowerCase()
  const nodes: ReactNode[] = []
  mentionParts.forEach((p, i) => {
    if (!p) return
    if (p.startsWith('@') && p.length > 1) {
      if (q && p.toLowerCase().includes(q)) {
        nodes.push(
          <mark key={`m${i}`} className="bg-yellow-300/70 dark:bg-yellow-500/40 rounded px-0.5">
            <span className="font-semibold text-primary">{p}</span>
          </mark>,
        )
      } else {
        nodes.push(<span key={`m${i}`} className="font-semibold text-primary">{p}</span>)
      }
      return
    }
    if (q) {
      const lower = p.toLowerCase()
      let idx = lower.indexOf(q)
      let cursor = 0
      const k = `t${i}`
      if (idx === -1) {
        nodes.push(<span key={k}>{p}</span>)
        return
      }
      while (idx >= 0) {
        if (idx > cursor) nodes.push(<span key={`${k}-${cursor}`}>{p.slice(cursor, idx)}</span>)
        nodes.push(
          <mark key={`${k}-${idx}`} className="bg-yellow-300/70 dark:bg-yellow-500/40 rounded px-0.5">
            {p.slice(idx, idx + q.length)}
          </mark>,
        )
        cursor = idx + q.length
        idx = lower.indexOf(q, cursor)
      }
      if (cursor < p.length) nodes.push(<span key={`${k}-end`}>{p.slice(cursor)}</span>)
    } else {
      nodes.push(<span key={`t${i}`}>{p}</span>)
    }
  })
  return <>{nodes}</>
}

function getSeenAt(roomId: string | null): string | null {
  if (!roomId || typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(`churchos:seen:${roomId}`)
  } catch {
    return null
  }
}
function setSeenAt(roomId: string, iso: string) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(`churchos:seen:${roomId}`, iso)
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Main module
// ---------------------------------------------------------------------------
export default function TownHallModule() {
  const { user, canClient, setModule } = useAuth()
  const role = user?.role ?? 'member'
  const isStaff = STAFF_ROLES.has(role)
  const canManageRooms = canClient('townhall', 'manage') || canClient('townhall', 'delete') || isStaff
  const canCreateRooms = canClient('townhall', 'create') || isStaff

  const queryClient = useQueryClient()

  // Layout / UI state
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [theme, setTheme] = useChatTheme()
  const [themeOpen, setThemeOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pinnedBannerOpen, setPinnedBannerOpen] = useState(true)
  const [newRoomOpen, setNewRoomOpen] = useState(false)
  const [newDMOpen, setNewDMOpen] = useState(false)
  const [deleteRoomId, setDeleteRoomId] = useState<string | null>(null)
  const [deleteMsg, setDeleteMsg] = useState<{ id: string; body: string } | null>(null)

  // Input / compose state
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editingMsg, setEditingMsg] = useState<{ id: string; body: string } | null>(null)
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [seenAt, setSeenAt] = useState<string | null>(() => getSeenAt(activeRoomId))
  const [scrolledRoomId, setScrolledRoomId] = useState<string | null>(null)

  // Room list — poll every 15s
  const roomsQuery = useQuery<RoomsResponse>({
    queryKey: ['townhall-rooms'],
    queryFn: async () => {
      const res = await fetch('/api/townhall')
      if (!res.ok) throw new Error('Failed to load rooms')
      return res.json() as Promise<RoomsResponse>
    },
    refetchInterval: 15_000,
  })

  // Active room + messages — poll every 5s
  const messagesQuery = useQuery<RoomDetailResponse>({
    queryKey: ['townhall-messages', activeRoomId, searchQuery],
    queryFn: async () => {
      if (!activeRoomId) {
        return { room: null as unknown, messages: [], pinnedMessages: [] } as RoomDetailResponse
      }
      const qs = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ''
      const res = await fetch(`/api/townhall/${activeRoomId}${qs}`)
      if (!res.ok) throw new Error('Failed to load messages')
      return res.json() as Promise<RoomDetailResponse>
    },
    enabled: !!activeRoomId,
    refetchInterval: 5_000,
  })

  // Render-time "adjust state when prop changes" pattern: when activeRoomId changes,
  // reset compose state + read seenAt from localStorage. This avoids setState-in-effect.
  const [prevRoomId, setPrevRoomId] = useState<string | null>(activeRoomId)
  if (activeRoomId !== prevRoomId) {
    setPrevRoomId(activeRoomId)
    setSeenAt(getSeenAt(activeRoomId))
    setScrolledRoomId(null)
    setReplyTo(null)
    setEditingMsg(null)
    setDraft('')
    setAttachment(null)
    setMentionPickerOpen(false)
    setSearchOpen(false)
    setSearchQuery('')
    setPinnedBannerOpen(true)
  }

  // After ~5s of viewing, persist seenAt to latest message timestamp so divider clears.
  useEffect(() => {
    if (!activeRoomId) return
    const msgs = messagesQuery.data?.messages
    if (!msgs || msgs.length === 0) return
    const latest = msgs[msgs.length - 1]
    const timer = setTimeout(() => {
      setSeenAt(activeRoomId, latest.createdAt)
      setSeenAt(latest.createdAt)
    }, 5_000)
    return () => clearTimeout(timer)
  }, [activeRoomId, messagesQuery.data?.messages])

  // Auto-scroll: initial scroll to first unread OR bottom; subsequent = stick-to-bottom
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const msgs = messagesQuery.data?.messages
    if (!msgs || msgs.length === 0) return

    const isInitial = scrolledRoomId !== activeRoomId
    if (isInitial) {
      let scrolled = false
      if (seenAt) {
        const seenTime = new Date(seenAt).getTime()
        const idx = msgs.findIndex((m) => new Date(m.createdAt).getTime() > seenTime)
        if (idx >= 0) {
          const target = el.querySelector(`[data-msg-id="${msgs[idx].id}"]`) as HTMLElement | null
          if (target) {
            target.scrollIntoView({ behavior: 'auto', block: 'center' })
            scrolled = true
          }
        }
      }
      if (!scrolled) el.scrollTop = el.scrollHeight
      // Defer setState to avoid cascading render lint warning
      const t = setTimeout(() => setScrolledRoomId(activeRoomId), 0)
      return () => clearTimeout(t)
    }
    // Auto-stick to bottom when near bottom; else do nothing
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 120) {
      el.scrollTop = el.scrollHeight
    }
  }, [messagesQuery.data, activeRoomId, seenAt, scrolledRoomId])

  // ---- Mutations ----
  const sendMessage = useMutation({
    mutationFn: async (vars: {
      body: string
      parentId?: string | null
      attachment?: PendingAttachment | null
    }) => {
      if (!activeRoomId) throw new Error('No room selected')
      const payload: Record<string, unknown> = { body: vars.body, parentId: vars.parentId ?? null }
      if (vars.attachment) {
        payload.attachmentUrl = vars.attachment.url
        payload.attachmentName = vars.attachment.name
        payload.attachmentType = vars.attachment.type
      }
      const res = await fetch(`/api/townhall/${activeRoomId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to send message')
      }
      return res.json()
    },
    onSuccess: () => {
      setDraft('')
      setReplyTo(null)
      setAttachment(null)
      setMentionPickerOpen(false)
      queryClient.invalidateQueries({ queryKey: ['townhall-messages', activeRoomId] })
      queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const editMessage = useMutation({
    mutationFn: async (vars: { messageId: string; newBody: string }) => {
      if (!activeRoomId) throw new Error('No room selected')
      const res = await fetch(`/api/townhall/${activeRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', messageId: vars.messageId, newBody: vars.newBody }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to edit message')
      }
      return res.json()
    },
    onSuccess: () => {
      setEditingMsg(null)
      queryClient.invalidateQueries({ queryKey: ['townhall-messages', activeRoomId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMessage = useMutation({
    mutationFn: async (messageId: string) => {
      if (!activeRoomId) throw new Error('No room selected')
      const res = await fetch(`/api/townhall/${activeRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', messageId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to delete message')
      }
      return res.json()
    },
    onSuccess: () => {
      setDeleteMsg(null)
      toast.success('Message deleted')
      queryClient.invalidateQueries({ queryKey: ['townhall-messages', activeRoomId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pinMessage = useMutation({
    mutationFn: async (vars: { messageId: string; pin: boolean }) => {
      if (!activeRoomId) throw new Error('No room selected')
      const res = await fetch(`/api/townhall/${activeRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: vars.pin ? 'pin' : 'unpin', messageId: vars.messageId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to pin message')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['townhall-messages', activeRoomId] })
      toast.success('Pinned message updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reactMessage = useMutation({
    mutationFn: async (vars: { messageId: string; emoji: string }) => {
      if (!activeRoomId) throw new Error('No room selected')
      const res = await fetch(`/api/townhall/${activeRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'react', messageId: vars.messageId, emoji: vars.emoji }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to react')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['townhall-messages', activeRoomId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRoom = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await fetch(`/api/townhall/${roomId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to delete room')
      }
      return res.json()
    },
    onSuccess: (_d, roomId) => {
      toast.success('Room deleted')
      if (activeRoomId === roomId) {
        setActiveRoomId(null)
      }
      setDeleteRoomId(null)
      queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ---- Compose handlers ----
  const handleDraftChange = (val: string) => {
    setDraft(val)
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    const before = val.slice(0, pos)
    const match = before.match(/@([A-Za-z][A-Za-z'-]*(?:\s[A-Za-z][A-Za-z'-]*)?)$/)
    if (match) {
      setMentionStart(pos - match[0].length)
      setMentionQuery(match[1])
      setMentionPickerOpen(true)
    } else {
      setMentionPickerOpen(false)
      setMentionStart(null)
    }
  }

  const insertMention = (member: MemberLite) => {
    if (mentionStart === null) return
    const name = `${member.firstName} ${member.lastName}`
    const before = draft.slice(0, mentionStart)
    const cursorPos = textareaRef.current?.selectionStart ?? mentionStart
    const after = draft.slice(cursorPos)
    const insert = `@${name} `
    const next = before + insert + after
    setDraft(next)
    setMentionPickerOpen(false)
    setMentionStart(null)
    setTimeout(() => {
      const el = textareaRef.current
      if (!el) return
      const caret = (before + insert).length
      el.focus()
      el.setSelectionRange(caret, caret)
    }, 0)
  }

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current
    if (!el) {
      setDraft((d) => d + emoji)
      return
    }
    const pos = el.selectionStart ?? draft.length
    const next = draft.slice(0, pos) + emoji + draft.slice(pos)
    setDraft(next)
    setEmojiPickerOpen(false)
    setTimeout(() => {
      el.focus()
      const caret = pos + emoji.length
      el.setSelectionRange(caret, caret)
    }, 0)
  }

  const handleAttachFile = (file: File | null) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      toast.error('File too large. Max 4MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result || '')
      setAttachment({
        url,
        name: file.name,
        type: file.type || 'application/octet-stream',
        isImage: file.type.startsWith('image/'),
      })
    }
    reader.onerror = () => toast.error('Failed to read file')
    reader.readAsDataURL(file)
  }

  const handleSend = () => {
    if (editingMsg) {
      const text = draft.trim()
      if (!text) return
      editMessage.mutate({ messageId: editingMsg.id, newBody: text })
      return
    }
    const text = draft.trim()
    if (!text && !attachment) return
    if (!activeRoomId) return
    sendMessage.mutate({
      body: text || (attachment ? '(attachment)' : ''),
      parentId: replyTo?.id,
      attachment,
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') {
      if (mentionPickerOpen) setMentionPickerOpen(false)
      else if (editingMsg) setEditingMsg(null)
      else if (replyTo) setReplyTo(null)
    }
  }

  const handleSelectRoom = (roomId: string) => {
    setActiveRoomId(roomId)
    setMobileSidebarOpen(false)
  }

  // ---- Derived data ----
  const rooms = roomsQuery.data?.rooms ?? []
  const activeRoom = messagesQuery.data?.room
  const messages = messagesQuery.data?.messages ?? []
  const pinnedMessages = messagesQuery.data?.pinnedMessages ?? []
  const themeCfg = THEMES.find((t) => t.value === theme) ?? THEMES[0]

  // Filter rooms by sidebar search input (if any)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const filteredRooms = useMemo(() => {
    if (!sidebarSearch.trim()) return rooms
    const q = sidebarSearch.toLowerCase()
    return rooms.filter((r) =>
      r.name.toLowerCase().includes(q)
      || (r.description?.toLowerCase().includes(q) ?? false)
      || r.type.toLowerCase().includes(q),
    )
  }, [rooms, sidebarSearch])

  // Direct-message "stories" row: top 8 direct rooms by updatedAt for quick access
  const dmRooms = useMemo(() => {
    const dms = rooms.filter((r) => r.type === 'direct')
    return dms
      .slice()
      .sort((a, b) => {
        const at = a.lastMessage?.createdAt ?? a.updatedAt ?? a.createdAt
        const bt = b.lastMessage?.createdAt ?? b.updatedAt ?? b.createdAt
        return new Date(bt).getTime() - new Date(at).getTime()
      })
      .slice(0, 8)
  }, [rooms])

  // Unread divider position
  const unreadDividerIdx = useMemo(() => {
    if (!seenAt) return -1
    const seenTime = new Date(seenAt).getTime()
    if (!seenTime) return -1
    return messages.findIndex((m) => new Date(m.createdAt).getTime() > seenTime)
  }, [messages, seenAt, activeRoomId])

  return (
    <div className="flex flex-col h-[calc(100vh-128px)] min-h-[600px] -m-4 lg:-m-6 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[64px_340px_1fr] flex-1 min-h-0 bg-background">
        {/* ====================================================== NAV RAIL (desktop) */}
        <NavRail onBack={() => setModule('dashboard')} />

        {/* ====================================================== SIDEBAR (desktop) */}
        <aside className="hidden lg:flex flex-col border-r border-border/60 bg-muted/30 min-h-0">
          <ChatListSidebar
            rooms={filteredRooms}
            allRooms={rooms}
            dmRooms={dmRooms}
            loading={roomsQuery.isLoading}
            activeRoomId={activeRoomId}
            onSelect={handleSelectRoom}
            search={sidebarSearch}
            onSearch={setSidebarSearch}
            currentUserId={user?.id}
            canCreateRooms={canCreateRooms}
            isStaff={isStaff}
            onNewDM={() => setNewDMOpen(true)}
            onNewRoom={() => setNewRoomOpen(true)}
            onDeleteRoom={(id) => setDeleteRoomId(id)}
          />
        </aside>

        {/* ====================================================== CHAT AREA */}
        <section className="flex flex-col bg-background min-w-0 min-h-0">
          {!activeRoomId || !activeRoom ? (
            <div className="flex-1 grid place-items-center px-4">
              <EmptyState
                icon={MessageCircle}
                title={rooms.length === 0 ? 'No conversations yet' : 'Select a conversation'}
                description={
                  rooms.length === 0
                    ? 'Start a new DM or ask an admin to create a department room.'
                    : 'Pick a room from the list to start chatting.'
                }
                action={
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setNewDMOpen(true)} className="gap-2">
                      <UserIcon className="size-4" /> New DM
                    </Button>
                    {canCreateRooms && isStaff && (
                      <Button onClick={() => setNewRoomOpen(true)} className="gap-2">
                        <Plus className="size-4" /> New Room
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="lg:hidden gap-2"
                      onClick={() => setMobileSidebarOpen(true)}
                    >
                      <MessageSquare className="size-4" /> Rooms
                    </Button>
                  </div>
                }
              />
            </div>
          ) : (
            <>
              {/* ----- Chat header ----- */}
              <ChatAreaHeader
                room={activeRoom}
                searchOpen={searchOpen}
                onToggleSearch={() => {
                  setSearchOpen((v) => !v)
                  if (searchOpen) setSearchQuery('')
                }}
                themeOpen={themeOpen}
                onThemeOpenChange={setThemeOpen}
                theme={theme}
                onThemeChange={setTheme}
                themeCfg={themeCfg}
                onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
                canManageRooms={canManageRooms}
                isOwner={activeRoom.createdBy === user?.id}
                onPinRoom={() => toast.info('Room pinning coming soon')}
                onMuteRoom={() => toast.info('Mute notifications coming soon')}
                onCall={() => toast.info('Calls coming soon')}
                onVideoCall={() => toast.info('Video calls coming soon')}
                onDeleteRoom={() => setDeleteRoomId(activeRoom.id)}
              />

              {/* ----- Search bar (collapsible) ----- */}
              {searchOpen && (
                <div className="px-4 py-2 border-b border-border/60 bg-muted/20 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search messages in this room…"
                      className="h-9 pl-8 pr-8 bg-background rounded-full"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
                        onClick={() => setSearchQuery('')}
                        aria-label="Clear search"
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                  {searchQuery && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {messages.length} result{messages.length === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              )}

              {/* ----- Pinned messages banner ----- */}
              {pinnedMessages.length > 0 && (
                <div className="px-4 py-2 border-b border-border/60 bg-amber-500/5 shrink-0">
                  <Collapsible open={pinnedBannerOpen} onOpenChange={setPinnedBannerOpen}>
                    <CollapsibleTrigger asChild>
                      <button className="w-full flex items-center gap-2 text-left">
                        <span className="grid place-items-center size-5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                          <Pin className="size-3" />
                        </span>
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                          {pinnedMessages.length} pinned message{pinnedMessages.length === 1 ? '' : 's'}
                        </span>
                        <ChevronDown className={cn('size-3.5 ml-auto text-muted-foreground transition-transform', pinnedBannerOpen && 'rotate-180')} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-1.5">
                      {pinnedMessages.map((p) => (
                        <div key={p.id} className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
                          <Pin className="size-3 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium truncate">{p.senderName}</p>
                            <p className="text-xs text-foreground line-clamp-2 break-words">{p.body}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(p.createdAt)}</span>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}

              {/* ----- Messages scroll area ----- */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto scroll-thin px-4 sm:px-6 py-4 space-y-1 bg-background min-h-0"
              >
                {messagesQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                        <Skeleton className="h-14 rounded-2xl w-3/5" />
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <EmptyState
                    icon={MessageCircle}
                    title={searchQuery ? 'No matches' : 'No messages yet'}
                    description={searchQuery ? 'Try a different search term.' : 'Send the first message — say hi! 👋'}
                  />
                ) : (
                  <MessageStream
                    messages={messages}
                    currentUserId={user?.id ?? ''}
                    roomType={activeRoom.type}
                    themeCfg={themeCfg}
                    searchQuery={searchQuery}
                    unreadDividerIdx={unreadDividerIdx}
                    isStaffViewer={isStaff}
                    onReply={(m) => { setReplyTo(m); setEditingMsg(null); textareaRef.current?.focus() }}
                    onEdit={(m) => {
                      setEditingMsg({ id: m.id, body: m.body })
                      setReplyTo(null)
                      setDraft(m.body)
                      setTimeout(() => textareaRef.current?.focus(), 0)
                    }}
                    onDelete={(m) => setDeleteMsg({ id: m.id, body: m.body })}
                    onPin={(m) => pinMessage.mutate({ messageId: m.id, pin: !m.isPinned })}
                    onReact={(m, emoji) => reactMessage.mutate({ messageId: m.id, emoji })}
                  />
                )}
              </div>

              {/* ----- Reply preview / attachment preview / edit ----- */}
              {(replyTo || editingMsg || attachment) && (
                <div className="border-t border-border/60 bg-muted/20 px-4 py-2 shrink-0 space-y-2">
                  {replyTo && (
                    <div className="flex items-start gap-2 rounded-r-lg border-l-2 border-primary bg-muted/40 px-3 py-2 text-xs">
                      <ReplyIcon className="size-3.5 mt-0.5 text-primary shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">
                          Replying to {replyTo.senderId === user?.id ? 'yourself' : replyTo.senderName}
                        </p>
                        <p className="text-muted-foreground line-clamp-1 mt-0.5 break-words">{replyTo.body}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 -mt-1 -mr-1 shrink-0"
                        onClick={() => setReplyTo(null)}
                        aria-label="Cancel reply"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )}
                  {editingMsg && (
                    <div className="flex items-start gap-2 rounded-r-lg border-l-2 border-amber-500 bg-amber-500/10 px-3 py-2 text-xs">
                      <Pencil className="size-3.5 mt-0.5 text-amber-600 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">Editing message</p>
                        <p className="text-muted-foreground line-clamp-1 mt-0.5 break-words">{editingMsg.body}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 -mt-1 -mr-1 shrink-0"
                        onClick={() => { setEditingMsg(null); setDraft('') }}
                        aria-label="Cancel edit"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )}
                  {attachment && (
                    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
                      {attachment.isImage ? (
                        <img src={attachment.url} alt={attachment.name} className="size-10 rounded object-cover shrink-0" />
                      ) : (
                        <div className="size-10 rounded bg-muted grid place-items-center shrink-0">
                          <FileText className="size-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{attachment.name}</p>
                        <p className="text-[10px] text-muted-foreground">{attachment.type || 'file'}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0"
                        onClick={() => setAttachment(null)}
                        aria-label="Remove attachment"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ----- Mention picker overlay ----- */}
              {mentionPickerOpen && (
                <MentionPicker
                  query={mentionQuery}
                  onPick={insertMention}
                  onClose={() => { setMentionPickerOpen(false); setMentionStart(null) }}
                />
              )}

              {/* ----- Input bar ----- */}
              <div className="border-t border-border/60 bg-background px-3 pb-4 pt-3 sm:px-4 lg:pb-3 pr-20 lg:pr-4 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
                  className="hidden"
                  onChange={(e) => {
                    handleAttachFile(e.target.files?.[0] ?? null)
                    e.target.value = ''
                  }}
                />
                <div className="flex items-end gap-2">
                  {/* Pill input wrapper */}
                  <div className="flex items-end gap-1 flex-1 bg-muted/60 rounded-2xl px-1.5 py-1">
                    {/* Attach */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-muted-foreground shrink-0 rounded-full"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Attach file"
                    >
                      <Paperclip className="size-5" />
                    </Button>
                    {/* Textarea */}
                    <Textarea
                      ref={textareaRef}
                      value={draft}
                      onChange={(e) => handleDraftChange(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={editingMsg ? 'Edit your message…' : 'Enter Message…'}
                      rows={1}
                      className="min-h-[36px] max-h-32 resize-none bg-transparent border-0 shadow-none focus-visible:ring-0 focus-visible:border-0 px-1 py-1.5 flex-1 text-sm"
                    />
                    {/* Emoji picker */}
                    <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-muted-foreground shrink-0 rounded-full"
                          aria-label="Pick emoji"
                        >
                          <Smile className="size-5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-72 p-2">
                        <p className="text-[11px] font-medium text-muted-foreground px-1 pb-1.5">Frequently used</p>
                        <div className="grid grid-cols-10 gap-0.5">
                          {EMOJI_PICKER_LIST.map((e, i) => (
                            <button
                              key={`${e}-${i}`}
                              onClick={() => insertEmoji(e)}
                              className="size-7 grid place-items-center rounded hover:bg-accent text-base transition-colors"
                              type="button"
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  {/* Send button (outside pill) */}
                  <Button
                    onClick={handleSend}
                    disabled={(!draft.trim() && !attachment) || sendMessage.isPending || editMessage.isPending}
                    className={cn(
                      'size-11 p-0 shrink-0 rounded-xl text-white shadow-sm',
                      'bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700',
                    )}
                    aria-label={editingMsg ? 'Save edit' : 'Send message'}
                  >
                    {editingMsg ? <Check className="size-5" /> : <Send className="size-5" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* ====================================================== MOBILE SIDEBAR SHEET */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[300px] sm:w-[340px] p-0">
          <SheetHeader className="px-3 pt-4 pb-2">
            <SheetTitle className="text-sm">Conversations</SheetTitle>
            <SheetDescription className="sr-only">Rooms and direct messages</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <ChatListSidebar
              rooms={filteredRooms}
              allRooms={rooms}
              dmRooms={dmRooms}
              loading={roomsQuery.isLoading}
              activeRoomId={activeRoomId}
              onSelect={handleSelectRoom}
              search={sidebarSearch}
              onSearch={setSidebarSearch}
              currentUserId={user?.id}
              canCreateRooms={canCreateRooms}
              isStaff={isStaff}
              onNewDM={() => setNewDMOpen(true)}
              onNewRoom={() => setNewRoomOpen(true)}
              onDeleteRoom={(id) => setDeleteRoomId(id)}
              embedded
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ====================================================== DIALOGS */}
      <NewRoomDialog open={newRoomOpen} onClose={() => setNewRoomOpen(false)} onCreated={(id) => {
        setNewRoomOpen(false)
        queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
        handleSelectRoom(id)
      }} />
      <NewDMDialog open={newDMOpen} onClose={() => setNewDMOpen(false)} onCreated={(id) => {
        setNewDMOpen(false)
        queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
        handleSelectRoom(id)
      }} />

      <AlertDialog open={!!deleteRoomId} onOpenChange={(o) => !o && setDeleteRoomId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this room?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the room and all of its messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteRoomId && deleteRoom.mutate(deleteRoomId)}
            >
              Delete room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteMsg} onOpenChange={(o) => !o && setDeleteMsg(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              The message will be soft-deleted and replaced with a tombstone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMsg && deleteMessage.mutate(deleteMsg.id)}
            >
              Delete message
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===========================================================================
// NavRail — slim 64px icon column with brand mark + back-to-app
// ===========================================================================
function NavRail({ onBack }: { onBack: () => void }) {
  return (
    <div className="hidden lg:flex flex-col items-center gap-2 py-3 border-r border-border/60 bg-background shrink-0">
      <button
        onClick={onBack}
        className="size-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-sm hover:shadow-md transition-shadow shrink-0"
        aria-label="Back to dashboard"
        title="Back to app"
      >
        <Home className="size-5" />
      </button>
      <div className="flex-1" />
      <div className="size-10 rounded-xl bg-muted/60 grid place-items-center text-muted-foreground shrink-0" title="Town Hall">
        <MessageSquare className="size-5" />
      </div>
    </div>
  )
}

// ===========================================================================
// ChatListSidebar — Chats header + search + DM stories + Recent list
// ===========================================================================
function ChatListSidebar({
  rooms, allRooms, dmRooms, loading, activeRoomId, onSelect, search, onSearch,
  currentUserId, canCreateRooms, isStaff, onNewDM, onNewRoom, onDeleteRoom, embedded,
}: {
  rooms: Room[]
  allRooms: Room[]
  dmRooms: Room[]
  loading: boolean
  activeRoomId: string | null
  onSelect: (id: string) => void
  search: string
  onSearch: (s: string) => void
  currentUserId?: string
  canCreateRooms: boolean
  isStaff: boolean
  onNewDM: () => void
  onNewRoom: () => void
  onDeleteRoom: (id: string) => void
  embedded?: boolean
}) {
  // Town hall + non-DM rooms go into "Recent"
  const recentRooms = rooms.filter((r) => r.type !== 'direct')
  const filteredDMs = dmRooms.filter((r) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return r.name.toLowerCase().includes(q)
  })

  return (
    <div className={cn('flex flex-col min-h-0', embedded ? 'h-full' : 'flex-1')}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Town Hall</p>
            <h2 className="text-base font-semibold text-foreground leading-tight">Chats</h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={onNewDM} aria-label="New DM">
              <UserIcon className="size-4" />
            </Button>
            {canCreateRooms && isStaff && (
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={onNewRoom} aria-label="New room">
                <Plus className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Search bar — pill */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            className="h-9 pl-9 pr-3 bg-background rounded-full border-border/60"
          />
        </div>
      </div>

      {/* Scrollable room list */}
      <div className="flex-1 overflow-y-auto scroll-thin min-h-0 px-2 pb-3">
        {loading ? (
          <div className="px-2 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : allRooms.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No rooms yet"
            description={search ? 'Try a different search.' : 'Start a DM with another member, or ask a staff member to create a department room.'}
            action={
              <Button size="sm" variant="outline" onClick={onNewDM} className="gap-2">
                <UserIcon className="size-4" /> New DM
              </Button>
            }
          />
        ) : (
          <>
            {/* DM "Stories" row */}
            {filteredDMs.length > 0 && (
              <div className="px-2 mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">Direct</p>
                <div className="flex gap-2.5 overflow-x-auto scroll-thin pb-1">
                  {filteredDMs.map((r) => {
                    const active = r.id === activeRoomId
                    const InitialsAvatar = nameInitials(r.name)
                    return (
                      <button
                        key={r.id}
                        onClick={() => onSelect(r.id)}
                        className="flex flex-col items-center gap-1 shrink-0 group"
                        title={r.name}
                      >
                        <div className="relative">
                          <Avatar className={cn(
                            'size-11 ring-2 ring-offset-2 ring-offset-background transition-all',
                            active ? 'ring-primary' : 'ring-border/40 group-hover:ring-primary/40',
                          )}>
                            <AvatarFallback className="bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs font-semibold">
                              {InitialsAvatar}
                            </AvatarFallback>
                          </Avatar>
                          {/* Online status dot — decorative placeholder for future real-time presence */}
                          <span className="absolute bottom-0 right-0 size-3 rounded-full bg-emerald-500 ring-2 ring-background" />
                        </div>
                        <span className="text-[10px] text-muted-foreground max-w-[48px] truncate">{r.name.split(' ')[0]}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Recent rooms */}
            <div className="px-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1 mt-2">Recent</p>
              {recentRooms.length === 0 && filteredDMs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6 px-2">No rooms match your search.</p>
              ) : recentRooms.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-2 italic">No department or group rooms yet.</p>
              ) : (
                <div className="space-y-0.5">
                  {recentRooms.map((r) => (
                    <RoomListItem
                      key={r.id}
                      room={r}
                      active={r.id === activeRoomId}
                      currentUserId={currentUserId}
                      onSelect={() => onSelect(r.id)}
                      onDelete={() => onDeleteRoom(r.id)}
                      canDelete={isStaff || r.createdBy === currentUserId}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// RoomListItem — single row in the Recent list
// ===========================================================================
function RoomListItem({
  room, active, currentUserId, onSelect, onDelete, canDelete,
}: {
  room: Room
  active: boolean
  currentUserId?: string
  onSelect: () => void
  onDelete: () => void
  canDelete: boolean
}) {
  const isMine = room.lastMessage?.senderId === currentUserId

  return (
    <div className="relative group">
      <button
        onClick={onSelect}
        className={cn(
          'w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-left transition-all',
          active
            ? 'bg-background ring-1 ring-border/60 shadow-sm'
            : 'hover:bg-background/60',
        )}
      >
        {/* Avatar with online dot for DMs */}
        <div className="relative shrink-0">
          {room.type === 'direct' ? (
            <Avatar className="size-10">
              <AvatarFallback className="bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs font-semibold">
                {nameInitials(room.name)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className={cn('size-10 rounded-full grid place-items-center', roomIconWrap(room.type))}>
              {createElement(roomTypeIcon(room.type), { className: 'size-5' })}
            </div>
          )}
          {room.type === 'direct' && (
            // Decorative presence dot — placeholder for future real-time presence.
            <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
          )}
        </div>

        {/* Text column */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={cn('text-sm truncate', active ? 'font-semibold' : 'font-medium')}>{room.name}</p>
            {room.lastMessage && (
              <span className="text-[10px] text-muted-foreground shrink-0 nums">
                {relativeTime(room.lastMessage.createdAt)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">
              {room.lastMessage
                ? (isMine ? 'You: ' : `${room.lastMessage.senderName.split(' ')[0]}: `) + room.lastMessage.body
                : (room.description || 'No messages yet')}
            </p>
            {room.unread > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold nums shrink-0">
                {room.unread > 99 ? '99+' : room.unread}
              </span>
            )}
          </div>
        </div>
      </button>
      {/* Hover delete (staff/owner) */}
      {canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute right-1 top-1/2 -translate-y-1/2 size-7 rounded-md bg-background/95 backdrop-blur border border-border/60 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          aria-label="Delete room"
          title="Delete room"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}

// ===========================================================================
// ChatAreaHeader — chat header with avatar, name, status, action icons
// ===========================================================================
function ChatAreaHeader({
  room, searchOpen, onToggleSearch,
  themeOpen, onThemeOpenChange, theme, onThemeChange, themeCfg,
  onOpenMobileSidebar, canManageRooms, isOwner,
  onPinRoom, onMuteRoom, onCall, onVideoCall, onDeleteRoom,
}: {
  room: NonNullable<RoomDetailResponse['room']>
  searchOpen: boolean
  onToggleSearch: () => void
  themeOpen: boolean
  onThemeOpenChange: (o: boolean) => void
  theme: ChatTheme
  onThemeChange: (t: ChatTheme) => void
  themeCfg: ThemeConfig
  onOpenMobileSidebar: () => void
  canManageRooms: boolean
  isOwner: boolean
  onPinRoom: () => void
  onMuteRoom: () => void
  onCall: () => void
  onVideoCall: () => void
  onDeleteRoom: () => void
}) {
  const canDeleteRoom = canManageRooms || isOwner

  return (
    <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 border-b border-border/60 bg-background shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 lg:hidden shrink-0"
          onClick={onOpenMobileSidebar}
          aria-label="Open rooms"
        >
          <MenuIcon className="size-4" />
        </Button>
        {/* Avatar */}
        <div className="relative shrink-0">
          {room.type === 'direct' ? (
            <Avatar className="size-10">
              <AvatarFallback className="bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs font-semibold">
                {nameInitials(room.name)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className={cn('size-10 rounded-full grid place-items-center', roomIconWrap(room.type))}>
              {createElement(roomTypeIcon(room.type), { className: 'size-5' })}
            </div>
          )}
          {room.type === 'direct' && (
            // Decorative online presence — placeholder for future real-time presence.
            <span className="absolute bottom-0 right-0 size-3 rounded-full bg-emerald-500 ring-2 ring-background" />
          )}
        </div>
        {/* Name + status */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[15px] font-semibold truncate text-foreground">{room.name}</p>
            <Badge variant="outline" className={cn('text-[9px] h-4 px-1.5 gap-0.5 font-medium shrink-0', roomTypeBadgeClass(room.type))}>
              {roomTypeLabel(room.type)}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {room.description || (room.type === 'direct' ? 'Online' : roomTypeLabel(room.type))}
          </p>
        </div>
      </div>

      {/* Action icons */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-8', searchOpen && 'bg-accent')}
          onClick={onToggleSearch}
          aria-label="Search messages"
        >
          <Search className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onCall}
          aria-label="Call"
        >
          <Phone className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onVideoCall}
          aria-label="Video call"
        >
          <Video className="size-4" />
        </Button>
        {/* Theme picker */}
        <Popover open={themeOpen} onOpenChange={onThemeOpenChange}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Chat settings">
              <Settings2 className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <p className="text-xs font-semibold text-foreground mb-0.5">Chat theme</p>
            <p className="text-[11px] text-muted-foreground mb-2">Changes your bubble color (saved on this device).</p>
            <div className="grid grid-cols-1 gap-1.5">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => { onThemeChange(t.value); onThemeOpenChange(false) }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-all hover:shadow-sm',
                    theme === t.value ? 'border-primary ring-1 ring-primary/30 bg-accent/40' : 'border-border/60',
                  )}
                >
                  <div className="flex -space-x-1.5 shrink-0">
                    <span className={cn('size-4 rounded-full ring-2 ring-background', t.dot)} />
                    <span className="size-4 rounded-full bg-muted ring-2 ring-background" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{t.label}</p>
                    <p className="text-[10px] text-muted-foreground">{t.desc}</p>
                  </div>
                  {theme === t.value && <Check className="size-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {/* More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="More actions">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onPinRoom} className="gap-2 text-xs">
              <Pin className="size-3.5" /> Pin room
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMuteRoom} className="gap-2 text-xs">
              <BellOff className="size-3.5" /> Mute notifications
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {canDeleteRoom && (
              <DropdownMenuItem
                onClick={onDeleteRoom}
                className="gap-2 text-xs text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete room
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ===========================================================================
// Message stream — renders day separators, unread divider, bubbles
// ===========================================================================
function MessageStream({
  messages, currentUserId, roomType, themeCfg, searchQuery, unreadDividerIdx,
  isStaffViewer, onReply, onEdit, onDelete, onPin, onReact,
}: {
  messages: ChatMessage[]
  currentUserId: string
  roomType: RoomType
  themeCfg: ThemeConfig
  searchQuery: string
  unreadDividerIdx: number
  isStaffViewer: boolean
  onReply: (m: ChatMessage) => void
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onPin: (m: ChatMessage) => void
  onReact: (m: ChatMessage, emoji: string) => void
}) {
  // Build a lookup map for parent messages (for reply previews above bubbles)
  const parentMap = useMemo(() => {
    const m = new Map<string, ChatMessage>()
    for (const msg of messages) m.set(msg.id, msg)
    return m
  }, [messages])

  // Group by day
  const groups: { day: string; items: ChatMessage[] }[] = []
  let lastDay = ''
  for (const m of messages) {
    const dl = dayLabel(new Date(m.createdAt))
    if (dl !== lastDay) {
      groups.push({ day: dl, items: [m] })
      lastDay = dl
    } else {
      groups[groups.length - 1].items.push(m)
    }
  }

  let runningIdx = -1

  return (
    <div className="space-y-3">
      {groups.map((grp, gi) => (
        <div key={gi} className="space-y-2">
          <div className="flex items-center justify-center my-2">
            <span className="text-[11px] font-medium text-muted-foreground bg-muted/60 rounded-full px-3 py-1">
              {grp.day}
            </span>
          </div>
          {grp.items.map((m, idx) => {
            runningIdx += 1
            const mine = m.senderId === currentUserId
            const prev = idx > 0 ? grp.items[idx - 1] : null
            const showSenderInfo = !prev
              || prev.senderId !== m.senderId
              || (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) > 5 * 60_000
            const showUnreadDivider = runningIdx === unreadDividerIdx
            const parent = m.parentId ? parentMap.get(m.parentId) : null
            return (
              <div key={m.id} data-msg-id={m.id}>
                {showUnreadDivider && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="h-px bg-primary/40 flex-1" />
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 rounded-full px-3 py-1">
                      <span className="size-1.5 rounded-full bg-primary" />
                      New messages
                    </span>
                    <div className="h-px bg-primary/40 flex-1" />
                  </div>
                )}
                <MessageBubble
                  message={m}
                  mine={mine}
                  showSenderInfo={showSenderInfo}
                  showAvatar={roomType !== 'direct'}
                  parent={parent}
                  themeCfg={themeCfg}
                  searchQuery={searchQuery}
                  currentUserId={currentUserId}
                  isStaffViewer={isStaffViewer}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onPin={onPin}
                  onReact={onReact}
                />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ===========================================================================
// Message bubble — with reactions, replies, attachments, actions menu
// ===========================================================================
function MessageBubble({
  message, mine, showSenderInfo, showAvatar, parent, themeCfg, searchQuery, currentUserId,
  isStaffViewer, onReply, onEdit, onDelete, onPin, onReact,
}: {
  message: ChatMessage
  mine: boolean
  showSenderInfo: boolean
  showAvatar: boolean
  parent: ChatMessage | null
  themeCfg: ThemeConfig
  searchQuery: string
  currentUserId: string
  isStaffViewer: boolean
  onReply: (m: ChatMessage) => void
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onPin: (m: ChatMessage) => void
  onReact: (m: ChatMessage, emoji: string) => void
}) {
  const [showAllReplies, setShowAllReplies] = useState(false)
  const replies = message.replies ?? []
  const visibleReplies = showAllReplies ? replies : replies.slice(0, 2)
  const hiddenCount = replies.length - visibleReplies.length

  const deleted = isDeletedBody(message.body)
  const edited = !!message.editedAt && !deleted
  const canEdit = mine && within5Min(message.createdAt) && !deleted
  const canDelete = mine || isStaffViewer
  const canPin = mine || isStaffViewer

  const reactionEntries = Object.entries(message.reactions ?? {})

  return (
    <div className={cn('flex gap-2 group/msg', mine ? 'flex-row-reverse' : 'flex-row')}>
      {showAvatar && !mine && (
        <div className="w-8 shrink-0">
          {showSenderInfo && (
            <Avatar className="size-8 mt-0.5">
              <AvatarImage src={undefined} alt={message.senderName} />
              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                {nameInitials(message.senderName)}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      )}
      <div className={cn('flex flex-col max-w-[78%] sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
        {showSenderInfo && !mine && showAvatar && (
          <span className="text-[12px] font-medium text-muted-foreground mb-1 px-1">{message.senderName}</span>
        )}

        {/* Hover actions button (vertical ellipsis) */}
        <div className={cn('relative flex items-end gap-1', mine ? 'flex-row-reverse' : 'flex-row')}>
          {!deleted && (
            <div className={cn(
              'opacity-0 group-hover/msg:opacity-100 transition-opacity self-center',
              mine ? 'order-2' : 'order-2',
            )}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="size-6 rounded-full bg-background/90 backdrop-blur border border-border/60 grid place-items-center shadow-sm hover:bg-accent transition-colors"
                    aria-label="Message actions"
                  >
                    <MoreVertical className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={mine ? 'start' : 'end'} className="w-44">
                  <DropdownMenuItem onClick={() => onReply(message)} className="gap-2 text-xs">
                    <ReplyIcon className="size-3.5" /> Reply
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2 text-xs">
                      <Smile className="size-3.5" /> React
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-auto p-1.5">
                      <div className="grid grid-cols-4 gap-0.5">
                        {REACTION_EMOJIS.map((e) => (
                          <button
                            key={e}
                            onClick={() => onReact(message, e)}
                            className="size-8 grid place-items-center rounded hover:bg-accent text-base transition-colors"
                            type="button"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {canEdit && (
                    <DropdownMenuItem onClick={() => onEdit(message)} className="gap-2 text-xs">
                      <Pencil className="size-3.5" /> Edit
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onPin(message)} className="gap-2 text-xs">
                    {message.isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    {message.isPinned ? 'Unpin' : 'Pin'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => onDelete(message)}
                      className="gap-2 text-xs text-destructive focus:text-destructive"
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Bubble */}
          <div className="relative">
            {/* Reply preview above bubble */}
            {parent && !deleted && (
              <div className={cn(
                'rounded-r-md px-2 py-1 mb-0.5 text-[11px] bg-muted/40 border-l-2 border-primary',
                mine ? 'ml-auto w-fit' : 'w-fit',
              )}>
                <p className="font-medium text-primary">
                  {parent.senderId === currentUserId ? 'You' : parent.senderName.split(' ')[0]}
                </p>
                <p className="text-muted-foreground line-clamp-1 break-words max-w-[260px]">
                  {isDeletedBody(parent.body) ? '🗑️ This message was deleted' : parent.body}
                </p>
              </div>
            )}

            <div className={cn(
              'rounded-2xl border px-3.5 py-2 text-sm relative max-w-full',
              mine ? themeCfg.mine : themeCfg.others,
              deleted && 'italic opacity-70',
            )}>
              {/* Attachment */}
              {message.attachmentUrl && !deleted && (
                message.attachmentType && isImageAttachment(message.attachmentType) ? (
                  <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="block mb-1.5">
                    <img
                      src={message.attachmentUrl}
                      alt={message.attachmentName ?? 'image'}
                      className="rounded-lg max-w-[280px] max-h-[280px] object-cover"
                    />
                  </a>
                ) : (
                  <a
                    href={message.attachmentUrl}
                    download={message.attachmentName ?? 'file'}
                    className={cn(
                      'flex items-center gap-2 mb-1.5 rounded-lg border px-2 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 transition-colors',
                      mine ? 'border-white/20 bg-white/10' : 'border-border/60 bg-background',
                    )}
                  >
                    <div className={cn('size-8 rounded grid place-items-center shrink-0', mine ? 'bg-white/15' : 'bg-muted')}>
                      <FileText className={cn('size-4', mine ? 'text-white' : 'text-muted-foreground')} />
                    </div>
                    <div className="min-w-0">
                      <p className={cn('font-medium truncate', mine ? 'text-white' : 'text-foreground')}>
                        {message.attachmentName ?? 'File'}
                      </p>
                      <p className={cn('text-[10px] truncate', mine ? 'text-white/70' : 'text-muted-foreground')}>
                        {message.attachmentType || 'file'}
                      </p>
                    </div>
                    <Download className={cn('size-3.5 shrink-0', mine ? 'text-white/70' : 'text-muted-foreground')} />
                  </a>
                )
              )}
              {/* Deleted body */}
              {deleted ? (
                <div className="flex items-center gap-1.5 italic text-[13px]">
                  <Trash2 className="size-3.5" />
                  <span>This message was deleted</span>
                </div>
              ) : message.body ? (
                <div className="whitespace-pre-wrap break-words leading-relaxed">
                  {renderBody(message.body, searchQuery)}
                </div>
              ) : null}
              {/* Timestamp + read receipts */}
              <div className={cn('flex items-center gap-1 mt-1', mine ? 'justify-end' : 'justify-start')}>
                {edited && (
                  <span className={cn('text-[10px] italic', mine ? 'text-white/70' : 'text-muted-foreground')}>
                    edited
                  </span>
                )}
                <span className={cn('text-[10px] nums', mine ? 'text-white/70' : 'text-muted-foreground')}>
                  {formatTime(message.createdAt)}
                </span>
                {mine && !deleted && (
                  message.readBy > 0 ? (
                    <span title={`Read by ${message.readBy}`} className="inline-flex items-center">
                      <CheckCheck className={cn('size-3', mine ? 'text-white/90' : 'text-primary')} />
                    </span>
                  ) : (
                    <Check className={cn('size-3', mine ? 'text-white/60' : 'text-muted-foreground')} />
                  )
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Reaction chips */}
        {reactionEntries.length > 0 && (
          <div className={cn('flex flex-wrap gap-1 mt-1', mine ? 'justify-end' : 'justify-start')}>
            {reactionEntries.map(([emoji, info]) => {
              const reacted = info.userIds.includes(currentUserId)
              return (
                <button
                  key={emoji}
                  onClick={() => onReact(message, emoji)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors',
                    reacted
                      ? 'bg-primary/15 border-primary/30 text-primary'
                      : mine
                        ? 'bg-background/90 border-border/60 text-muted-foreground hover:bg-background'
                        : 'bg-background border-border/60 text-muted-foreground hover:bg-accent',
                  )}
                  title={info.userIds.length === 1 && reacted ? 'You reacted' : `${info.count} reaction${info.count === 1 ? '' : 's'}`}
                >
                  <span className="text-xs">{emoji}</span>
                  <span className="nums">{info.count}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Threaded replies */}
        {replies.length > 0 && (
          <div className={cn('mt-1.5 w-full space-y-1', mine ? 'items-end' : 'items-start')}>
            {visibleReplies.map((r) => {
              const rMine = r.isOwn ?? r.senderId === currentUserId
              const rDeleted = isDeletedBody(r.body)
              const rEdited = !!r.editedAt && !rDeleted
              return (
                <div key={r.id} className={cn('flex', rMine ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'rounded-xl border px-3 py-1.5 text-xs max-w-[80%] break-words',
                    rMine ? themeCfg.mine : themeCfg.others,
                    rDeleted && 'italic opacity-70',
                  )}>
                    {!rMine && (
                      <p className="text-[10px] font-medium mb-0.5 opacity-80">{r.senderName}</p>
                    )}
                    {rDeleted ? (
                      <div className="flex items-center gap-1.5 italic text-[11px]">
                        <Trash2 className="size-3" /> This message was deleted
                      </div>
                    ) : r.body ? (
                      <div className="whitespace-pre-wrap break-words">{renderBody(r.body, searchQuery)}</div>
                    ) : null}
                    <div className={cn('flex items-center gap-1 mt-0.5', rMine ? 'justify-end' : 'justify-start')}>
                      {rEdited && (
                        <span className={cn('text-[9px] italic', rMine ? 'text-white/70' : 'text-muted-foreground')}>
                          edited
                        </span>
                      )}
                      <span className={cn('text-[9px] nums', rMine ? 'text-white/70' : 'text-muted-foreground')}>
                        {formatTime(r.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
            {hiddenCount > 0 ? (
              <button
                onClick={() => setShowAllReplies(true)}
                className="text-[11px] text-primary hover:underline font-medium flex items-center gap-1"
              >
                View {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
              </button>
            ) : null}
            {replies.length > 2 && showAllReplies ? (
              <button
                onClick={() => setShowAllReplies(false)}
                className="text-[11px] text-muted-foreground hover:underline"
              >
                Show fewer
              </button>
            ) : null}
          </div>
        )}

        {/* Reply count chip when replies exist but no parent */}
        {replies.length > 0 && !parent && (
          <button
            onClick={() => setShowAllReplies((v) => !v)}
            className="text-[11px] text-primary hover:underline font-medium mt-1"
          >
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// Mention picker overlay
// ===========================================================================
function MentionPicker({
  query, onPick, onClose,
}: {
  query: string
  onPick: (m: MemberLite) => void
  onClose: () => void
}) {
  const { user } = useAuth()
  const [search, setSearch] = useState(query)
  useEffect(() => {
    void Promise.resolve().then(() => setSearch(query))
  }, [query])

  const membersQuery = useQuery<{ items: MemberLite[] }>({
    queryKey: ['townhall-mention-search', search],
    queryFn: async () => {
      const res = await fetch(`/api/members?q=${encodeURIComponent(search)}&pageSize=20`)
      if (!res.ok) throw new Error('Failed to load members')
      return res.json()
    },
    enabled: true,
  })
  const items = membersQuery.data?.items ?? []

  return (
    <div className="px-3 sm:px-4 pt-2 border-t border-border/60 bg-background shrink-0">
      <div className="rounded-xl border border-border/60 bg-popover shadow-premium overflow-hidden max-w-md">
        <div className="px-3 py-2 border-b border-border/60 bg-muted/30 flex items-center gap-2">
          <AtSign className="size-4 text-muted-foreground shrink-0" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members to mention…"
            className="h-7 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={onClose} aria-label="Close">
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="max-h-56 overflow-y-auto scroll-thin">
          {membersQuery.isLoading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-md" />)}
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No members found.</p>
          ) : (
            items.map((m) => (
              <button
                key={m.id}
                onClick={() => onPick(m)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/60 transition-colors"
              >
                <Avatar className="size-6 shrink-0">
                  <AvatarImage src={m.photoUrl ?? undefined} alt={m.firstName} />
                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                    {initials(m.firstName, m.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{m.firstName} {m.lastName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{m.memberId ?? '—'}</p>
                </div>
                {user?.memberId === m.id && <Badge variant="outline" className="text-[9px] h-4 px-1.5">You</Badge>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// New Room dialog (staff only)
// ===========================================================================
function NewRoomDialog({
  open, onClose, onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'department' | 'role' | 'group'>('group')
  const [refId, setRefId] = useState<string>('')

  const departmentsQuery = useQuery<{ items: DeptLite[] }>({
    queryKey: ['townhall-depts'],
    queryFn: async () => {
      const res = await fetch('/api/departments')
      if (!res.ok) throw new Error('Failed to load departments')
      return res.json()
    },
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { name, type, description }
      if (type === 'department' || type === 'role') payload.refId = refId
      const res = await fetch('/api/townhall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to create room')
      }
      return res.json() as Promise<{ id: string }>
    },
    onSuccess: (data) => {
      toast.success('Room created')
      queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
      setName('')
      setDescription('')
      setType('group')
      setRefId('')
      onCreated(data.id)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-4" /> Create room</DialogTitle>
          <DialogDescription>Department, role, or open group chat rooms.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rm-name" className="text-sm font-medium">Room name</Label>
            <Input id="rm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Media Team Chat" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rm-desc" className="text-sm font-medium">Description</Label>
            <Input id="rm-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Room type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="group">Group (open to everyone)</SelectItem>
                <SelectItem value="department">Department (members of a department)</SelectItem>
                <SelectItem value="role">Role (users with a specific role)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === 'department' && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Department</Label>
              <Select value={refId} onValueChange={setRefId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departmentsQuery.data?.items.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === 'role' && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Role</Label>
              <Select value={refId} onValueChange={setRefId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Members</SelectItem>
                  <SelectItem value="department_head">Department Heads</SelectItem>
                  <SelectItem value="unit_leader">Unit Leaders</SelectItem>
                  <SelectItem value="pastor">Pastors</SelectItem>
                  <SelectItem value="finance_officer">Finance Officers</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || ((type === 'department' || type === 'role') && !refId) || createMutation.isPending}
          >
            Create room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// New DM dialog (any role)
// ===========================================================================
function NewDMDialog({
  open, onClose, onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const membersQuery = useQuery<{ items: MemberLite[] }>({
    queryKey: ['townhall-dm-search', search],
    queryFn: async () => {
      const res = await fetch(`/api/members?q=${encodeURIComponent(search)}&pageSize=30`)
      if (!res.ok) throw new Error('Failed to load members')
      return res.json()
    },
    enabled: open,
  })

  const createDM = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await fetch('/api/townhall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'direct', recipientMemberId: memberId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Failed to start DM')
      }
      return res.json() as Promise<{ id: string }>
    },
    onSuccess: (data) => onCreated(data.id),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserIcon className="size-4" /> New direct message</DialogTitle>
          <DialogDescription>Pick a member to start a private 1-on-1 chat. They must have a linked account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members by name or ID…"
              className="h-9 pl-8"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto scroll-thin rounded-xl border border-border/60">
            {membersQuery.isLoading ? (
              <div className="p-2 space-y-1">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}
              </div>
            ) : (membersQuery.data?.items ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No members found.</p>
            ) : (
              membersQuery.data?.items.map((m) => (
                <button
                  key={m.id}
                  onClick={() => createDM.mutate(m.id)}
                  disabled={createDM.isPending}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent/60 transition-colors disabled:opacity-50 border-b border-border/40 last:border-0"
                >
                  <Avatar className="size-9 shrink-0">
                    <AvatarImage src={m.photoUrl ?? undefined} alt={m.firstName} />
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {initials(m.firstName, m.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{m.firstName} {m.lastName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{m.memberId ?? '—'}{m.status ? ` · ${m.status}` : ''}</p>
                  </div>
                  <MessageCircle className="size-4 text-muted-foreground shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
