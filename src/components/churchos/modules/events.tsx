'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can, isScopedRole } from '@/lib/permissions'
import {
  formatDate, formatDateTime, titleCase,
} from '@/lib/format'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth,
  addMonths, subMonths, getDay, startOfWeek, endOfWeek, parseISO,
} from 'date-fns'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  CalendarDays, Plus, MoreHorizontal, Eye, Trash2, Pencil, RefreshCw,
  X, Search, AlertTriangle, MapPin, Users, Clock, ChevronRight,
  ChevronLeft, Tag, CheckCircle2, Ban, CalendarX2, UserPlus, Building2,
} from 'lucide-react'
import {
  PageHeader, StatCard, EmptyState, Toolbar, TableSkeleton,
} from '@/components/churchos/ui'

// ---------- types ----------
interface DeptRef { id: string; name: string; color?: string | null }
interface EventListItem {
  id: string
  title: string
  description?: string | null
  eventType: string
  venue?: string | null
  capacity?: number | null
  startDate: string
  endDate?: string | null
  status: string
  createdAt: string
  updatedAt: string
  departmentId?: string | null
  branchId?: string | null
  department?: DeptRef | null
  branch?: { id: string; name: string } | null
  registrations: number
}
interface EventListResponse {
  items: EventListItem[]
  total: number
  page: number
  pageSize: number
  departments: DeptRef[]
}
interface EventDetail {
  id: string
  title: string
  description?: string | null
  eventType: string
  venue?: string | null
  capacity?: number | null
  startDate: string
  endDate?: string | null
  status: string
  createdAt: string
  updatedAt: string
  departmentId?: string | null
  branchId?: string | null
  department?: DeptRef | null
  branch?: { id: string; name: string } | null
  registrations: { id: string; name: string; email?: string | null; phone?: string | null; createdAt: string }[]
  registrationsCount: number
}

