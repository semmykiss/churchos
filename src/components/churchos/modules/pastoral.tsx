'use client'

// ChurchOS — Pastoral Care & Welfare module (Module 9)
// RESTRICTED. Pastoral-authorized roles (pastor, super_admin) see full case board with private notes.
// church_admin has view access but cannot see privateNotes. Department heads have NO pastoral access.
// Members & department_scoped roles can SUBMIT prayer/care requests (no case list).
import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { formatDate, formatDateTime, relativeTime, titleCase } from '@/lib/format'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  HeartHandshake, Plus, MoreHorizontal, Eye, Trash2, RefreshCw, AlertTriangle,
  Search, X, Lock, ShieldCheck, HandHeart, MessageCircle, Stethoscope, Home,
  Users, Clock, UserCheck, Flame, ArrowRight, EyeOff,
} from 'lucide-react'
import {
  PageHeader, StatCard, EmptyState, Toolbar, SectionCard,
  StatCardSkeleton, TableSkeleton,
} from '@/components/churchos/ui'

// ---------- types ----------
interface MemberRef { id: string; memberId?: string | null; name: string; phone?: string | null; email?: string | null }
interface UserRef { id: string; name: string; role: string }
interface PastoralCase {
  id: string
  type: string
  status: string
  priority: string
  description?: string | null
  privateNotes?: string | null
  createdAt: string
  updatedAt: string
  memberId?: string | null
  member?: MemberRef | null
  assignedToId?: string | null
  assignedTo?: UserRef | null
}
interface PastoralListResponse {
  items: PastoralCase[]
  total: number
  stats: { total: number; open: number; inProgress: number; resolved: number; urgent: number }
  staff?: UserListItem[]
}
interface PrayerRequest {
  id: string
  request: string
  private: boolean
  status: string
  createdAt: string
  memberId?: string | null
  name?: string | null
  member?: { id: string; name: string; memberId?: string | null } | null
}
interface PrayerListResponse {
  items: PrayerRequest[]
  total: number
  stats: { total: number; open: number; private: number }
}
interface MemberListItem { id: string; memberId?: string | null; firstName: string; lastName: string }
interface UserListItem { id: string; name: string; role: string }

const CASE_TYPES = [
  { value: 'prayer', label: 'Prayer', icon: MessageCircle },
  { value: 'counselling', label: 'Counselling', icon: HeartHandshake },
  { value: 'visitation', label: 'Visitation', icon: Home },
  { value: 'bereavement', label: 'Bereavement', icon: Users },
  { value: 'hospital', label: 'Hospital', icon: Stethoscope },
  { value: 'welfare', label: 'Welfare', icon: HandHeart },
]
const CASE_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

// Priority colors per Task 10-B spec:
// urgent=rose, high=amber, normal=indigo, low=slate
const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300',
  normal: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300',
  high: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  urgent: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
}
const STATUS_STYLES: Record<string, string> = {
  open: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
  in_progress: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  resolved: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  closed: 'bg-muted text-muted-foreground border-border',
}

function CaseTypeIcon({ type, className }: { type: string; className?: string }) {
  const item = CASE_TYPES.find((t) => t.value === type)
  const Icon = item?.icon ?? MessageCircle
  return <Icon className={className} />
}

