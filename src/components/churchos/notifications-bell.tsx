'use client'

// ChurchOS — NotificationsBell: live notification dropdown with polling.
// Shows unread count badge + dropdown list + mark-as-read + navigation.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Bell, CheckCheck, BellOff, ArrowRight } from 'lucide-react'
import { relativeTime } from '@/lib/format'
import { useAuth } from '@/lib/auth-store'
import { toast } from 'sonner'
import { useState, useEffect } from 'react'

interface NotificationItem {
  id: string
  title: string
  message: string
  link: string | null
  read: boolean
  createdAt: string
}

export function NotificationsBell() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  // Poll notifications every 30s + on mount + on window focus
  const { data, isLoading } = useQuery<{ items: NotificationItem[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/notifications?pageSize=20')
      if (!res.ok) return { items: [], unread: 0 }
      return res.json()
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const unread = data?.unread ?? 0
  const items = data?.items ?? []

  const markAllRead = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      return res.json()
    },
    onSuccess: () => {
      toast.success('All notifications marked as read')
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markOneRead = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const handleClick = (item: NotificationItem) => {
    if (!item.read) markOneRead.mutate(item.id)
    setOpen(false)
    if (!item.link) return

    // Parse the link. Supported formats:
    //   1. "module"              → navigate to module only (e.g. "finance", "tasks")
    //   2. "module:refId"       → navigate to module AND open the specific record
    //                             (e.g. "townhall:abc123", "member:xyz", "event:def")
    //   3. "/path"              → legacy path format (e.g. "/announcements/123")
    //                             — converted to "announcement:123"
    let targetModule: string | null = null
    let refId: string | null = null

    if (item.link.startsWith('/')) {
      // Legacy path format: /announcements/123 → announcement:123
      const parts = item.link.split('/').filter(Boolean)
      if (parts.length >= 2) {
        targetModule = parts[0].replace(/s$/, '') // "announcements" → "announcement"
        refId = parts[1]
      } else if (parts.length === 1) {
        targetModule = parts[0]
      }
    } else if (item.link.includes(':')) {
      // module:refId format
      const idx = item.link.indexOf(':')
      targetModule = item.link.slice(0, idx)
      refId = item.link.slice(idx + 1)
    } else {
      // Plain module name
      targetModule = item.link
    }

    if (!targetModule) return

    // Normalize "announcement" → "announcements" (module names are plural)
    const MODULE_ALIASES: Record<string, string> = {
      announcement: 'announcements',
      event: 'events',
      task: 'tasks',
      tithe: 'finance',
      donation: 'finance',
      expense: 'finance',
      case: 'pastoral',
      pastoralcase: 'pastoral',
      prayer: 'pastoral',
      user: 'settings',
      role: 'access',
    }
    targetModule = MODULE_ALIASES[targetModule] ?? targetModule

    // Dispatch the navigate event with module + optional refId.
    window.dispatchEvent(
      new CustomEvent('churchos:navigate', {
        detail: refId ? { module: targetModule, refId } : { module: targetModule },
      }),
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}>
          <Bell className="size-4.5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold grid place-items-center ring-2 ring-background">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 sm:w-96 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                {unread} new
              </Badge>
            )}
          </div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          )}
        </div>

        {/* List */}
        <ScrollArea className="max-h-[360px]">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <BellOff className="size-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No notifications</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">You're all caught up!</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={`w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors flex items-start gap-3 ${!item.read ? 'bg-primary/[0.04]' : ''}`}
                >
                  {/* Unread dot */}
                  <div className="mt-1.5 shrink-0">
                    {!item.read ? (
                      <span className="size-2 rounded-full bg-primary" />
                    ) : (
                      <span className="size-2 rounded-full bg-transparent" />
                    )}
                  </div>
                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-snug ${!item.read ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'}`}>
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.message}</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-1">{relativeTime(item.createdAt)}</p>
                  </div>
                  {/* Arrow */}
                  {item.link && (
                    <ArrowRight className="size-3.5 text-muted-foreground/40 shrink-0 mt-1" />
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
