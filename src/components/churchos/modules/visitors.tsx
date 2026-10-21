'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import {
  formatDate, formatDateTime, initials, fullName, titleCase,
} from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
} from '@/components/ui/alert-dialog'
import {
  UserPlus, Users, MoreHorizontal, Eye, Trash2, Pencil, RefreshCw,
  X, Search, AlertTriangle, CalendarDays, Phone, Mail, MapPin, HeartHandshake,
  PhoneCall, MessageSquare, Mail as MailIcon, Home, ArrowRight, CheckCircle2,
  CircleDot, Clock, Crown, Filter, ListChecks, LayoutGrid,
} from 'lucide-react'
import {
  PageHeader, StatCard, EmptyState, Toolbar, TableSkeleton,
} from '@/components/churchos/ui'

// ---------- types ----------
interface VisitorListItem {
  id: string
  firstName: string
  lastName: string
  phone?: string | null
  email?: string | null
  address?: string | null
  referralSource?: string | null
  firstVisitDate: string
  consent: boolean
  convertedMemberId?: string | null
  createdAt: string
  followUpsCount: number
  latestFollowUp?: { id: string; status: string; dueDate?: string | null; ownerId?: string | null } | null
}
interface VisitorsListResponse {
  items: VisitorListItem[]
  total: number
  page: number
  pageSize: number
  stats: { total: number; converted: number; pendingFollowUp: number; active: number }
}
interface FollowUpOwner { id: string; name: string; email: string }
interface FollowUpListItem {
  id: string
  status: string
  dueDate?: string | null
  outcome?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  visitorId?: string | null
  memberId?: string | null
  ownerId?: string | null
  visitor?: { id: string; firstName: string; lastName: string; phone?: string | null; email?: string | null; convertedMemberId?: string | null } | null
  owner?: FollowUpOwner | null
  interactions: number
}
interface FollowUpsResponse {
  items: FollowUpListItem[]
  total: number
  page: number
  pageSize: number
  stats: { total: number; pending: number; inProgress: number; done: number }
  owners: FollowUpOwner[]
}

const REFERRAL_SOURCES = ['Friend', 'Family', 'Flyer', 'Social Media', 'Walk-in', 'Outreach', 'Online', 'Other']
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  in_progress: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300',
  done: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  lost: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
}
const INTERACTION_METHODS = [
  { value: 'call', label: 'Call', icon: PhoneCall },
  { value: 'sms', label: 'SMS', icon: MessageSquare },
  { value: 'email', label: 'Email', icon: MailIcon },
  { value: 'visit', label: 'Visit', icon: Home },
] as const

function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ---------- main module ----------
export default function VisitorsModule() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'visitors', 'create')
  const canUpdate = can(role, 'visitors', 'update')
  const canDelete = can(role, 'visitors', 'delete')
  const canSeeNotes = can(role, 'followups', 'update')

  const [tab, setTab] = useState<'visitors' | 'followups'>('visitors')
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visitors & Follow-up"
        eyebrow="People"
        description="Welcome new visitors, assign follow-up tasks, and track engagement."
        icon={UserPlus}
        actions={canCreate && (
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
            <UserPlus className="size-4" /> Register Visitor
          </Button>
        )}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="visitors" className="gap-1.5"><Users className="size-3.5" /> Visitors</TabsTrigger>
          <TabsTrigger value="followups" className="gap-1.5"><HeartHandshake className="size-3.5" /> Follow-up Board</TabsTrigger>
        </TabsList>

        <TabsContent value="visitors" className="mt-4">
          <VisitorsTab
            canUpdate={canUpdate}
            canDelete={canDelete}
            canCreate={canCreate}
            onSwitchToFollowUps={() => setTab('followups')}
          />
        </TabsContent>

        <TabsContent value="followups" className="mt-4">
          <FollowUpsBoard canSeeNotes={canSeeNotes} canUpdate={can(role, 'followups', 'update')} />
        </TabsContent>
      </Tabs>

      {addOpen && (
        <VisitorFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['visitors'] })
            queryClient.invalidateQueries({ queryKey: ['followups'] })
          }}
        />
      )}
    </div>
  )
}