// ---------- main module ----------
export default function PastoralModule() {
  const { user } = useAuth()
  const role = user?.role ?? 'member'

  const canView = can(role, 'pastoral', 'view')
  const canCreate = can(role, 'pastoral', 'create')
  const canUpdate = can(role, 'pastoral', 'update')
  const canDelete = can(role, 'pastoral', 'delete')
  // privateNotes only for pastor / super_admin (church_admin has view but no private notes)
  const canSeePrivate = role === 'pastor' || role === 'super_admin'

  const [tab, setTab] = useState<'cases' | 'prayer'>('cases')
  // Lifted state so the top-level "New Case" button can open the dialog directly.
  const [newCaseOpen, setNewCaseOpen] = useState(false)

  if (!canView) {
    return (
      <MemberSubmissionView
        canCreatePrayer={canCreate}
        canCreateCase={canCreate}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Confidential"
        title="Pastoral Care"
        description="Confidential case board, prayer requests and welfare follow-ups."
        icon={HeartHandshake}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => { setTab('cases'); setNewCaseOpen(true) }} className="gap-2">
              <Plus className="size-4" /> New Case
            </Button>
          ) : undefined
        }
      />

      {/* Privacy notice — prominent, primary-tinted like dashboard hero */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/15 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/20">
            <Lock className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              Confidential — restricted access.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Case notes are visible only to authorized pastoral staff
              {canSeePrivate ? ' (your role can view private notes).' : ' (private notes are hidden from your role).'}{' '}
              All case views are recorded in the audit log.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'cases' | 'prayer')}>
        <TabsList>
          <TabsTrigger value="cases" className="gap-1.5">
            <ShieldCheck className="size-3.5" /> Cases
          </TabsTrigger>
          <TabsTrigger value="prayer" className="gap-1.5">
            <MessageCircle className="size-3.5" /> Prayer Requests
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cases" className="mt-4">
          <CasesTab
            canCreate={canCreate}
            canUpdate={canUpdate}
            canDelete={canDelete}
            canSeePrivate={canSeePrivate}
            newCaseOpen={newCaseOpen}
            onNewCaseOpenChange={setNewCaseOpen}
          />
        </TabsContent>
        <TabsContent value="prayer" className="mt-4">
          <PrayerTab canUpdate={canUpdate} canSeePrivate={canSeePrivate} canCreate={canCreate} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- member-submission-only view ----------
function MemberSubmissionView({
  canCreatePrayer, canCreateCase,
}: {
  canCreatePrayer: boolean
  canCreateCase: boolean
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pastoral Care"
        title="Pastoral Care"
        description="Submit a prayer request or request a pastoral visit — confidential and personal."
        icon={HeartHandshake}
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/15 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/20">
            <Lock className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Your privacy matters.</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Requests go directly to the pastoral team. Only authorized pastors see the submitter name on private requests.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PrayerRequestFormCard enabled={canCreatePrayer} />
        <CareRequestFormCard enabled={canCreateCase} />
      </div>
    </div>
  )
}

function PrayerRequestFormCard({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const [request, setRequest] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!request.trim()) {
      toast.error('Please write your prayer request first')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/pastoral/prayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: request.trim(), private: isPrivate }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Submit failed')
      }
      toast.success('Prayer request submitted — our team is praying with you.')
      setRequest('')
      queryClient.invalidateQueries({ queryKey: ['pastoral', 'prayer'] })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className={enabled ? 'border-border/60' : 'opacity-60'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4 text-primary" /> Submit a Prayer Request
        </CardTitle>
        <CardDescription className="text-xs">
          Share what you would like the pastoral team to pray about.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. Please pray for healing for my mother…"
          rows={5}
          maxLength={2000}
        />
        <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
          <div>
            <Label htmlFor="pr-private" className="font-medium text-sm">Keep private</Label>
            <p className="text-xs text-muted-foreground">Only pastors will see your name</p>
          </div>
          <Switch id="pr-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
        </div>
        <Button onClick={submit} disabled={!enabled || loading || !request.trim()} className="w-full gap-2">
          {loading ? 'Submitting…' : 'Submit Prayer Request'}
        </Button>
      </CardContent>
    </Card>
  )
}