const EVENT_TYPES = [
  { value: 'service', label: 'Service', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300' },
  { value: 'conference', label: 'Conference', color: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300' },
  { value: 'meeting', label: 'Meeting', color: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300' },
  { value: 'retreat', label: 'Retreat', color: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300' },
  { value: 'outreach', label: 'Outreach', color: 'bg-orange-500/10 text-orange-700 border-orange-500/20 dark:text-orange-300' },
  { value: 'training', label: 'Training', color: 'bg-cyan-500/10 text-cyan-700 border-cyan-500/20 dark:text-cyan-300' },
  { value: 'special', label: 'Special', color: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300' },
] as const

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300',
  approved: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  cancelled: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
  completed: 'bg-muted text-muted-foreground border-border',
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function eventTypeMeta(t: string) {
  return EVENT_TYPES.find((e) => e.value === t) ?? EVENT_TYPES[6]
}

// ---------- main module ----------
export default function EventsModule() {
  const { user, detailRef, clearDetail } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'events', 'create')
  const canUpdate = can(role, 'events', 'update')
  const canDelete = can(role, 'events', 'delete')
  const isScoped = isScopedRole(role)

  const [tab, setTab] = useState<'upcoming' | 'calendar' | 'past'>('upcoming')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const debounced = useDebouncedValue(search, 350)

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())

  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [deleteEv, setDeleteEv] = useState<{ id: string; title: string } | null>(null)

  const queryKey = useMemo(() => ['events', 'list', tab, debounced, page] as const, [tab, debounced, page])

  const { data, isLoading, isError, refetch, isFetching } = useQuery<EventListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      const now = new Date()
      if (tab === 'upcoming') {
        params.set('from', now.toISOString())
      } else if (tab === 'past') {
        params.set('to', now.toISOString())
      }
      // calendar tab: fetch wider range (current month ±1)
      if (tab === 'calendar') {
        params.set('from', startOfMonth(subMonths(calendarMonth, 1)).toISOString())
        params.set('to', endOfMonth(addMonths(calendarMonth, 1)).toISOString())
      }
      if (debounced) {
        params.delete('from')
        params.delete('to') // free text search overrides date filter
      }
      if (debounced) params.set('q', debounced)
      const res = await fetch(`/api/events?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load events')
      }
      return res.json()
    },
  })

  const departments = data?.departments ?? []
  const items = data?.items ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  // Open the event detail dialog when a notification is clicked (detailRef).
  useEffect(() => {
    if (!detailRef || detailRef.module !== 'events') return
    const refId = detailRef.refId
    // Defer setState to avoid the synchronous-setState-in-effect lint rule.
    const t = setTimeout(() => {
      if (refId) openDetail(refId)
      clearDetail()
    }, 0)
    return () => clearTimeout(t)
  }, [detailRef?.nonce, clearDetail, openDetail])

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/events/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Event deleted')
      queryClient.invalidateQueries({ queryKey: ['events'] })
      setDeleteEv(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Church Calendar"
        eyebrow="Ministry"
        description="Plan, schedule and register events — services, conferences, retreats and more."
        icon={CalendarDays}
        actions={canCreate && (
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="size-4" /> New Event
          </Button>
        )}
      />

      {/* Filter */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <Toolbar>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search events by title or venue…"
                className="pl-9"
                aria-label="Search events"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setPage(1) }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="shrink-0 gap-2">
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
          </Toolbar>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setPage(1) }}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-4">
          <EventsList
            items={items}
            isLoading={isLoading}
            isError={isError}
            refetch={refetch}
            isFetching={isFetching}
            canUpdate={canUpdate}
            canDelete={canDelete}
            isScoped={isScoped}
            onView={openDetail}
            onEdit={(id) => { setEditId(id); setEditOpen(true) }}
            onDelete={(ev) => setDeleteEv(ev)}
            emptyMessage="No upcoming events scheduled."
          />
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <CalendarView
            items={items}
            month={calendarMonth}
            onPrev={() => setCalendarMonth((m) => subMonths(m, 1))}
            onNext={() => setCalendarMonth((m) => addMonths(m, 1))}
            onToday={() => setCalendarMonth(new Date())}
            onView={openDetail}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="past" className="mt-4">
          <EventsList
            items={items}
            isLoading={isLoading}
            isError={isError}
            refetch={refetch}
            isFetching={isFetching}
            canUpdate={canUpdate}
            canDelete={canDelete}
            isScoped={isScoped}
            onView={openDetail}
            onEdit={(id) => { setEditId(id); setEditOpen(true) }}
            onDelete={(ev) => setDeleteEv(ev)}
            emptyMessage="No past events found."
          />
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Dialog */}
      {addOpen && (
        <EventFormDialog
          mode="create"
          departments={departments}
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['events'] })
          }}
        />
      )}

      {/* Edit Dialog */}
      {editOpen && editId && (
        <EventFormDialog
          mode="edit"
          eventId={editId}
          departments={departments}
          open={editOpen}
          onOpenChange={(o) => { setEditOpen(o); if (!o) setEditId(null) }}
          onSaved={() => {
            setEditOpen(false)
            queryClient.invalidateQueries({ queryKey: ['events'] })
            queryClient.invalidateQueries({ queryKey: ['event', editId] })
          }}
        />
      )}

      {/* Detail Dialog */}
      {detailOpen && detailId && (
        <EventDetailDialog
          id={detailId}
          open={detailOpen}
          onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetailId(null) }}
          canUpdate={canUpdate}
          canDelete={canDelete}
          onEdit={() => { setDetailOpen(false); setEditId(detailId); setEditOpen(true) }}
        />
      )}

      <AlertDialog open={!!deleteEv} onOpenChange={(o) => { if (!o) setDeleteEv(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteEv?.title}</strong> and all its registrations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (deleteEv) deleteMutation.mutate(deleteEv.id) }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- events list (cards) ----------
function EventsList({
  items, isLoading, isError, refetch, isFetching, canUpdate, canDelete, isScoped,
  onView, onEdit, onDelete, emptyMessage,
}: {
  items: EventListItem[]
  isLoading: boolean
  isError: boolean
  refetch: () => void
  isFetching: boolean
  canUpdate: boolean
  canDelete: boolean
  isScoped: boolean
  onView: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (ev: { id: string; title: string }) => void
  emptyMessage: string
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}
      </div>
    )
  }
  if (isError) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-0">
          <EmptyState
            icon={AlertTriangle}
            title="Failed to load events"
            action={<Button variant="outline" size="sm" className="mt-1 gap-2" onClick={() => refetch()}><RefreshCw className="size-3.5" /> Retry</Button>}
          />
        </CardContent>
      </Card>
    )
  }
  if (items.length === 0) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-0">
          <EmptyState
            icon={CalendarX2}
            title={emptyMessage}
            action={isFetching && <p className="text-xs text-primary mt-1">Updating…</p>}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((e) => {
        const meta = eventTypeMeta(e.eventType)
        const atCapacity = e.capacity && e.capacity > 0 && e.registrations >= e.capacity
        return (
          <Card key={e.id} className="border-border/60 hover:shadow-premium-md hover:-translate-y-0.5 transition-all overflow-hidden group rounded-xl">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-2 gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge variant="outline" className={`text-[10px] font-medium ${meta.color}`}>
                      <Tag className="size-2.5 mr-0.5" /> {meta.label}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] font-medium ${STATUS_STYLES[e.status] || 'bg-muted'}`}>
                      {titleCase(e.status)}
                    </Badge>
                  </div>
                  <p className="font-semibold leading-tight line-clamp-2">{e.title}</p>
                </div>
                {(canUpdate || canDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Event actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onView(e.id)}>
                        <Eye className="size-3.5" /> View
                      </DropdownMenuItem>
                      {canUpdate && (
                        <DropdownMenuItem onClick={() => onEdit(e.id)}>
                          <Pencil className="size-3.5" /> Edit
                        </DropdownMenuItem>
                      )}
                      {canDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => onDelete({ id: e.id, title: e.title })}>
                            <Trash2 className="size-3.5" /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {e.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[2rem]">{e.description}</p>
              )}

              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="size-3 text-muted-foreground" />
                  <span className="nums">{formatDate(e.startDate, { hour: '2-digit', minute: '2-digit' })}</span>
                  {e.endDate && (
                    <span className="text-muted-foreground nums">→ {formatDate(e.endDate, { hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </div>
                {e.venue && (
                  <div className="flex items-center gap-2 text-xs">
                    <MapPin className="size-3 text-muted-foreground" />
                    <span className="truncate">{e.venue}</span>
                  </div>
                )}
                {e.department && (
                  <div className="flex items-center gap-2 text-xs">
                    <Building2 className="size-3 text-muted-foreground" />
                    <span className="inline-flex items-center gap-1">
                      <span className="size-1.5 rounded-full" style={{ background: e.department.color || 'var(--primary)' }} />
                      {e.department.name}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border/40">
                <div className="text-xs text-muted-foreground">
                  {e.capacity ? (
                    <span className={`nums ${atCapacity ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}`}>
                      <Users className="size-3 inline mr-1" />
                      {e.registrations} / {e.capacity}
                      {atCapacity && ' · full'}
                    </span>
                  ) : (
                    <span className="nums"><Users className="size-3 inline mr-1" />{e.registrations} registered</span>
                  )}
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => onView(e.id)}>
                  View <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ---------- calendar view ----------
function CalendarView({
  items, month, onPrev, onNext, onToday, onView, isLoading,
}: {
  items: EventListItem[]
  month: Date
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onView: (id: string) => void
  isLoading: boolean
}) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 })
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start, end })

  const eventsByDay = useMemo(() => {
    const m = new Map<string, EventListItem[]>()
    for (const e of items) {
      const d = new Date(e.startDate)
      const key = format(d, 'yyyy-MM-dd')
      const arr = m.get(key) ?? []
      arr.push(e)
      m.set(key, arr)
    }
    return m
  }, [items])

  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold">{format(month, 'MMMM yyyy')}</h3>
            <p className="text-xs text-muted-foreground"><span className="nums">{items.length}</span> events in view</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={onPrev} aria-label="Previous month"><ChevronLeft className="size-4" /></Button>
            <Button variant="outline" size="sm" onClick={onToday}>Today</Button>
            <Button variant="outline" size="sm" onClick={onNext} aria-label="Next month"><ChevronRight className="size-4" /></Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-[10px] uppercase tracking-wider text-muted-foreground text-center py-1 font-medium">{d}</div>
          ))}
          {days.map((day) => {
            const inMonth = isSameMonth(day, month)
            const key = format(day, 'yyyy-MM-dd')
            const dayEvents = eventsByDay.get(key) ?? []
            const isToday = isSameDay(day, new Date())
            return (
              <div
                key={key}
                className={`min-h-[88px] rounded-lg border p-1.5 ${
                  inMonth ? 'border-border/60 bg-card' : 'border-border/30 bg-muted/20'
                } ${isToday ? 'ring-1 ring-primary' : ''}`}
              >
                <div className={`text-[10px] mb-1 nums ${inMonth ? 'text-foreground' : 'text-muted-foreground'} ${isToday ? 'font-bold text-primary' : ''}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((e) => {
                    const meta = eventTypeMeta(e.eventType)
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onView(e.id)}
                        className={`block w-full text-left text-[9px] px-1 py-0.5 rounded truncate ${meta.color} hover:opacity-80 transition-opacity`}
                        title={e.title}
                      >
                        <span className="nums">{format(parseISO(e.startDate), 'HH:mm')}</span> {e.title}
                      </button>
                    )
                  })}
                  {dayEvents.length > 3 && (
                    <p className="text-[9px] text-muted-foreground nums">+{dayEvents.length - 3} more</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {isLoading && <p className="text-xs text-primary mt-3">Loading events…</p>}
      </CardContent>
    </Card>
  )
}

// ---------- event form dialog ----------
interface EventFormState {
  title: string
  description: string
  eventType: string
  venue: string
  capacity: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  status: string
  departmentId: string
}
const EMPTY_FORM: EventFormState = {
  title: '',
  description: '',
  eventType: 'service',
  venue: '',
  capacity: '',
  startDate: new Date().toISOString().slice(0, 10),
  startTime: '10:00',
  endDate: '',
  endTime: '',
  status: 'scheduled',
  departmentId: '',
}

function EventFormDialog({
  mode, eventId, departments, open, onOpenChange, onSaved,
}: {
  mode: 'create' | 'edit'
  eventId?: string
  departments: DeptRef[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const role = user?.role ?? 'member'
  const isScoped = isScopedRole(role)
  const [form, setForm] = useState<EventFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && eventId) {
      ;(async () => {
        try {
          const res = await fetch(`/api/events/${eventId}`)
          if (!res.ok) throw new Error('Failed')
          const e: EventDetail = await res.json()
          setForm({
            title: e.title,
            description: e.description ?? '',
            eventType: e.eventType,
            venue: e.venue ?? '',
            capacity: e.capacity != null ? String(e.capacity) : '',
            startDate: new Date(e.startDate).toISOString().slice(0, 10),
            startTime: new Date(e.startDate).toISOString().slice(11, 16),
            endDate: e.endDate ? new Date(e.endDate).toISOString().slice(0, 10) : '',
            endTime: e.endDate ? new Date(e.endDate).toISOString().slice(11, 16) : '',
            status: e.status,
            departmentId: e.departmentId ?? '',
          })
        } catch {
          toast.error('Failed to load event')
          onOpenChange(false)
        }
      })()
    } else {
      // For scoped roles, pre-fill departmentId with their own
      setForm({
        ...EMPTY_FORM,
        departmentId: isScoped && user?.departmentId ? user.departmentId : '',
      })
    }
  }, [mode, eventId, open, onOpenChange, isScoped, user])

  const set = <K extends keyof EventFormState>(k: K, v: EventFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (!form.startDate || !form.startTime) { toast.error('Start date and time are required'); return }

    const startISO = new Date(`${form.startDate}T${form.startTime}:00`).toISOString()
    let endISO: string | null = null
    if (form.endDate && form.endTime) {
      endISO = new Date(`${form.endDate}T${form.endTime}:00`).toISOString()
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        eventType: form.eventType,
        venue: form.venue.trim() || null,
        capacity: form.capacity ? parseInt(form.capacity, 10) || null : null,
        startDate: startISO,
        endDate: endISO,
        status: form.status,
        departmentId: form.departmentId || null,
      }
      const url = mode === 'create' ? '/api/events' : `/api/events/${eventId}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Failed to ${mode} event`)
      }
      toast.success(mode === 'create' ? 'Event created' : 'Event updated')
      onSaved()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Event' : 'Edit Event'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Plan a new church event — service, conference, retreat and more.'
              : 'Update the event details. Changes will be audited.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label="Title *">
              <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Event title" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Brief description" />
            </Field>
          </div>
          <Field label="Event type">
            <Select value={form.eventType} onValueChange={(v) => set('eventType', v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set('status', v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Venue">
            <Input value={form.venue} onChange={(e) => set('venue', e.target.value)} placeholder="Location / hall" />
          </Field>
          <Field label="Capacity">
            <Input type="number" min="0" value={form.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="Max attendees" />
          </Field>
          <Field label="Start date *">
            <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="Start time *">
            <Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
          </Field>
          <Field label="End date">
            <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
          <Field label="End time">
            <Input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Department">
              <Select
                value={form.departmentId || 'none'}
                onValueChange={(v) => set('departmentId', v === 'none' ? '' : v)}
                disabled={isScoped}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={isScoped ? 'Locked to your department' : 'No department'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No department —</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isScoped && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  As a {titleCase(role)}, you can only create events for your own department.
                </p>
              )}
            </Field>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving ? 'Saving…' : mode === 'create' ? 'Create event' : 'Save changes'}
            {!saving && <ChevronRight className="size-3.5" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- event detail dialog ----------
function EventDetailDialog({
  id, open, onOpenChange, canUpdate, canDelete, onEdit,
}: {
  id: string
  open: boolean
  onOpenChange: (o: boolean) => void
  canUpdate: boolean
  canDelete: boolean
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery<EventDetail>({
    queryKey: ['event', id] as const,
    queryFn: async () => {
      const res = await fetch(`/api/events/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load event')
      }
      return res.json()
    },
    enabled: open,
  })

  // Register form
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regOpen, setRegOpen] = useState(false)
  const [registering, setRegistering] = useState(false)

  const registerMutation = useMutation({
    mutationFn: async (payload: { name: string; email?: string | null; phone?: string | null }) => {
      const res = await fetch(`/api/events/${id}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        const err = new Error(e.error || 'Registration failed') as Error & { duplicate?: boolean; atCapacity?: boolean }
        if (e.duplicate) err.duplicate = true
        if (e.atCapacity) err.atCapacity = true
        throw err
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Registered successfully')
      queryClient.invalidateQueries({ queryKey: ['event', id] })
      queryClient.invalidateQueries({ queryKey: ['events'] })
      setRegOpen(false)
      setRegName(''); setRegEmail(''); setRegPhone('')
    },
    onError: (e: Error & { duplicate?: boolean; atCapacity?: boolean }) => {
      if (e.duplicate) toast.error('This email is already registered for this event')
      else if (e.atCapacity) toast.error('Event is at full capacity')
      else toast.error(e.message)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Cancel failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Event cancelled')
      queryClient.invalidateQueries({ queryKey: ['event', id] })
      queryClient.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const submitRegister = () => {
    if (!regName.trim()) { toast.error('Name is required'); return }
    registerMutation.mutate({
      name: regName.trim(),
      email: regEmail.trim() || null,
      phone: regPhone.trim() || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto scroll-thin">
        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <div className="py-10 text-center">
            <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium">Failed to load event</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : data ? (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <Badge variant="outline" className={`text-[10px] font-medium ${eventTypeMeta(data.eventType).color}`}>
                      <Tag className="size-2.5 mr-0.5" /> {eventTypeMeta(data.eventType).label}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] font-medium ${STATUS_STYLES[data.status] || 'bg-muted'}`}>
                      {titleCase(data.status)}
                    </Badge>
                  </div>
                  <DialogTitle className="text-xl">{data.title}</DialogTitle>
                  <DialogDescription className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="nums">{formatDate(data.startDate, { hour: '2-digit', minute: '2-digit' })}</span>
                    {data.endDate && <span className="nums">→ {formatDate(data.endDate, { hour: '2-digit', minute: '2-digit' })}</span>}
                  </DialogDescription>
                </div>
                {canUpdate && (
                  <Button variant="outline" size="sm" onClick={onEdit} className="gap-2">
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                )}
              </div>
            </DialogHeader>

            {data.description && (
              <div className="rounded-xl border border-border/60 p-3 text-sm">
                <p className="whitespace-pre-wrap">{data.description}</p>
              </div>
            )}

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoLine icon={MapPin} label="Venue" value={data.venue} />
              <InfoLine icon={Building2} label="Department" value={data.department?.name} />
              <InfoLine icon={Users} label="Capacity" value={data.capacity ? `${data.registrationsCount} / ${data.capacity}` : `${data.registrationsCount} registered`} />
              <InfoLine icon={Clock} label="Status" value={titleCase(data.status)} />
            </section>

            {/* Registrations list */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <UserPlus className="size-3.5" /> Registrations (<span className="nums">{data.registrations.length}</span>)
                </p>
                <Button variant="outline" size="sm" onClick={() => setRegOpen(true)} className="gap-2">
                  <Plus className="size-3.5" /> Add
                </Button>
              </div>
              {data.registrations.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  No registrations yet.
                </div>
              ) : (
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <div className="max-h-56 overflow-y-auto scroll-thin">
                    <Table>
                      <TableHeader className="sticky top-0">
                        <TableRow className="bg-muted/40 hover:bg-muted/40 border-border/60">
                          <TableHead className="pl-3 text-xs uppercase tracking-wide text-muted-foreground font-medium">Name</TableHead>
                          <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Email</TableHead>
                          <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Phone</TableHead>
                          <TableHead className="text-right pr-3 text-xs uppercase tracking-wide text-muted-foreground font-medium">When</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.registrations.map((r) => (
                          <TableRow key={r.id} className="hover:bg-muted/40 border-border/60">
                            <TableCell className="pl-3 text-sm">{r.name}</TableCell>
                            <TableCell className="hidden sm:table-cell text-xs">{r.email ?? '—'}</TableCell>
                            <TableCell className="hidden md:table-cell text-xs">{r.phone ?? '—'}</TableCell>
                            <TableCell className="text-right pr-3 text-xs text-muted-foreground nums">{formatDate(r.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </section>

            {/* Admin actions */}
            {canUpdate && data.status !== 'cancelled' && data.status !== 'completed' && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-rose-600 dark:text-rose-400 gap-2">
                      <Ban className="size-3.5" /> Cancel event
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel event?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will mark <strong>{data.title}</strong> as cancelled. Registrations will be preserved.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep event</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90"
                        disabled={cancelMutation.isPending}
                        onClick={(e) => { e.preventDefault(); cancelMutation.mutate() }}
                      >
                        {cancelMutation.isPending ? 'Cancelling…' : 'Cancel event'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </>
        ) : null}
      </DialogContent>

      {/* Register sub-dialog */}
      <Dialog open={regOpen} onOpenChange={setRegOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Registration</DialogTitle>
            <DialogDescription>
              Register an attendee for {data?.title}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name *">
              <Input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Full name" />
            </Field>
            <Field label="Email">
              <Input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="email@example.com" />
            </Field>
            <Field label="Phone">
              <Input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="+234 803 ..." />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={registering}>Cancel</Button>
            </DialogClose>
            <Button onClick={submitRegister} disabled={registering} className="gap-2">
              {registering ? 'Registering…' : 'Register'}
              {!registering && <ChevronRight className="size-3.5" />}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

// ---------- helpers ----------
function InfoLine({
  icon: Icon, label, value,
}: {
  icon: typeof MapPin; label: string; value?: string | null
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm truncate">{value || <span className="text-muted-foreground">—</span>}</p>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  )
}