// ---------- visitors tab ----------
function VisitorsTab({
  canUpdate, canDelete, canCreate, onSwitchToFollowUps,
}: {
  canUpdate: boolean
  canDelete: boolean
  canCreate: boolean
  onSwitchToFollowUps: () => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const debounced = useDebouncedValue(search, 350)

  // Reset to first page whenever search changes (handled in onChange, not effect)
  const onSearchChange = (v: string) => {
    setSearch(v)
    setPage(1)
  }

  const queryKey = useMemo(() => ['visitors', 'list', debounced, page] as const, [debounced, page])
  const { data, isLoading, isError, refetch, isFetching } = useQuery<VisitorsListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (debounced) params.set('q', debounced)
      const res = await fetch(`/api/visitors?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load visitors')
      }
      return res.json()
    },
  })

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteV, setDeleteV] = useState<{ id: string; name: string } | null>(null)
  const [convertV, setConvertV] = useState<{ id: string; name: string; email: string | null } | null>(null)

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  const convertMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/visitors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert' }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Conversion failed')
      }
      return res.json()
    },
    onSuccess: (d) => {
      toast.success(
        d.linked
          ? 'Linked to existing member with same email'
          : `Converted to member (${d.memberIdCode ?? 'new member'})`,
      )
      queryClient.invalidateQueries({ queryKey: ['visitors'] })
      queryClient.invalidateQueries({ queryKey: ['members'] })
      setConvertV(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/visitors/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Visitor deleted')
      queryClient.invalidateQueries({ queryKey: ['visitors'] })
      setDeleteV(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const stats = data?.stats ?? { total: 0, converted: 0, pendingFollowUp: 0, active: 0 }

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total" value={stats.total.toLocaleString()} accent="primary" />
        <StatCard icon={UserPlus} label="Active" value={stats.active.toLocaleString()} accent="indigo" />
        <StatCard icon={HeartHandshake} label="Pending Follow-up" value={stats.pendingFollowUp.toLocaleString()} accent="amber" />
        <StatCard icon={CheckCircle2} label="Converted" value={stats.converted.toLocaleString()} accent="emerald" />
      </div>

      <Card className="border-border/60">
        <CardContent className="p-4">
          <Toolbar>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search by name, phone, email, or referral…"
                className="pl-9"
                aria-label="Search visitors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setPage(1) }} className="shrink-0 gap-2">
              <RefreshCw className="size-3.5" /> Reset
            </Button>
          </Toolbar>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load visitors"
              action={<Button variant="outline" size="sm" className="mt-1 gap-2" onClick={() => refetch()}><RefreshCw className="size-3.5" /> Retry</Button>}
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="No visitors found"
              description={search ? 'Try a different search.' : 'Register your first visitor.'}
              action={canCreate && (
                <Button size="sm" onClick={() => {/* handled in parent */}} className="gap-2">
                  <UserPlus className="size-4" /> Register Visitor
                </Button>
              )}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                    <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Visitor</TableHead>
                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Contact</TableHead>
                    <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Referral</TableHead>
                    <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">First Visit</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Follow-up</TableHead>
                    <TableHead className="text-right pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((v) => (
                    <TableRow key={v.id} className="cursor-pointer hover:bg-muted/40 border-border/60" onClick={() => openDetail(v.id)}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-8">
                            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                              {initials(v.firstName, v.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {fullName(v.firstName, v.lastName)}
                            </p>
                            {v.convertedMemberId && (
                              <Badge variant="outline" className="text-[9px] mt-0.5 bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300">
                                <CheckCircle2 className="size-2.5 mr-1" /> Converted
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="text-xs space-y-0.5">
                          {v.phone && <div className="truncate">{v.phone}</div>}
                          {v.email ? (
                            <div className="truncate text-muted-foreground">{v.email}</div>
                          ) : (
                            <div className="text-muted-foreground">—</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {v.referralSource ?? '—'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground nums">
                        {formatDate(v.firstVisitDate)}
                      </TableCell>
                      <TableCell>
                        {v.latestFollowUp ? (
                          <Badge variant="outline" className={`text-[11px] font-medium ${STATUS_STYLES[v.latestFollowUp.status] || 'bg-muted text-muted-foreground border-border'}`}>
                            {titleCase(v.latestFollowUp.status)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No task</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label="Visitor actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(v.id)}>
                              <Eye className="size-3.5" /> View
                            </DropdownMenuItem>
                            {canUpdate && (
                              <DropdownMenuItem onClick={() => { setEditId(v.id); setEditOpen(true) }}>
                                <Pencil className="size-3.5" /> Edit
                              </DropdownMenuItem>
                            )}
                            {canUpdate && !v.convertedMemberId && (
                              <DropdownMenuItem onClick={() => setConvertV({ id: v.id, name: fullName(v.firstName, v.lastName), email: v.email ?? null })}>
                                <CheckCircle2 className="size-3.5" /> Convert to member
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={onSwitchToFollowUps}>
                              <HeartHandshake className="size-3.5" /> Follow-up board
                            </DropdownMenuItem>
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => setDeleteV({ id: v.id, name: fullName(v.firstName, v.lastName) })}>
                                  <Trash2 className="size-3.5" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-4 border-t border-border/60">
                <p className="text-xs text-muted-foreground">
                  Showing <span className="font-medium text-foreground nums">{(page - 1) * pageSize + 1}</span>
                  {'–'}
                  <span className="font-medium text-foreground nums">{Math.min(page * pageSize, data.total)}</span>
                  {' '}of <span className="font-medium text-foreground nums">{data.total}</span> visitors
                  {isFetching && <span className="ml-2 text-primary">· updating…</span>}
                </p>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {detailOpen && detailId && (
        <VisitorDetailDialog
          id={detailId}
          open={detailOpen}
          onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetailId(null) }}
          canUpdate={canUpdate}
        />
      )}
      {editOpen && editId && (
        <VisitorFormDialog
          mode="edit"
          visitorId={editId}
          open={editOpen}
          onOpenChange={(o) => { setEditOpen(o); if (!o) setEditId(null) }}
          onSaved={() => {
            setEditOpen(false)
            queryClient.invalidateQueries({ queryKey: ['visitors'] })
            queryClient.invalidateQueries({ queryKey: ['visitor', editId] })
          }}
        />
      )}

      <AlertDialog open={!!deleteV} onOpenChange={(o) => { if (!o) setDeleteV(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete visitor?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteV?.name}</strong> and their follow-up tasks. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (deleteV) deleteMutation.mutate(deleteV.id) }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!convertV} onOpenChange={(o) => { if (!o) setConvertV(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert to member?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new Member record for <strong>{convertV?.name}</strong> with status{' '}
              <span className="font-medium text-foreground">new_convert</span>
              {convertV?.email && (
                <>. If a member with email <code>{convertV.email}</code> already exists, the visitor will be linked instead.</>
              )}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convertMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={convertMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (convertV) convertMutation.mutate(convertV.id) }}
            >
              {convertMutation.isPending ? 'Converting…' : 'Convert to member'}
              {!convertMutation.isPending && <ArrowRight className="size-3.5 ml-1.5" />}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- follow-ups board ----------
function FollowUpsBoard({ canSeeNotes, canUpdate }: { canSeeNotes: boolean; canUpdate: boolean }) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'done'>('all')
  const [layout, setLayout] = useState<'board' | 'list'>('board')

  const queryKey = useMemo(
    () => ['followups', 'list', statusFilter] as const,
    [statusFilter],
  )
  const { data, isLoading, isError, refetch } = useQuery<FollowUpsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/followups?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load follow-ups')
      }
      return res.json()
    },
  })

  const items = data?.items ?? []
  const owners = data?.owners ?? []
  const stats = data?.stats ?? { total: 0, pending: 0, inProgress: 0, done: 0 }

  const grouped = useMemo(() => ({
    pending: items.filter((i) => i.status === 'pending'),
    in_progress: items.filter((i) => i.status === 'in_progress'),
    done: items.filter((i) => i.status === 'done' || i.status === 'lost'),
  }), [items])

  const [logTask, setLogTask] = useState<FollowUpListItem | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/followups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Update failed')
      }
      return res.json()
    },
    onSuccess: (_d, vars) => {
      toast.success(`Marked as ${titleCase(vars.status === 'in_progress' ? 'in progress' : vars.status)}`)
      queryClient.invalidateQueries({ queryKey: ['followups'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      {/* Stats + toolbar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={ListChecks} label="Total" value={stats.total.toLocaleString()} accent="primary" />
        <StatCard icon={Clock} label="Pending" value={stats.pending.toLocaleString()} accent="amber" />
        <StatCard icon={CircleDot} label="In Progress" value={stats.inProgress.toLocaleString()} accent="indigo" />
        <StatCard icon={CheckCircle2} label="Done" value={stats.done.toLocaleString()} accent="emerald" />
      </div>

      <Card className="border-border/60">
        <CardContent className="p-4">
          <Toolbar>
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="w-44" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done / Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 md:ml-auto">
              <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
                <button
                  type="button"
                  onClick={() => setLayout('board')}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${layout === 'board' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  aria-label="Board view"
                >
                  <LayoutGrid className="size-3" /> Board
                </button>
                <button
                  type="button"
                  onClick={() => setLayout('list')}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${layout === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  aria-label="List view"
                >
                  <ListChecks className="size-3" /> List
                </button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="size-3.5" /> Refresh
              </Button>
            </div>
          </Toolbar>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load follow-ups"
              action={<Button variant="outline" size="sm" className="mt-1 gap-2" onClick={() => refetch()}><RefreshCw className="size-3.5" /> Retry</Button>}
            />
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={HeartHandshake}
              title="No follow-up tasks"
              description={statusFilter !== 'all' ? 'Try a different filter.' : 'Create a follow-up task from a visitor profile.'}
            />
          </CardContent>
        </Card>
      ) : layout === 'board' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BoardColumn title="Pending" icon={Clock} accent="text-amber-600 dark:text-amber-400" items={grouped.pending} canUpdate={canUpdate} onLog={(t) => { setLogTask(t); setLogOpen(true) }} onMarkDone={(id) => updateStatus.mutate({ id, status: 'done' })} onMarkProgress={(id) => updateStatus.mutate({ id, status: 'in_progress' })} onView={(id) => { setDetailTaskId(id); setDetailOpen(true) }} />
          <BoardColumn title="In Progress" icon={CircleDot} accent="text-sky-600 dark:text-sky-400" items={grouped.in_progress} canUpdate={canUpdate} onLog={(t) => { setLogTask(t); setLogOpen(true) }} onMarkDone={(id) => updateStatus.mutate({ id, status: 'done' })} onMarkProgress={(id) => updateStatus.mutate({ id, status: 'in_progress' })} onView={(id) => { setDetailTaskId(id); setDetailOpen(true) }} />
          <BoardColumn title="Done" icon={CheckCircle2} accent="text-emerald-600 dark:text-emerald-400" items={grouped.done} canUpdate={canUpdate} onLog={(t) => { setLogTask(t); setLogOpen(true) }} onMarkDone={(id) => updateStatus.mutate({ id, status: 'done' })} onMarkProgress={(id) => updateStatus.mutate({ id, status: 'in_progress' })} onView={(id) => { setDetailTaskId(id); setDetailOpen(true) }} />
        </div>
      ) : (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                  <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Visitor</TableHead>
                  <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Owner</TableHead>
                  <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Due</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                  <TableHead className="text-center text-xs uppercase tracking-wide text-muted-foreground font-medium">Interactions</TableHead>
                  <TableHead className="text-right pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => {
                  const overdue = t.dueDate && new Date(t.dueDate).getTime() < Date.now() && t.status !== 'done' && t.status !== 'lost'
                  return (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-muted/40 border-border/60" onClick={() => { setDetailTaskId(t.id); setDetailOpen(true) }}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7">
                            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                              {t.visitor ? initials(t.visitor.firstName, t.visitor.lastName) : '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {t.visitor ? fullName(t.visitor.firstName, t.visitor.lastName) : '—'}
                            </p>
                            {t.visitor?.phone && <p className="text-[10px] text-muted-foreground truncate">{t.visitor.phone}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {t.owner ? (
                          <span className="inline-flex items-center gap-1">
                            <Crown className="size-3 text-muted-foreground" /> {t.owner.name}
                          </span>
                        ) : <span className="text-muted-foreground">Unassigned</span>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {t.dueDate ? (
                          <span className={`text-xs nums ${overdue ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-muted-foreground'}`}>
                            {formatDate(t.dueDate)}
                            {overdue && ' · overdue'}
                          </span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[11px] font-medium ${STATUS_STYLES[t.status] || 'bg-muted text-muted-foreground border-border'}`}>
                          {titleCase(t.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground nums">{t.interactions}</TableCell>
                      <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label="Task actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setDetailTaskId(t.id); setDetailOpen(true) }}>
                              <Eye className="size-3.5" /> View details
                            </DropdownMenuItem>
                            {canUpdate && (
                              <>
                                <DropdownMenuItem onClick={() => { setLogTask(t); setLogOpen(true) }}>
                                  <PhoneCall className="size-3.5" /> Log interaction
                                </DropdownMenuItem>
                                {t.status !== 'in_progress' && (
                                  <DropdownMenuItem onClick={() => updateStatus.mutate({ id: t.id, status: 'in_progress' })}>
                                    <CircleDot className="size-3.5" /> Mark in progress
                                  </DropdownMenuItem>
                                )}
                                {t.status !== 'done' && (
                                  <DropdownMenuItem onClick={() => updateStatus.mutate({ id: t.id, status: 'done' })}>
                                    <CheckCircle2 className="size-3.5" /> Mark done
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {logOpen && logTask && (
        <LogInteractionDialog
          task={logTask}
          open={logOpen}
          onOpenChange={(o) => { setLogOpen(o); if (!o) setLogTask(null) }}
          onSaved={() => {
            setLogOpen(false)
            queryClient.invalidateQueries({ queryKey: ['followups'] })
          }}
        />
      )}

      {detailOpen && detailTaskId && (
        <FollowUpDetailDialog
          id={detailTaskId}
          open={detailOpen}
          onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetailTaskId(null) }}
          canUpdate={canUpdate}
          canSeeNotes={canSeeNotes}
        />
      )}
    </div>
  )
}

// ---------- board column ----------
function BoardColumn({
  title, icon: Icon, accent, items, canUpdate, onLog, onMarkDone, onMarkProgress, onView,
}: {
  title: string
  icon: typeof Clock
  accent: string
  items: FollowUpListItem[]
  canUpdate: boolean
  onLog: (t: FollowUpListItem) => void
  onMarkDone: (id: string) => void
  onMarkProgress: (id: string) => void
  onView: (id: string) => void
}) {
  return (
    <Card className="border-border/60 rounded-xl">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Icon className={`size-4 ${accent}`} />
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          <Badge variant="outline" className="text-[11px] nums">{items.length}</Badge>
        </div>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto scroll-thin pr-1">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No tasks here</p>
          ) : items.map((t) => {
            const overdue = t.dueDate && new Date(t.dueDate).getTime() < Date.now() && t.status !== 'done' && t.status !== 'lost'
            return (
              <div key={t.id} className="rounded-xl border border-border/60 p-3 hover:border-primary/40 hover:shadow-premium transition-all cursor-pointer" onClick={() => onView(t.id)}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium leading-tight">
                    {t.visitor ? fullName(t.visitor.firstName, t.visitor.lastName) : '—'}
                  </p>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${STATUS_STYLES[t.status] || ''}`}>
                    {titleCase(t.status)}
                  </Badge>
                </div>
                {t.dueDate && (
                  <p className={`text-[10px] nums ${overdue ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-muted-foreground'}`}>
                    <CalendarDays className="size-2.5 inline mr-1" />
                    {formatDate(t.dueDate)}
                    {overdue && ' · overdue'}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {t.owner ? t.owner.name : 'Unassigned'} · <span className="nums">{t.interactions}</span> interaction{t.interactions === 1 ? '' : 's'}
                </p>
                {canUpdate && (
                  <div className="flex gap-1 mt-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs flex-1 gap-1" onClick={(e) => { e.stopPropagation(); onLog(t) }}>
                      <PhoneCall className="size-3" /> Log
                    </Button>
                    {t.status !== 'in_progress' && t.status !== 'done' && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); onMarkProgress(t.id) }} aria-label="Mark in progress">
                        <CircleDot className="size-3" />
                      </Button>
                    )}
                    {t.status !== 'done' && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600 dark:text-emerald-400" onClick={(e) => { e.stopPropagation(); onMarkDone(t.id) }} aria-label="Mark done">
                        <CheckCircle2 className="size-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- log interaction dialog ----------
function LogInteractionDialog({
  task, open, onOpenChange, onSaved,
}: {
  task: FollowUpListItem
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [method, setMethod] = useState<'call' | 'sms' | 'email' | 'visit'>('call')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setMethod('call')
      setNotes('')
    }
  }, [open])

  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/followups/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addInteraction: { method, notes: notes.trim() || null } }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to log interaction')
      }
      toast.success('Interaction logged')
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Interaction</DialogTitle>
          <DialogDescription>
            {task.visitor ? `For ${fullName(task.visitor.firstName, task.visitor.lastName)}` : ''}
            {' · '}{titleCase(task.status)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Method">
            <div className="grid grid-cols-4 gap-2">
              {INTERACTION_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-md border py-2 text-xs transition-colors ${
                    method === m.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border/60 text-muted-foreground hover:bg-accent/40'
                  }`}
                >
                  <m.icon className="size-4" />
                  {m.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Notes">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was discussed? Any outcome?" />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving ? 'Saving…' : 'Log interaction'}
            {!saving && <ArrowRight className="size-3.5" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- visitor form dialog ----------
interface VisitorFormState {
  firstName: string
  lastName: string
  phone: string
  email: string
  address: string
  referralSource: string
  firstVisitDate: string
  createFollowUp: boolean
}
const EMPTY_FORM: VisitorFormState = {
  firstName: '', lastName: '', phone: '', email: '', address: '',
  referralSource: '', firstVisitDate: new Date().toISOString().slice(0, 10),
  createFollowUp: true,
}

function VisitorFormDialog({
  mode = 'create', visitorId, open, onOpenChange, onSaved,
}: {
  mode?: 'create' | 'edit'
  visitorId?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<VisitorFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && visitorId) {
      ;(async () => {
        try {
          const res = await fetch(`/api/visitors/${visitorId}`)
          if (!res.ok) throw new Error('Failed')
          const v = await res.json()
          setForm({
            firstName: v.firstName,
            lastName: v.lastName,
            phone: v.phone ?? '',
            email: v.email ?? '',
            address: v.address ?? '',
            referralSource: v.referralSource ?? '',
            firstVisitDate: v.firstVisitDate ? new Date(v.firstVisitDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            createFollowUp: false,
          })
        } catch {
          toast.error('Failed to load visitor')
          onOpenChange(false)
        }
      })()
    } else {
      setForm({ ...EMPTY_FORM, firstVisitDate: new Date().toISOString().slice(0, 10) })
    }
  }, [mode, visitorId, open, onOpenChange])

  const set = <K extends keyof VisitorFormState>(k: K, v: VisitorFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First and last name are required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        referralSource: form.referralSource || null,
        firstVisitDate: form.firstVisitDate ? new Date(form.firstVisitDate).toISOString() : undefined,
        ...(mode === 'create' ? { createFollowUp: form.createFollowUp } : {}),
      }
      const url = mode === 'create' ? '/api/visitors' : `/api/visitors/${visitorId}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Failed to ${mode} visitor`)
      }
      toast.success(mode === 'create' ? 'Visitor registered' : 'Visitor updated')
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Register New Visitor' : 'Edit Visitor'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Capture visitor details and optionally create an initial follow-up task.'
              : 'Update the visitor profile.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="First name *">
            <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label="Last name *">
            <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Referral source">
            <Select value={form.referralSource || 'none'} onValueChange={(v) => set('referralSource', v === 'none' ? '' : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {REFERRAL_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="First visit date">
            <Input type="date" value={form.firstVisitDate} onChange={(e) => set('firstVisitDate', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
          </div>
          {mode === 'create' && (
            <label className="sm:col-span-2 flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.createFollowUp}
                onChange={(e) => set('createFollowUp', e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span>Create initial follow-up task (due in 3 days)</span>
            </label>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving ? 'Saving…' : mode === 'create' ? 'Register visitor' : 'Save changes'}
            {!saving && <ArrowRight className="size-3.5" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- visitor detail dialog ----------
function VisitorDetailDialog({
  id, open, onOpenChange, canUpdate,
}: {
  id: string
  open: boolean
  onOpenChange: (o: boolean) => void
  canUpdate: boolean
}) {
  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ['visitor', id] as const,
    queryFn: async () => {
      const res = await fetch(`/api/visitors/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load visitor')
      }
      return res.json()
    },
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto scroll-thin">
        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <div className="py-10 text-center">
            <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium">Failed to load visitor</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : data ? (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <Avatar className="size-12">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {initials(data.firstName, data.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <DialogTitle>{fullName(data.firstName, data.lastName)}</DialogTitle>
                  <DialogDescription className="flex flex-wrap items-center gap-2 mt-1">
                    <span>Visitor since {formatDate(data.firstVisitDate)}</span>
                    {data.referralSource && <span>· via {data.referralSource}</span>}
                    {data.convertedMemberId && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300">
                        <CheckCircle2 className="size-2.5 mr-1" /> Converted
                      </Badge>
                    )}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoLine icon={Mail} label="Email" value={data.email} />
              <InfoLine icon={Phone} label="Phone" value={data.phone} />
              <InfoLine icon={MapPin} label="Address" value={data.address} />
              <InfoLine icon={CalendarDays} label="First Visit" value={formatDate(data.firstVisitDate)} />
            </section>

            <section>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Follow-up Tasks ({data.followUps?.length ?? 0})</p>
              {data.followUps && data.followUps.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto scroll-thin pr-1">
                  {data.followUps.map((f: any) => (
                    <div key={f.id} className="rounded-md border border-border/60 p-2 flex items-center justify-between">
                      <div>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[f.status] || ''}`}>{titleCase(f.status)}</Badge>
                        {f.dueDate && (
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            due {formatDate(f.dueDate)}
                          </span>
                        )}
                        {f.notes && <p className="text-xs text-muted-foreground mt-1">{f.notes}</p>}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{f.interactions} interactions</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No follow-up tasks yet.</p>
              )}
            </section>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------- follow-up detail dialog ----------
function FollowUpDetailDialog({
  id, open, onOpenChange, canUpdate, canSeeNotes,
}: {
  id: string
  open: boolean
  onOpenChange: (o: boolean) => void
  canUpdate: boolean
  canSeeNotes: boolean
}) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ['followup', id] as const,
    queryFn: async () => {
      const res = await fetch(`/api/followups/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load follow-up')
      }
      return res.json()
    },
    enabled: open,
  })

  const updateStatus = useMutation({
    mutationFn: async ({ status }: { status: string }) => {
      const res = await fetch(`/api/followups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Update failed')
      }
      return res.json()
    },
    onSuccess: (_d, vars) => {
      toast.success(`Marked as ${titleCase(vars.status === 'in_progress' ? 'in progress' : vars.status)}`)
      queryClient.invalidateQueries({ queryKey: ['followup', id] })
      queryClient.invalidateQueries({ queryKey: ['followups'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto scroll-thin">
        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <div className="py-10 text-center">
            <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium">Failed to load follow-up</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : data ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                Follow-up: {data.visitor ? fullName(data.visitor.firstName, data.visitor.lastName) : data.member ? fullName(data.member.firstName, data.member.lastName) : '—'}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[data.status] || ''}`}>{titleCase(data.status)}</Badge>
                {data.dueDate && <span>due {formatDate(data.dueDate)}</span>}
                {data.owner && <span>· assigned to {data.owner.name}</span>}
              </DialogDescription>
            </DialogHeader>

            {canSeeNotes && data.notes && (
              <div className="rounded-lg border border-border/60 p-3 text-xs">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes (restricted)</p>
                <p className="whitespace-pre-wrap">{data.notes}</p>
              </div>
            )}

            {data.outcome && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                <p className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1">Outcome</p>
                <p className="whitespace-pre-wrap">{data.outcome}</p>
              </div>
            )}

            <section>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Interaction History ({data.interactions?.length ?? 0})
              </p>
              {data.interactions && data.interactions.length > 0 ? (
                <ol className="space-y-2 max-h-60 overflow-y-auto scroll-thin pr-1">
                  {data.interactions.map((i: any) => {
                    const m = INTERACTION_METHODS.find((x) => x.value === i.method)
                    return (
                      <li key={i.id} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 size-6 rounded-md bg-primary/10 text-primary grid place-items-center shrink-0">
                          {m ? <m.icon className="size-3" /> : <PhoneCall className="size-3" />}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium">{m?.label ?? titleCase(i.method)} · <span className="text-muted-foreground">{formatDateTime(i.createdAt)}</span></p>
                          {i.notes && <p className="text-muted-foreground mt-0.5">{i.notes}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">No interactions logged yet.</p>
              )}
            </section>

            {canUpdate && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40">
                {data.status !== 'in_progress' && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => updateStatus.mutate({ status: 'in_progress' })}>
                    <CircleDot className="size-3.5" /> Mark in progress
                  </Button>
                )}
                {data.status !== 'done' && (
                  <Button variant="outline" size="sm" className="text-emerald-600 dark:text-emerald-400 gap-2" onClick={() => updateStatus.mutate({ status: 'done' })}>
                    <CheckCircle2 className="size-3.5" /> Mark done
                  </Button>
                )}
              </div>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------- helpers ----------
function InfoLine({
  icon: Icon, label, value,
}: {
  icon: typeof Mail; label: string; value?: string | null
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
