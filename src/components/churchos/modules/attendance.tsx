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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
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
  CalendarCheck, Plus, MoreHorizontal, Eye, Trash2, RefreshCw, X,
  QrCode, UserCheck, Users, TrendingUp, BarChart3, Clock, ChevronRight,
  CalendarDays, AlertTriangle, Hand,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  PageHeader, StatCard, EmptyState, Toolbar, TableSkeleton,
} from '@/components/churchos/ui'

// ---------- types ----------
interface ServiceRef {
  id: string; name: string; serviceType: string; dayOfWeek?: number | null
  startTime?: string | null; endTime?: string | null; active: boolean
  branch?: { id: string; name: string } | null; sessions: number
}
interface SessionListItem {
  id: string
  date: string
  notes?: string | null
  createdAt: string
  records: number
  service: { id: string; name: string; serviceType: string }
  branch?: { id: string; name: string } | null
}
interface SessionListResponse {
  items: SessionListItem[]
  total: number
  page: number
  pageSize: number
  services: ServiceRef[]
}
interface AttendanceStats {
  totalRecords: number
  avgPerSession: number
  lastSessionCount: number
  lastSessionLabel: string | null
  trend: {
    id: string; serviceId: string; serviceName: string
    date: string; label: string; count: number
  }[]
}
interface SessionDetail {
  id: string
  serviceId: string
  branchId?: string | null
  date: string
  notes?: string | null
  createdAt: string
  service: { id: string; name: string; serviceType: string; dayOfWeek?: number | null; startTime?: string | null; endTime?: string | null }
  branch?: { id: string; name: string } | null
  records: {
    id: string
    memberId?: string | null
    visitorName?: string | null
    checkInMethod: string
    checkInTime: string
    member?: {
      id: string; firstName: string; lastName: string
      preferredName?: string | null; memberId?: string | null; photoUrl?: string | null
    } | null
  }[]
  count: number
}
interface MemberSearchItem {
  id: string; firstName: string; lastName: string
  preferredName?: string | null; memberId?: string | null
  email?: string | null; phone?: string | null
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SERVICE_TYPE_LABELS: Record<string, string> = {
  sunday_worship: 'Sunday Worship',
  bible_study: 'Bible Study',
  prayer: 'Prayer',
  communion: 'Communion',
  special: 'Special',
}

// ---------- debounced search hook ----------
function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ---------- main module ----------
export default function AttendanceModule() {
  const { user, organization } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'attendance', 'create')
  const canDelete = can(role, 'attendance', 'delete')
  const canUpdate = can(role, 'attendance', 'update')

  const [tab, setTab] = useState<'sessions' | 'services' | 'trends'>('sessions')
  const [serviceId, setServiceId] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 12

  // Detail dialog state
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // New session dialog
  const [newSessionOpen, setNewSessionOpen] = useState(false)

  // Record attendance dialog (creates session + opens it)
  const [recordOpen, setRecordOpen] = useState(false)

  // Delete state
  const [deleteSession, setDeleteSession] = useState<{ id: string; label: string } | null>(null)

  const queryKey = useMemo(
    () => ['attendance', 'sessions', serviceId, page] as const,
    [serviceId, page],
  )