function CareRequestFormCard({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const [type, setType] = useState('prayer')
  const [priority, setPriority] = useState('normal')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!description.trim()) {
      toast.error('Please describe your request')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/pastoral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          priority,
          description: description.trim(),
          status: 'open',
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Submit failed')
      }
      toast.success('Care request submitted. The pastoral team will follow up.')
      setDescription('')
      queryClient.invalidateQueries({ queryKey: ['pastoral', 'cases'] })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className={enabled ? 'border-border/60' : 'opacity-60'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartHandshake className="size-4 text-primary" /> Request Pastoral Care
        </CardTitle>
        <CardDescription className="text-xs">
          Counselling, visitation, hospital visit or welfare support.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CASE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the situation and how we can help…"
          rows={5}
          maxLength={4000}
        />
        <Button onClick={submit} disabled={!enabled || loading || !description.trim()} className="w-full gap-2">
          {loading ? 'Submitting…' : 'Submit Care Request'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------- cases tab ----------
function CasesTab({
  canCreate, canUpdate, canDelete, canSeePrivate,
  newCaseOpen, onNewCaseOpenChange,
}: {
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canSeePrivate: boolean
  newCaseOpen: boolean
  onNewCaseOpenChange: (v: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [search, setSearch] = useState('')

  // Detail dialog
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const queryKey = useMemo(
    () => ['pastoral', 'cases', typeFilter, statusFilter, priorityFilter, search] as const,
    [typeFilter, statusFilter, priorityFilter, search],
  )

  const { data, isLoading, isError, refetch } = useQuery<PastoralListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (typeFilter) params.set('type', typeFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (priorityFilter) params.set('priority', priorityFilter)
      if (search) params.set('q', search)
      const res = await fetch(`/api/pastoral?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load cases')
      }
      return res.json()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/pastoral/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Case deleted')
      queryClient.invalidateQueries({ queryKey: ['pastoral'] })
      setDeleteId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  const stats = data?.stats ?? { total: 0, open: 0, inProgress: 0, resolved: 0, urgent: 0 }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={HeartHandshake} label="Total" value={stats.total} accent="primary" />
            <StatCard icon={Clock} label="Open" value={stats.open} accent="rose" />
            <StatCard icon={RefreshCw} label="In Progress" value={stats.inProgress} accent="amber" />
            <StatCard icon={UserCheck} label="Resolved" value={stats.resolved} accent="emerald" />
            <StatCard icon={Flame} label="Urgent" value={stats.urgent} accent="rose" />
          </>
        )}
      </div>

      {/* Filters */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <Toolbar>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by member name or description…"
                className="pl-9 h-9"
                aria-label="Search cases"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-40 h-9" aria-label="Filter by type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {CASE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-40 h-9" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {CASE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-40 h-9" aria-label="Filter by priority">
                <SelectValue placeholder="All priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canCreate && (
              <Button size="sm" onClick={() => onNewCaseOpenChange(true)} className="shrink-0 gap-2">
                <Plus className="size-4" /> New Case
              </Button>
            )}
          </Toolbar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load cases"
              description="Please try again or adjust your filters."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={HeartHandshake}
              title="No cases found"
              description={search || typeFilter || statusFilter || priorityFilter
                ? 'Try adjusting your filters.'
                : 'New cases will appear here when submitted.'}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                  <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Type</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Member</TableHead>
                  <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Priority</TableHead>
                  <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                  <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Assignee</TableHead>
                  <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Created</TableHead>
                  <TableHead className="text-right pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/40 border-border/60"
                    onClick={() => openDetail(c.id)}
                  >
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2">
                        <div className="size-7 rounded-md bg-primary/10 text-primary grid place-items-center ring-1 ring-inset ring-primary/15">
                          <CaseTypeIcon type={c.type} className="size-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-none">{titleCase(c.type)}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[180px] md:hidden">
                            {titleCase(c.priority)} · {titleCase(c.status)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.member ? (
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7">
                            <AvatarFallback className="size-7 text-[10px] bg-primary/10 text-primary">
                              {c.member.name.split(' ').map((n) => n.charAt(0)).join('').slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium leading-none">{c.member.name}</p>
                            {c.member.memberId && (
                              <p className="text-xs text-muted-foreground mt-0.5 nums">{c.member.memberId}</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline" className={`text-[11px] font-medium ${PRIORITY_STYLES[c.priority] ?? ''}`}>
                        {c.priority === 'urgent' && <Flame className="size-3 mr-1" />}
                        {titleCase(c.priority)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline" className={`text-[11px] font-medium ${STATUS_STYLES[c.status] ?? ''}`}>
                        {titleCase(c.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {c.assignedTo ? (
                        <span className="text-sm">{c.assignedTo.name}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground nums">
                      {relativeTime(c.createdAt)}
                    </TableCell>
                    <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                      {(canUpdate || canDelete) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label="Case actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(c.id)}>
                              <Eye className="size-3.5 mr-2" /> View detail
                            </DropdownMenuItem>
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setDeleteId(c.id)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="size-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      {detailOpen && detailId && (
        <CaseDetailDialog
          id={detailId}
          staff={data?.staff ?? []}
          open={detailOpen}
          onOpenChange={(o) => { if (!o) setDetailId(null); setDetailOpen(o) }}
          canUpdate={canUpdate}
          canSeePrivate={canSeePrivate}
        />
      )}

      {/* New case dialog */}
      {newCaseOpen && (
        <CaseFormDialog
          open={newCaseOpen}
          onOpenChange={onNewCaseOpenChange}
          staff={data?.staff ?? []}
          onSaved={() => {
            onNewCaseOpenChange(false)
            queryClient.invalidateQueries({ queryKey: ['pastoral'] })
          }}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete case?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the case record and its private notes. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- case detail dialog ----------
function CaseDetailDialog({
  id, staff, open, onOpenChange, canUpdate, canSeePrivate,
}: {
  id: string
  staff: UserListItem[]
  open: boolean
  onOpenChange: (v: boolean) => void
  canUpdate: boolean
  canSeePrivate: boolean
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')

  const { data, isLoading } = useQuery<PastoralCase & { stats?: any }>({
    queryKey: ['pastoral', 'case', id] as const,
    queryFn: async () => {
      const res = await fetch(`/api/pastoral/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load case')
      }
      return res.json()
    },
    enabled: open,
  })

  const updateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`/api/pastoral/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Update failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pastoral'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateStatus = (newStatus: string) => {
    updateMutation.mutate(
      { status: newStatus },
      { onSuccess: () => toast.success('Status updated') },
    )
  }
  const updateAssignee = (newAssigneeId: string) => {
    updateMutation.mutate(
      { assignedToId: newAssigneeId || null },
      { onSuccess: () => toast.success('Assignee updated') },
    )
  }
  const appendNote = () => {
    if (!note.trim()) {
      toast.error('Note cannot be empty')
      return
    }
    updateMutation.mutate(
      { appendNote: note.trim() },
      {
        onSuccess: () => {
          toast.success('Note added')
          setNote('')
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {data && <CaseTypeIcon type={data.type} className="size-4 text-primary" />}
            {data ? titleCase(data.type) + ' Case' : 'Loading…'}
          </DialogTitle>
          <DialogDescription>
            Created {data ? formatDateTime(data.createdAt) : '—'} · Updated {data ? relativeTime(data.updatedAt) : '—'}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Meta badges */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={`text-[11px] font-medium ${STATUS_STYLES[data.status] ?? ''}`}>
                {titleCase(data.status)}
              </Badge>
              <Badge variant="outline" className={`text-[11px] font-medium ${PRIORITY_STYLES[data.priority] ?? ''}`}>
                {data.priority === 'urgent' && <Flame className="size-3 mr-1" />}
                {titleCase(data.priority)} priority
              </Badge>
              {data.assignedTo && (
                <Badge variant="outline" className="text-[11px] font-medium bg-muted text-muted-foreground">
                  Assigned: {data.assignedTo.name}
                </Badge>
              )}
            </div>

            {/* Member */}
            {data.member && (
              <div className="rounded-xl border border-border/60 p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Member</p>
                <div className="flex items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback className="size-8 text-xs bg-primary/10 text-primary">
                      {data.member.name.split(' ').map((n) => n.charAt(0)).join('').slice(0, 2).toUpperCase() || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{data.member.name}</p>
                    {data.member.phone && <p className="text-xs text-muted-foreground nums">{data.member.phone}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <Label className="text-xs text-muted-foreground">Description</Label>
              <p className="text-sm mt-1 whitespace-pre-wrap rounded-xl border border-border/60 p-3 bg-card">
                {data.description || 'No description provided.'}
              </p>
            </div>

            {/* Private notes */}
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Lock className="size-3" /> Private case notes
                {!canSeePrivate && <span className="text-rose-600 dark:text-rose-400">(hidden — pastor only)</span>}
              </Label>
              {canSeePrivate ? (
                <div className="mt-1 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm whitespace-pre-wrap font-mono">
                  {data.privateNotes || (
                    <span className="text-muted-foreground italic">No private notes recorded yet.</span>
                  )}
                </div>
              ) : (
                <div className="mt-1 rounded-xl border border-border/60 p-3 text-sm bg-muted/40 flex items-center gap-2 text-muted-foreground">
                  <EyeOff className="size-3.5" /> Private notes are restricted to authorized pastoral staff.
                </div>
              )}
            </div>

            {/* Update controls */}
            {canUpdate && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select
                      value={data.status}
                      onValueChange={updateStatus}
                      disabled={updateMutation.isPending}
                    >
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CASE_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Assignee</Label>
                    <Select
                      value={data.assignedToId ?? '__none'}
                      onValueChange={(v) => updateAssignee(v === '__none' ? '' : v)}
                      disabled={updateMutation.isPending}
                    >
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Unassigned</SelectItem>
                        {staff.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Add note (only for pastor/super_admin) */}
                {canSeePrivate && (
                  <div>
                    <Label className="text-xs flex items-center gap-1.5">
                      <Lock className="size-3" /> Add private note
                    </Label>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add a confidential note (timestamped + signed)…"
                      rows={3}
                      className="mt-1 font-mono text-sm"
                    />
                    <Button size="sm" className="mt-2 gap-2" onClick={appendNote} disabled={updateMutation.isPending || !note.trim()}>
                      <Plus className="size-3.5" /> Append note
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- case form dialog ----------
function CaseFormDialog({
  open, onOpenChange, staff, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  staff: UserListItem[]
  onSaved: () => void
}) {
  const [memberId, setMemberId] = useState('')
  const [type, setType] = useState('prayer')
  const [priority, setPriority] = useState('normal')
  const [description, setDescription] = useState('')
  const [assignedToId, setAssignedToId] = useState('')
  const [loading, setLoading] = useState(false)
  const [members, setMembers] = useState<MemberListItem[]>([])

  useEffect(() => {
    if (open) {
      fetch('/api/members?pageSize=100')
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.items) {
            setMembers(d.items.map((m: any) => ({
              id: m.id, memberId: m.memberId, firstName: m.firstName, lastName: m.lastName,
            })))
          }
        })
        .catch(() => {})
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setMemberId('')
      setType('prayer')
      setPriority('normal')
      setDescription('')
      setAssignedToId('')
    }
  }, [open])

  const save = async () => {
    if (!description.trim()) {
      toast.error('Description is required')
      return
    }
    setLoading(true)
    try {
      const payload: any = {
        type,
        priority,
        description: description.trim(),
        status: 'open',
      }
      if (memberId) payload.memberId = memberId
      if (assignedToId) payload.assignedToId = assignedToId
      const res = await fetch('/api/pastoral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Save failed')
      }
      toast.success('Case created')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>New Pastoral Case</DialogTitle>
          <DialogDescription>
            Open a confidential case for a member. Private notes can be added after creation by authorized pastoral staff.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="cf-member" className="text-sm font-medium">Member</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger id="cf-member" className="mt-1.5 h-9"><SelectValue placeholder="Select member (optional)" /></SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.firstName} {m.lastName}{m.memberId ? ` — ${m.memberId}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cf-type" className="text-sm font-medium">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="cf-type" className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CASE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cf-priority" className="text-sm font-medium">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="cf-priority" className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="cf-desc" className="text-sm font-medium">Description <span className="text-destructive">*</span></Label>
            <Textarea
              id="cf-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the situation…"
              rows={5}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="cf-assign" className="text-sm font-medium">Assign to</Label>
            <Select value={assignedToId || '__none'} onValueChange={(v) => setAssignedToId(v === '__none' ? '' : v)}>
              <SelectTrigger id="cf-assign" className="mt-1.5 h-9"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Unassigned</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({titleCase(s.role)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={save} disabled={loading || !description.trim()} className="gap-2">
            {loading ? 'Creating…' : 'Create case'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- prayer tab ----------
function PrayerTab({
  canUpdate, canSeePrivate, canCreate,
}: {
  canUpdate: boolean
  canSeePrivate: boolean
  canCreate: boolean
}) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery<PrayerListResponse>({
    queryKey: ['pastoral', 'prayer', 'list'] as const,
    queryFn: async () => {
      const res = await fetch('/api/pastoral/prayer?pageSize=100')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load prayer requests')
      }
      return res.json()
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch('/api/pastoral/prayer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Update failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['pastoral', 'prayer'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Prayer Requests</h3>
          <p className="text-xs text-muted-foreground">
            {canSeePrivate
              ? 'Private requests show submitter names to pastors only.'
              : 'Private requests are shown anonymously to your role.'}
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="size-4" /> New Prayer Request
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={MessageCircle} label="Total" value={data?.stats.total ?? 0} accent="primary" />
            <StatCard icon={Clock} label="Open" value={data?.stats.open ?? 0} accent="rose" />
            <StatCard icon={Lock} label="Private" value={data?.stats.private ?? 0} accent="violet" />
          </>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load prayer requests"
              description="Please try again."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={MessageCircle}
              title="No prayer requests yet"
              description="New requests will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.items.map((p) => (
            <Card key={p.id} className={`border-border/60 rounded-xl ${p.private ? 'ring-1 ring-inset ring-violet-500/20' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`size-8 rounded-md grid place-items-center shrink-0 ring-1 ring-inset ${p.private ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/15' : 'bg-primary/10 text-primary ring-primary/15'}`}>
                    {p.private ? <Lock className="size-4" /> : <MessageCircle className="size-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant="outline" className={`text-[11px] font-medium ${STATUS_STYLES[p.status] ?? ''}`}>{titleCase(p.status)}</Badge>
                      {p.private && (
                        <Badge variant="outline" className="text-[11px] font-medium bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300">
                          Private
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{p.request}</p>
                    <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-border/60">
                      <div>
                        <p className="text-xs font-medium">
                          {p.private && !canSeePrivate ? 'Anonymous' : (p.name ?? p.member?.name ?? 'Anonymous')}
                        </p>
                        <p className="text-xs text-muted-foreground nums">{relativeTime(p.createdAt)} · {formatDate(p.createdAt)}</p>
                      </div>
                      {canUpdate && p.status !== 'closed' && (
                        <Select
                          value={p.status}
                          onValueChange={(v) => updateStatus.mutate({ id: p.id, status: v })}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CASE_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {addOpen && (
        <PrayerFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['pastoral', 'prayer'] })
          }}
        />
      )}
    </div>
  )
}

function PrayerFormDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [request, setRequest] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setRequest('')
      setIsPrivate(false)
    }
  }, [open])

  const save = async () => {
    if (!request.trim()) {
      toast.error('Prayer request is required')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/pastoral/prayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: request.trim(), private: isPrivate }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Submit failed')
      }
      toast.success('Prayer request submitted')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>New Prayer Request</DialogTitle>
          <DialogDescription>Submit a prayer request to the pastoral team.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="pf-request" className="text-sm font-medium">Prayer Request <span className="text-destructive">*</span></Label>
            <Textarea
              id="pf-request"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={5}
              className="mt-1.5"
              placeholder="Share your prayer request…"
              maxLength={2000}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
            <div>
              <Label htmlFor="pf-private" className="font-medium text-sm">Keep private</Label>
              <p className="text-xs text-muted-foreground">Only authorized pastors see your name</p>
            </div>
            <Switch id="pf-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={save} disabled={loading || !request.trim()} className="gap-2">
            {loading ? 'Submitting…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
