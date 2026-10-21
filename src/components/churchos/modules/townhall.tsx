'use client'

// ChurchOS — Town Hall module
// Premium WhatsApp-style chat with: rooms list, bubble chat, threaded replies,
// @mentions, 4 chat themes (Default/Ocean/Sunset/Forest), member DM picker, polling.
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { relativeTime, formatDate, initials } from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
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
  MessageSquare, Send, Plus, Search, Settings2, ArrowLeft, Reply, Trash2,
  Hash, Users, Megaphone, User as UserIcon, X, AtSign, Smile, MoreVertical,
  CheckCheck, CircleDot, MessageCircle,
} from 'lucide-react'
import { PageHeader, EmptyState, SectionCard } from '@/components/churchos/ui'
import { cn } from '@/lib/utils'

// ---------- types ----------
interface Room {
  id: string
  name: string
  description?: string | null
  type: 'townhall' | 'department' | 'role' | 'group' | 'direct'
  refId?: string | null
  createdBy?: string | null
  createdAt: string
  updatedAt: string
  lastMessage?: {
    id: string
    body: string
    senderName: string
    senderId: string
    createdAt: string
  } | null
  unread: number
}
interface Reply {
  id: string
  senderId: string
  senderName: string
  body: string
  createdAt: string
}
interface Message {
  id: string
  roomId: string
  senderId: string
  senderName: string
  body: string
  parentId?: string | null
  createdAt: string
  replies: Reply[]
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

// ---------- themes ----------
type ChatTheme = 'default' | 'ocean' | 'sunset' | 'forest'
const THEMES: { value: ChatTheme; label: string; mine: string; others: string }[] = [
  { value: 'default', label: 'Default', mine: 'bg-emerald-500/15 border-emerald-500/20 rounded-br-sm', others: 'bg-muted rounded-bl-sm' },
  { value: 'ocean', label: 'Ocean', mine: 'bg-blue-500/15 border-blue-500/20 rounded-br-sm', others: 'bg-muted rounded-bl-sm' },
  { value: 'sunset', label: 'Sunset', mine: 'bg-orange-500/15 border-orange-500/20 rounded-br-sm', others: 'bg-muted rounded-bl-sm' },
  { value: 'forest', label: 'Forest', mine: 'bg-teal-500/15 border-teal-500/20 rounded-br-sm', others: 'bg-muted rounded-bl-sm' },
]

function useChatTheme(): [ChatTheme, (t: ChatTheme) => void] {
  const [theme, setTheme] = useState<ChatTheme>(() => {
    if (typeof localStorage === 'undefined') return 'default'
    const saved = (localStorage.getItem('churchos:chat-theme')) as ChatTheme | null
    return saved && THEMES.some((t) => t.value === saved) ? saved : 'default'
  })
  const setter = useCallback((t: ChatTheme) => {
    setTheme(t)
    try { localStorage.setItem('churchos:chat-theme', t) } catch {}
  }, [])
  return [theme, setter]
}

// ---------- helpers ----------
const STAFF_ROLES = new Set([
  'super_admin', 'church_admin', 'pastor', 'department_head', 'unit_leader',
])

function roomTypeIcon(type: Room['type']) {
  switch (type) {
    case 'townhall': return Megaphone
    case 'department': return Hash
    case 'role': return Users
    case 'group': return MessageCircle
    case 'direct': return UserIcon
    default: return MessageSquare
  }
}

function roomTypeLabel(type: Room['type']) {
  switch (type) {
    case 'townhall': return 'Town Hall'
    case 'department': return 'Department'
    case 'role': return 'Role'
    case 'group': return 'Group'
    case 'direct': return 'Direct'
    default: return type
  }
}

function formatTime(date: string | Date) {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(d)
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function dayLabel(date: Date) {
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(date, today)) return 'Today'
  if (isSameDay(date, yesterday)) return 'Yesterday'
  return formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function renderMentions(body: string) {
  // Split on @FirstName LastName patterns and highlight
  const parts = body.split(/(@[A-Za-z][A-Za-z'-]+(?:\s[A-Za-z][A-Za-z'-]+)?)/g)
  return parts.map((p, i) => {
    if (p.startsWith('@') && p.length > 1) {
      return <span key={i} className="font-semibold text-indigo-600 dark:text-indigo-400">{p}</span>
    }
    return <span key={i}>{p}</span>
  })
}

// ---------- main module ----------
export default function TownHallModule() {
  const { user } = useAuth()
  const role = user?.role ?? 'member'
  const isStaff = STAFF_ROLES.has(role)
  const canManage = can(role, 'townhall', 'manage') || can(role, 'townhall', 'delete')

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [mobilePane, setMobilePane] = useState<'list' | 'chat'>('list')
  const [theme, setTheme] = useChatTheme()
  const [themeOpen, setThemeOpen] = useState(false)
  const [newRoomOpen, setNewRoomOpen] = useState(false)
  const [newDMOpen, setNewDMOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [draft, setDraft] = useState('')
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const queryClient = useQueryClient()

  // Rooms list — poll every 10s
  const roomsQuery = useQuery<{ rooms: Room[] }>({
    queryKey: ['townhall-rooms'],
    queryFn: async () => {
      const res = await fetch('/api/townhall')
      if (!res.ok) throw new Error('Failed to load rooms')
      return res.json()
    },
    refetchInterval: 10_000,
  })

  // Auto-select first room on initial load (if any) — deferred to avoid sync setState in effect.
  useEffect(() => {
    if (!activeRoomId && roomsQuery.data?.rooms?.length) {
      void Promise.resolve().then(() => {
        const first = roomsQuery.data?.rooms?.[0]
        if (first) {
          setActiveRoomId(first.id)
          setMobilePane('chat')
        }
      })
    }
  }, [roomsQuery.data, activeRoomId])

  // Active room + messages — poll every 5s
  const messagesQuery = useQuery<{ room: Room; messages: Message[] }>({
    queryKey: ['townhall-messages', activeRoomId],
    queryFn: async () => {
      if (!activeRoomId) return { room: null as any, messages: [] as Message[] }
      const res = await fetch(`/api/townhall/${activeRoomId}`)
      if (!res.ok) throw new Error('Failed to load messages')
      return res.json()
    },
    enabled: !!activeRoomId,
    refetchInterval: 5_000,
  })

  // Send message
  const sendMessage = useMutation({
    mutationFn: async (vars: { body: string; parentId?: string | null }) => {
      const res = await fetch(`/api/townhall/${activeRoomId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: vars.body, parentId: vars.parentId ?? null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to send message')
      }
      return res.json()
    },
    onSuccess: () => {
      setDraft('')
      setReplyTo(null)
      setMentionPickerOpen(false)
      queryClient.invalidateQueries({ queryKey: ['townhall-messages', activeRoomId] })
      queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRoom = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await fetch(`/api/townhall/${roomId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete room')
      }
      return res.json()
    },
    onSuccess: (_data, roomId) => {
      toast.success('Room deleted')
      if (activeRoomId === roomId) {
        setActiveRoomId(null)
        setMobilePane('list')
      }
      queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messagesQuery.data, activeRoomId])

  // Mention picker — detect @typing
  const handleDraftChange = (val: string) => {
    setDraft(val)
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    // Look backwards from cursor for @token start
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
    const after = draft.slice(textareaRef.current?.selectionStart ?? mentionStart + 1)
    const insert = `@${name} `
    const next = before + insert + after
    setDraft(next)
    setMentionPickerOpen(false)
    setMentionStart(null)
    // Refocus after picker closes
    setTimeout(() => {
      const el = textareaRef.current
      if (!el) return
      const caret = (before + insert).length
      el.focus()
      el.setSelectionRange(caret, caret)
    }, 0)
  }

  const handleSend = () => {
    const text = draft.trim()
    if (!text || !activeRoomId) return
    sendMessage.mutate({ body: text, parentId: replyTo?.id })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const rooms = roomsQuery.data?.rooms ?? []
  const activeRoom = messagesQuery.data?.room
  const messages = messagesQuery.data?.messages ?? []
  const themeCls = THEMES.find((t) => t.value === theme) ?? THEMES[0]

  // Render grouped messages by date + consecutive sender
  const grouped: { day: string; items: Message[] }[] = []
  let lastDay = ''
  for (const m of messages) {
    const dl = dayLabel(new Date(m.createdAt))
    if (dl !== lastDay) {
      grouped.push({ day: dl, items: [m] })
      lastDay = dl
    } else {
      grouped[grouped.length - 1].items.push(m)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Town Hall"
        eyebrow="Community"
        description="Chat with your church community — department, role, group and direct rooms."
        icon={MessageSquare}
        actions={
          <>
            <Button variant="outline" onClick={() => setNewDMOpen(true)} className="gap-2">
              <UserIcon className="size-4" /> New DM
            </Button>
            {isStaff && (
              <Button onClick={() => setNewRoomOpen(true)} className="gap-2">
                <Plus className="size-4" /> New Room
              </Button>
            )}
          </>
        }
      />

      <Card className="border-border/60 overflow-hidden">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] h-[calc(100vh-260px)] min-h-[560px]">
            {/* Sidebar: room list */}
            <div className={cn(
              'flex flex-col border-r border-border/60 bg-card/30',
              mobilePane === 'chat' ? 'hidden lg:flex' : 'flex',
            )}>
              <div className="p-3 border-b border-border/60">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search rooms…"
                    className="h-9 pl-8 bg-background"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scroll-thin">
                {roomsQuery.isLoading ? (
                  <div className="p-3 space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
                  </div>
                ) : rooms.length === 0 ? (
                  <EmptyState
                    icon={MessageSquare}
                    title="No rooms yet"
                    description="Start a DM with another member, or ask a staff member to create a department room."
                  />
                ) : (
                  <div className="py-1">
                    {rooms.map((r) => {
                      const Icon = roomTypeIcon(r.type)
                      const active = r.id === activeRoomId
                      return (
                        <button
                          key={r.id}
                          onClick={() => { setActiveRoomId(r.id); setMobilePane('chat') }}
                          className={cn(
                            'w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/40 border-l-2',
                            active ? 'bg-accent/60 border-l-primary' : 'border-l-transparent',
                          )}
                        >
                          <div className={cn(
                            'size-9 rounded-lg grid place-items-center shrink-0',
                            r.type === 'townhall' ? 'bg-primary/10 text-primary' :
                            r.type === 'direct' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' :
                            r.type === 'department' ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400' :
                            r.type === 'role' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                            'bg-muted text-muted-foreground',
                          )}>
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium truncate">{r.name}</p>
                              {r.lastMessage && (
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {formatTime(r.lastMessage.createdAt)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {r.lastMessage
                                ? (r.lastMessage.senderId === user?.id ? 'You: ' : `${r.lastMessage.senderName.split(' ')[0]}: `) + r.lastMessage.body
                                : (r.description || 'No messages yet')}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge variant="outline" className="text-[9px] h-4 px-1.5 gap-0.5 font-medium">
                                {roomTypeLabel(r.type)}
                              </Badge>
                              {r.unread > 0 && (
                                <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold nums">
                                  {r.unread > 99 ? '99+' : r.unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Chat area */}
            <div className={cn(
              'flex flex-col bg-background',
              mobilePane === 'list' ? 'hidden lg:flex' : 'flex',
            )}>
              {!activeRoomId || !activeRoom ? (
                <div className="flex-1 grid place-items-center">
                  <EmptyState
                    icon={MessageCircle}
                    title="Select a room"
                    description="Pick a conversation from the list, or start a new DM."
                    action={
                      <Button variant="outline" onClick={() => setNewDMOpen(true)} className="gap-2">
                        <UserIcon className="size-4" /> New DM
                      </Button>
                    }
                  />
                </div>
              ) : (
                <>
                  {/* Room header */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-card/40">
                    <div className="flex items-center gap-3 min-w-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 lg:hidden"
                        onClick={() => setMobilePane('list')}
                        aria-label="Back to rooms"
                      >
                        <ArrowLeft className="size-4" />
                      </Button>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{activeRoom.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {roomTypeLabel(activeRoom.type)}{activeRoom.description ? ` · ${activeRoom.description}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Theme selector */}
                      <Popover open={themeOpen} onOpenChange={setThemeOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Chat theme">
                            <Settings2 className="size-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-56 p-2">
                          <p className="text-xs font-medium text-muted-foreground px-2 mb-1.5">Chat theme</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {THEMES.map((t) => (
                              <button
                                key={t.value}
                                onClick={() => { setTheme(t.value); setThemeOpen(false) }}
                                className={cn(
                                  'rounded-lg border p-2 text-left transition-all hover:shadow-premium',
                                  theme === t.value ? 'border-primary ring-1 ring-primary/30' : 'border-border/60',
                                )}
                              >
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className={cn('size-3 rounded-full', t.mine.split(' ')[0])} />
                                  <span className={cn('size-3 rounded-full bg-muted')} />
                                </div>
                                <p className="text-xs font-medium">{t.label}</p>
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      {(canManage || activeRoom.createdBy === user?.id) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete "${activeRoom.name}"? This removes all messages.`)) {
                              deleteRoom.mutate(activeRoom.id)
                            }
                          }}
                          aria-label="Delete room"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Messages */}
                  <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-4 space-y-1">
                    {messagesQuery.isLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-2xl max-w-md" />)}
                      </div>
                    ) : messages.length === 0 ? (
                      <EmptyState
                        icon={MessageCircle}
                        title="No messages yet"
                        description="Send the first message in this room."
                      />
                    ) : (
                      grouped.map((grp, gi) => (
                        <div key={gi} className="space-y-1">
                          {/* Date separator */}
                          <div className="flex items-center justify-center my-3">
                            <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground bg-muted/60 rounded-full px-2.5 py-1">
                              {grp.day}
                            </span>
                          </div>
                          {grp.items.map((m, idx) => {
                            const mine = m.senderId === user?.id
                            const prev = idx > 0 ? grp.items[idx - 1] : null
                            const showSenderInfo = !prev || prev.senderId !== m.senderId || (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) > 5 * 60_000
                            return (
                              <MessageBubble
                                key={m.id}
                                message={m}
                                mine={mine}
                                showSenderInfo={showSenderInfo}
                                showAvatar={activeRoom.type !== 'direct'}
                                themeMine={themeCls.mine}
                                themeOthers={themeCls.others}
                                onReply={() => setReplyTo(m)}
                              />
                            )
                          })}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Reply preview + mention picker + input */}
                  <div className="border-t border-border/60 bg-card/40">
                    {replyTo && (
                      <div className="px-4 pt-3">
                        <div className="flex items-start gap-2 rounded-lg border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs">
                          <Reply className="size-3.5 mt-0.5 text-primary shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground">
                              Replying to {replyTo.senderId === user?.id ? 'yourself' : replyTo.senderName}
                            </p>
                            <p className="text-muted-foreground line-clamp-2 mt-0.5">{replyTo.body}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 -mt-1 -mr-1"
                            onClick={() => setReplyTo(null)}
                            aria-label="Cancel reply"
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {mentionPickerOpen && (
                      <MentionPicker
                        query={mentionQuery}
                        onPick={insertMention}
                        onClose={() => setMentionPickerOpen(false)}
                      />
                    )}
                    <div className="p-3 flex items-end gap-2">
                      <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label="Mention" onClick={() => {
                        const el = textareaRef.current
                        if (!el) return
                        const pos = el.selectionStart
                        const next = draft.slice(0, pos) + '@' + draft.slice(pos)
                        setDraft(next)
                        setMentionStart(pos)
                        setMentionQuery('')
                        setMentionPickerOpen(true)
                        el.focus()
                      }}>
                        <AtSign className="size-5" />
                      </Button>
                      <Textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={(e) => handleDraftChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`Message ${activeRoom.name}…`}
                        rows={1}
                        className="min-h-[40px] max-h-[160px] resize-none bg-background border-border/60"
                      />
                      <Button onClick={handleSend} disabled={!draft.trim() || sendMessage.isPending} className="gap-2 size-9 p-0">
                        <Send className="size-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* New Room dialog (staff only) */}
      <NewRoomDialog open={newRoomOpen} onClose={() => setNewRoomOpen(false)} />
      {/* New DM dialog (any role) */}
      <NewDMDialog open={newDMOpen} onClose={() => setNewDMOpen(false)} onCreated={(roomId) => {
        setNewDMOpen(false)
        queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
        setActiveRoomId(roomId)
        setMobilePane('chat')
      }} />
    </div>
  )
}

// ---------- message bubble with thread ----------
function MessageBubble({
  message, mine, showSenderInfo, showAvatar, themeMine, themeOthers, onReply,
}: {
  message: Message
  mine: boolean
  showSenderInfo: boolean
  showAvatar: boolean
  themeMine: string
  themeOthers: string
  onReply: () => void
}) {
  const [showAllReplies, setShowAllReplies] = useState(false)
  const replies = message.replies ?? []
  const visibleReplies = showAllReplies ? replies : replies.slice(0, 2)
  const hiddenCount = replies.length - visibleReplies.length

  return (
    <div className={cn('flex gap-2 group', mine ? 'flex-row-reverse' : 'flex-row')}>
      {showAvatar && !mine && showSenderInfo && (
        <Avatar className="size-8 mt-0.5 shrink-0">
          <AvatarImage src={message.senderId ? undefined : undefined} alt={message.senderName} />
          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
            {initials(message.senderName.split(' ')[0], message.senderName.split(' ')[1])}
          </AvatarFallback>
        </Avatar>
      )}
      {showAvatar && !mine && !showSenderInfo && <div className="w-8 shrink-0" />}
      <div className={cn('flex flex-col max-w-[78%] sm:max-w-[68%]', mine ? 'items-end' : 'items-start')}>
        {showSenderInfo && !mine && showAvatar && (
          <span className="text-[11px] font-medium text-muted-foreground mb-1 px-1">{message.senderName}</span>
        )}
        <div className={cn(
          'rounded-2xl border px-3.5 py-2 text-sm relative',
          mine ? themeMine : themeOthers,
        )}>
          <div className="whitespace-pre-wrap break-words leading-relaxed">{renderMentions(message.body)}</div>
          <div className={cn('flex items-center gap-1 mt-1', mine ? 'justify-end' : 'justify-start')}>
            <span className="text-[9px] text-muted-foreground nums">
              {formatTime(message.createdAt)}
            </span>
            {mine && <CheckCheck className="size-3 text-muted-foreground" />}
          </div>
          {/* Reply button — appears on hover */}
          <button
            onClick={onReply}
            className="absolute -top-2.5 opacity-0 group-hover:opacity-100 transition-opacity bg-background border border-border/60 rounded-full size-6 grid place-items-center shadow-premium hover:bg-accent"
            style={mine ? { left: '-10px' } : { right: '-10px' }}
            aria-label="Reply"
          >
            <Reply className="size-3" />
          </button>
        </div>

        {/* Threaded replies */}
        {replies.length > 0 && (
          <div className={cn('mt-1.5 w-full space-y-1', mine ? 'items-end' : 'items-start')}>
            {visibleReplies.map((r) => {
              const rMine = r.senderId === message.senderId && mine
              return (
                <div key={r.id} className={cn('flex', rMine ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'rounded-xl border px-3 py-1.5 text-xs max-w-[80%]',
                    rMine ? themeMine : themeOthers,
                  )}>
                    {!rMine && (
                      <p className="text-[10px] font-medium text-muted-foreground mb-0.5">{r.senderName}</p>
                    )}
                    <div className="whitespace-pre-wrap break-words">{renderMentions(r.body)}</div>
                    <span className="text-[9px] text-muted-foreground nums block mt-0.5">{formatTime(r.createdAt)}</span>
                  </div>
                </div>
              )
            })}
            {hiddenCount > 0 && (
              <button
                onClick={() => setShowAllReplies(true)}
                className="text-[11px] text-primary hover:underline font-medium flex items-center gap-1"
              >
                <CircleDot className="size-3" /> View {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- mention picker (popover over textarea) ----------
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
    // Defer to keep effect body free of synchronous setState.
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
    <div className="px-3 pt-2">
      <div className="rounded-xl border border-border/60 bg-popover shadow-premium overflow-hidden max-w-md">
        <div className="px-3 py-2 border-b border-border/60 bg-muted/30 flex items-center gap-2">
          <AtSign className="size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members to mention…"
            className="h-7 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          <Button variant="ghost" size="icon" className="size-6" onClick={onClose} aria-label="Close">
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
                <Avatar className="size-6">
                  <AvatarImage src={m.photoUrl ?? undefined} alt={m.firstName} />
                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                    {initials(m.firstName, m.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
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

// ---------- new room dialog ----------
function NewRoomDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create room')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Room created')
      queryClient.invalidateQueries({ queryKey: ['townhall-rooms'] })
      setName(''); setDescription(''); setType('group'); setRefId('')
      onClose()
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

// ---------- new DM dialog ----------
function NewDMDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (roomId: string) => void }) {
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
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start DM')
      }
      return res.json()
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
                  <Avatar className="size-9">
                    <AvatarImage src={m.photoUrl ?? undefined} alt={m.firstName} />
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {initials(m.firstName, m.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{m.firstName} {m.lastName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{m.memberId ?? '—'} · {m.status ?? ''}</p>
                  </div>
                  <MessageCircle className="size-4 text-muted-foreground" />
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