  const { data, isLoading, isError, refetch, isFetching } = useQuery<SessionListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (serviceId) params.set('serviceId', serviceId)
      const res = await fetch(`/api/attendance?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load attendance')
      }
      return res.json()
    },
  })

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  const services = data?.services ?? []
  const items = data?.items ?? []

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/attendance/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Session deleted')
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      setDeleteSession(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance & Services"
        eyebrow="Ministry"
        description={<>Track service attendance, manage check-ins, and visualise trends for{' '}<span className="font-medium text-foreground">{organization?.name ?? 'your church'}</span>.</>}
        icon={CalendarCheck}
        actions={canCreate && (
          <>
            <Button variant="outline" size="sm" onClick={() => setNewSessionOpen(true)} className="gap-2">
              <Plus className="size-4" /> New Session
            </Button>
            <Button size="sm" onClick={() => setRecordOpen(true)} className="gap-2">
              <Hand className="size-4" /> Record Attendance
            </Button>
          </>
        )}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="sessions" className="gap-1.5"><CalendarCheck className="size-3.5" /> Sessions</TabsTrigger>
          <TabsTrigger value="services" className="gap-1.5"><Users className="size-3.5" /> Services</TabsTrigger>
          <TabsTrigger value="trends" className="gap-1.5"><TrendingUp className="size-3.5" /> Trends</TabsTrigger>
        </TabsList>

        {/* Sessions Tab */}
        <TabsContent value="sessions" className="mt-4 space-y-4">
          <Card className="border-border/60">
            <CardContent className="p-4">
              <Toolbar>
                <Select value={serviceId || 'all'} onValueChange={(v) => { setServiceId(v === 'all' ? '' : ''); if (v !== 'all') setServiceId(v); setPage(1) }}>
                  <SelectTrigger className="w-full md:w-64" aria-label="Filter by service">
                    <CalendarDays className="size-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="All services" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All services</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => { setServiceId(''); setPage(1) }} className="shrink-0 gap-2">
                  <RefreshCw className="size-3.5" /> Reset
                </Button>
                <div className="md:ml-auto text-xs text-muted-foreground">
                  {data?.total ?? 0} sessions · showing {items.length}
                  {isFetching && <span className="ml-2 text-primary">· updating…</span>}
                </div>
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
                  title="Failed to load sessions"
                  action={<Button variant="outline" size="sm" className="mt-1 gap-2" onClick={() => refetch()}><RefreshCw className="size-3.5" /> Retry</Button>}
                />
              ) : items.length === 0 ? (
                <EmptyState
                  icon={CalendarCheck}
                  title="No attendance sessions yet"
                  description={serviceId ? 'Try a different service filter.' : 'Create a new session to start tracking attendance.'}
                  action={canCreate && (
                    <Button size="sm" onClick={() => setNewSessionOpen(true)} className="gap-2">
                      <Plus className="size-4" /> New Session
                    </Button>
                  )}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                      <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Service</TableHead>
                      <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Branch</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Date</TableHead>
                      <TableHead className="text-center text-xs uppercase tracking-wide text-muted-foreground font-medium">Records</TableHead>
                      <TableHead className="text-right pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((s) => (
                      <TableRow key={s.id} className="cursor-pointer hover:bg-muted/40 border-border/60" onClick={() => openDetail(s.id)}>
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-2">
                            <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/15">
                              <CalendarCheck className="size-3.5" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{s.service.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {SERVICE_TYPE_LABELS[s.service.serviceType] ?? titleCase(s.service.serviceType)}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs">
                          {s.branch?.name ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm nums">{formatDate(s.date)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-primary/8 text-primary border-primary/20 nums">
                            <Users className="size-3 mr-1" />{s.records}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8" aria-label="Session actions">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openDetail(s.id)}>
                                <Eye className="size-3.5" /> View register
                              </DropdownMenuItem>
                              {canDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setDeleteSession({
                                      id: s.id,
                                      label: `${s.service.name} · ${formatDate(s.date)}`,
                                    })}
                                  >
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
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Page <span className="font-medium text-foreground">{page}</span> of {totalPages}
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Services Tab */}
        <TabsContent value="services" className="mt-4">
          <ServicesTab services={services} canUpdate={canUpdate} loading={isLoading} />
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends" className="mt-4">
          <TrendsTab serviceId={serviceId} />
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      {detailOpen && detailId && (
        <SessionDetailDialog
          id={detailId}
          open={detailOpen}
          onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetailId(null) }}
          canCheckIn={canCreate}
        />
      )}

      {/* New Session Dialog */}
      {newSessionOpen && (
        <NewSessionDialog
          services={services}
          open={newSessionOpen}
          onOpenChange={setNewSessionOpen}
          onSaved={(id) => {
            setNewSessionOpen(false)
            queryClient.invalidateQueries({ queryKey: ['attendance'] })
            if (id) {
              setTab('sessions')
              setTimeout(() => openDetail(id), 200)
            }
          }}
        />
      )}

      {/* Record Attendance Dialog — pick session + check-in */}
      {recordOpen && (
        <RecordAttendanceDialog
          services={services}
          open={recordOpen}
          onOpenChange={setRecordOpen}
          onOpenSession={(id) => {
            setRecordOpen(false)
            openDetail(id)
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteSession}
        onOpenChange={(o) => { if (!o) setDeleteSession(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attendance session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the session for{' '}
              <strong>{deleteSession?.label}</strong> along with all attendance records.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteSession) deleteMutation.mutate(deleteSession.id)
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- services tab ----------
function ServicesTab({
  services, canUpdate, loading,
}: {
  services: ServiceRef[]
  canUpdate: boolean
  loading: boolean
}) {
  const queryClient = useQueryClient()
  const [editService, setEditService] = useState<ServiceRef | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      // No PATCH on services endpoint exists; we use a placeholder local update only.
      // Since /api/attendance only allows session/check-in management per task scope,
      // the services tab is read-only by design — toggle requires a service-edit endpoint
      // we cannot add (out of allowed files). Show info toast instead.
      toast.info('Service editing requires the dedicated services endpoint (not in this build scope).')
      return { id, active }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
    },
  })

  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Users className="size-4 text-primary" /> Church Services
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Scheduled recurring services that drive attendance tracking.
            </p>
          </div>
          {canUpdate && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="size-4" /> Add Service
            </Button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : services.length === 0 ? (
          <EmptyState icon={Users} title="No services configured yet" description="Scheduled recurring services will appear here." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {services.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-border/60 p-4 flex flex-col gap-2 hover:shadow-premium transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {SERVICE_TYPE_LABELS[s.serviceType] ?? titleCase(s.serviceType)}
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-[11px] font-medium ${s.active
                    ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground'}`}>
                    {s.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {s.dayOfWeek != null && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3" /> {DAY_LABELS[s.dayOfWeek]}
                    </span>
                  )}
                  {s.startTime && (
                    <span className="inline-flex items-center gap-1 nums">
                      <Clock className="size-3" /> {s.startTime}{s.endTime ? `–${s.endTime}` : ''}
                    </span>
                  )}
                  {s.branch && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <span className="size-1.5 rounded-full bg-primary" /> {s.branch.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1 pt-2 border-t border-border/40">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground nums">
                    {s.sessions} session{s.sessions === 1 ? '' : 's'}
                  </span>
                  {canUpdate && (
                    <Switch
                      checked={s.active}
                      onCheckedChange={(v) => toggleActive.mutate({ id: s.id, active: v })}
                      aria-label="Toggle service active"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {addOpen && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Service</DialogTitle>
                <DialogDescription>
                  This is a read-only preview. Adding new services requires the dedicated services endpoint (outside this module's allowed API files).
                </DialogDescription>
              </DialogHeader>
              <p className="text-xs text-muted-foreground">
                To add a service, please contact an administrator or use the dedicated services management module.
              </p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Close</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {editService && (
          <Dialog open={!!editService} onOpenChange={(o) => { if (!o) setEditService(null) }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editService.name}</DialogTitle>
                <DialogDescription>
                  Service details — editing requires the dedicated services endpoint.
                </DialogDescription>
              </DialogHeader>
              <pre className="text-xs bg-muted/40 p-3 rounded-md overflow-auto max-h-60">
                {JSON.stringify(editService, null, 2)}
              </pre>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Close</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- trends tab ----------
function TrendsTab({ serviceId }: { serviceId: string }) {
  const { data, isLoading, isError, refetch } = useQuery<AttendanceStats>({
    queryKey: ['attendance', 'stats', serviceId] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ stats: '1' })
      if (serviceId) params.set('serviceId', serviceId)
      const res = await fetch(`/api/attendance?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load stats')
      }
      return res.json()
    },
  })

  const chartData = useMemo(() => data?.trend ?? [], [data])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={UserCheck} label="Total Attendance" value={(data?.totalRecords ?? 0).toLocaleString()} accent="primary" />
        <StatCard icon={BarChart3} label="Avg / Session" value={(data?.avgPerSession ?? 0).toLocaleString()} accent="emerald" />
        <StatCard icon={TrendingUp} label="Last Session" value={(data?.lastSessionCount ?? 0).toLocaleString()} sub={data?.lastSessionLabel ?? undefined} accent="amber" />
      </div>

      <Card className="border-border/60">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <BarChart3 className="size-4 text-primary" /> Attendance Trend
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Last 12 sessions · per service</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-2">
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
          </div>

          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : isError ? (
            <div className="h-72 grid place-items-center text-sm text-muted-foreground">
              <AlertTriangle className="size-6 text-destructive mb-2" />
              Failed to load trend data.
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-72 grid place-items-center text-sm text-muted-foreground">
              No attendance data yet.
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--foreground)' }}
                    formatter={(v: number, _n, p) => [
                      v,
                      (p?.payload as { serviceName?: string })?.serviceName ?? 'Count',
                    ]}
                    labelFormatter={(l, p) => {
                      const it = p?.[0]?.payload as { serviceName?: string } | undefined
                      return `${l} · ${it?.serviceName ?? ''}`
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="count" name="Attendance" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- new session dialog ----------
function NewSessionDialog({
  services, open, onOpenChange, onSaved,
}: {
  services: ServiceRef[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: (id?: string) => void
}) {
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setServiceId(services[0]?.id ?? '')
    setDate(new Date().toISOString().slice(0, 10))
    setNotes('')
  }, [open, services])

  const submit = async () => {
    if (!serviceId.trim()) { toast.error('Select a service'); return }
    if (!date) { toast.error('Pick a date'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'session',
          serviceId,
          date: new Date(date).toISOString(),
          notes: notes.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to create session')
      }
      const created = await res.json()
      toast.success('Session created')
      onSaved(created.id)
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
          <DialogTitle>New Attendance Session</DialogTitle>
          <DialogDescription>Open a new attendance register for a service.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Service *">
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select service" /></SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} {s.dayOfWeek != null ? `· ${DAY_LABELS[s.dayOfWeek]}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date *">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional session notes" />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving || services.length === 0} className="gap-2">
            {saving ? 'Creating…' : 'Create session'}
            {!saving && <ChevronRight className="size-3.5" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- record attendance dialog (entry point: choose session OR new) ----------
function RecordAttendanceDialog({
  services, open, onOpenChange, onOpenSession,
}: {
  services: ServiceRef[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onOpenSession: (id: string) => void
}) {
  const [sessionId, setSessionId] = useState('')
  const [recentSessions, setRecentSessions] = useState<SessionListItem[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  useEffect(() => {
    if (!open) return
    setSessionId('')
    setLoadingSessions(true)
    ;(async () => {
      try {
        const res = await fetch('/api/attendance?pageSize=20')
        if (!res.ok) throw new Error('Failed')
        const data: SessionListResponse = await res.json()
        setRecentSessions(data.items)
      } catch {
        setRecentSessions([])
      } finally {
        setLoadingSessions(false)
      }
    })()
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Attendance</DialogTitle>
          <DialogDescription>
            Pick a recent session to open its check-in register, or create a new session first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto scroll-thin">
          {loadingSessions ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : recentSessions.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No sessions yet. Create one first.
            </div>
          ) : (
            recentSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenSession(s.id)}
                className="w-full text-left rounded-lg border border-border/60 p-3 hover:border-primary/40 hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.service.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(s.date)} · {s.branch?.name ?? 'No branch'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="bg-primary/8 text-primary border-primary/20">
                      <Users className="size-3 mr-1" />{s.records}
                    </Badge>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- session detail dialog with check-in register ----------
function SessionDetailDialog({
  id, open, onOpenChange, canCheckIn,
}: {
  id: string
  open: boolean
  onOpenChange: (o: boolean) => void
  canCheckIn: boolean
}) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery<SessionDetail>({
    queryKey: ['attendance', 'session', id] as const,
    queryFn: async () => {
      const res = await fetch(`/api/attendance/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load session')
      }
      return res.json()
    },
    enabled: open,
  })

  // Add check-in form
  const [memberSearch, setMemberSearch] = useState('')
  const [memberResults, setMemberResults] = useState<MemberSearchItem[]>([])
  const [selectedMember, setSelectedMember] = useState<MemberSearchItem | null>(null)
  const [visitorName, setVisitorName] = useState('')
  const [method, setMethod] = useState<'manual' | 'qr'>('manual')
  const [qrInput, setQrInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [searching, setSearching] = useState(false)
  const [mode, setMode] = useState<'member' | 'visitor' | 'qr'>('member')

  const debounced = useDebouncedValue(memberSearch, 350)

  useEffect(() => {
    if (!open) {
      setMemberSearch(''); setMemberResults([]); setSelectedMember(null)
      setVisitorName(''); setMethod('manual'); setQrInput(''); setMode('member')
    }
  }, [open])

  useEffect(() => {
    if (!debounced.trim() || !selectedMember?.id?.includes(debounced.trim())) {
      setSelectedMember(null)
    }
    if (!debounced.trim()) { setMemberResults([]); return }
    let cancelled = false
    setSearching(true)
    ;(async () => {
      try {
        const params = new URLSearchParams({ q: debounced, page: '1', pageSize: '8' })
        const res = await fetch(`/api/members?${params}`)
        if (!res.ok) { setMemberResults([]); return }
        const j = await res.json() as { items: MemberSearchItem[] }
        if (!cancelled) setMemberResults(j.items ?? [])
      } catch {
        if (!cancelled) setMemberResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    })()
    return () => { cancelled = true }
  }, [debounced, selectedMember])

  const doCheckIn = async (payload: {
    memberId?: string
    visitorName?: string
    checkInMethod: 'manual' | 'qr'
  }) => {
    setAdding(true)
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'checkin',
          sessionId: id,
          ...payload,
        }),
      })
      if (res.status === 409) {
        const e = await res.json().catch(() => ({}))
        toast.error(e.error || 'Already checked in')
        return false
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Check-in failed')
      }
      const r = await res.json()
      const who = r.member
        ? fullName(r.member.firstName, r.member.lastName, r.member.preferredName)
        : payload.visitorName || 'Visitor'
      toast.success(`Checked in ${who}`)
      setMemberSearch(''); setSelectedMember(null); setVisitorName(''); setQrInput('')
      queryClient.invalidateQueries({ queryKey: ['attendance', 'session', id] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Check-in failed'
      toast.error(msg)
      return false
    } finally {
      setAdding(false)
    }
  }

  const handleQrSubmit = async () => {
    const token = qrInput.trim()
    if (!token) { toast.error('Paste a member ID or token'); return }
    // Try to interpret as a memberId or id
    // First try direct member lookup
    let member: MemberSearchItem | null = null
    try {
      const params = new URLSearchParams({ q: token, page: '1', pageSize: '5' })
      const res = await fetch(`/api/members?${params}`)
      if (res.ok) {
        const j = await res.json() as { items: MemberSearchItem[] }
        // Prefer exact memberId match
        const exact = j.items.find((m) => m.memberId?.toLowerCase() === token.toLowerCase())
        member = exact ?? j.items[0] ?? null
      }
    } catch {
      // ignore
    }
    if (!member) {
      toast.error('No member found for that token')
      return
    }
    const ok = await doCheckIn({ memberId: member.id, checkInMethod: 'qr' })
    if (ok) setQrInput('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto scroll-thin">
        {isLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <div className="py-10 text-center">
            <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium">Failed to load session</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              <RefreshCw className="size-3.5 mr-1.5" /> Retry
            </Button>
          </div>
        ) : data ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <CalendarCheck className="size-5 text-primary" />
                <span>{data.service.name}</span>
                <Badge variant="outline" className="bg-primary/8 text-primary border-primary/20">
                  <Users className="size-3 mr-1" />{data.count}
                </Badge>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span>{formatDate(data.date)}</span>
                {data.branch && <span>· {data.branch.name}</span>}
                {data.service.dayOfWeek != null && (
                  <span className="text-xs">· {DAY_LABELS[data.service.dayOfWeek]}</span>
                )}
                {data.service.startTime && (
                  <span className="text-xs">· {data.service.startTime}{data.service.endTime ? `–${data.service.endTime}` : ''}</span>
                )}
              </DialogDescription>
            </DialogHeader>

            {data.notes && (
              <div className="rounded-lg border border-border/60 p-3 text-xs">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
                <p className="whitespace-pre-wrap">{data.notes}</p>
              </div>
            )}

            {/* Check-in panel */}
            {canCheckIn && (
              <section className="rounded-lg border border-border/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Add check-in
                  </p>
                  <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
                    {(['member', 'visitor', 'qr'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`text-xs px-2 py-1 rounded transition-colors ${
                          mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {m === 'member' ? 'Member' : m === 'visitor' ? 'Visitor' : 'QR'}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === 'member' && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Input
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder="Search member by name, email, phone or member ID…"
                        aria-label="Search member"
                      />
                      {memberSearch && (
                        <button
                          type="button"
                          onClick={() => { setMemberSearch(''); setSelectedMember(null); setMemberResults([]) }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
                          aria-label="Clear"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>

                    {selectedMember ? (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="size-7">
                            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                              {initials(selectedMember.firstName, selectedMember.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">
                              {fullName(selectedMember.firstName, selectedMember.lastName, selectedMember.preferredName)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{selectedMember.memberId ?? '—'}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          disabled={adding}
                          onClick={() => doCheckIn({ memberId: selectedMember.id, checkInMethod: 'manual' })}
                        >
                          {adding ? '…' : 'Check in'}
                        </Button>
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto scroll-thin border border-border/40 rounded-md divide-y divide-border/40">
                        {searching ? (
                          <div className="p-3 text-xs text-muted-foreground text-center">Searching…</div>
                        ) : memberResults.length === 0 ? (
                          <div className="p-3 text-xs text-muted-foreground text-center">
                            {memberSearch ? 'No members found.' : 'Start typing to search members.'}
                          </div>
                        ) : (
                          memberResults.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setSelectedMember(m)}
                              className="w-full text-left p-2 flex items-center gap-2 hover:bg-accent/40 transition-colors"
                            >
                              <Avatar className="size-7 shrink-0">
                                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                  {initials(m.firstName, m.lastName)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">
                                  {fullName(m.firstName, m.lastName, m.preferredName)}
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {m.memberId ?? '—'} · {m.email ?? m.phone ?? ''}
                                </p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {mode === 'visitor' && (
                  <div className="flex gap-2">
                    <Input
                      value={visitorName}
                      onChange={(e) => setVisitorName(e.target.value)}
                      placeholder="Visitor name"
                      aria-label="Visitor name"
                    />
                    <Button
                      disabled={adding || !visitorName.trim()}
                      onClick={() => doCheckIn({ visitorName: visitorName.trim(), checkInMethod: 'manual' })}
                    >
                      {adding ? '…' : 'Check in'}
                    </Button>
                  </div>
                )}

                {mode === 'qr' && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <QrCode className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-primary" />
                        <Input
                          value={qrInput}
                          onChange={(e) => setQrInput(e.target.value)}
                          placeholder="Paste member ID / QR token"
                          className="pl-9"
                          aria-label="QR token"
                          onKeyDown={(e) => { if (e.key === 'Enter' && !adding) { e.preventDefault(); handleQrSubmit() } }}
                        />
                      </div>
                      <Button disabled={adding || !qrInput.trim()} onClick={handleQrSubmit}>
                        {adding ? '…' : 'Scan'}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Simulated QR check-in — paste a member ID or token to record a QR-method check-in.
                      Server validates the member belongs to your organization.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Attendance register */}
            <section>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <UserCheck className="size-3.5" /> Attendance Register ({data.records.length})
              </p>
              {data.records.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  No check-ins recorded yet for this session.
                </div>
              ) : (
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <div className="max-h-72 overflow-y-auto scroll-thin">
                    <Table>
                      <TableHeader className="sticky top-0">
                        <TableRow className="bg-muted/40 hover:bg-muted/40 border-border/60">
                          <TableHead className="pl-3 text-xs uppercase tracking-wide text-muted-foreground font-medium">Member</TableHead>
                          <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Method</TableHead>
                          <TableHead className="text-right pr-3 text-xs uppercase tracking-wide text-muted-foreground font-medium">Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.records.map((r) => (
                          <TableRow key={r.id} className="hover:bg-muted/40 border-border/60">
                            <TableCell className="pl-3">
                              <div className="flex items-center gap-2">
                                <Avatar className="size-7">
                                  {r.member?.photoUrl && (
                                    <AvatarImage src={r.member.photoUrl} alt={fullName(r.member.firstName, r.member.lastName)} />
                                  )}
                                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                    {r.member
                                      ? initials(r.member.firstName, r.member.lastName)
                                      : 'V'}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate">
                                    {r.member
                                      ? fullName(r.member.firstName, r.member.lastName, r.member.preferredName)
                                      : r.visitorName || 'Visitor'}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {r.member?.memberId ?? '—'}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <Badge
                                variant="outline"
                                className={r.checkInMethod === 'qr'
                                  ? 'bg-primary/8 text-primary border-primary/20'
                                  : 'bg-muted text-muted-foreground'}
                              >
                                {r.checkInMethod === 'qr' ? (
                                  <><QrCode className="size-3 mr-1" /> QR</>
                                ) : (
                                  <><Hand className="size-3 mr-1" /> Manual</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right pr-3 text-xs text-muted-foreground">
                              {formatDateTime(r.checkInTime)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </section>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------- helpers ----------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  )
}
