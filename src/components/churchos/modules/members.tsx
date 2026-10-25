'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import {
  formatCurrency, formatDate, formatDateTime, initials, fullName, titleCase,
} from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationPrevious, PaginationNext, PaginationEllipsis,
} from '@/components/ui/pagination'
import {
  Users, UserCheck, UserPlus, HeartHandshake, Search, Filter, Download,
  MoreHorizontal, Eye, Pencil, Trash2, Plus, X, Phone, Mail, MapPin,
  CalendarDays, Droplet, AlertTriangle, Church, Layers, ArrowRight, RefreshCw,
  Network, Heart, Briefcase, FileText, ShieldCheck,
} from 'lucide-react'
import {
  PageHeader, StatCard, EmptyState, Toolbar,
  TableSkeleton, StatCardSkeleton,
} from '@/components/churchos/ui'

// ---------- types ----------
interface DeptRef { id: string; name: string; color?: string | null; role?: string }
interface BranchRef { id: string; name: string; location?: string | null }
interface MemberListItem {
  id: string; memberId?: string | null; firstName: string; lastName: string
  preferredName?: string | null; email?: string | null; phone?: string | null
  photoUrl?: string | null; status: string; gender?: string | null
  dateJoined: string; baptized: boolean; branch?: BranchRef | null
  departments: DeptRef[]
}
interface MembersListResponse {
  items: MemberListItem[]
  total: number; page: number; pageSize: number
  stats: { total: number; active: number; visitors: number; followUp: number }
}
interface MemberDetail {
  id: string; memberId?: string | null
  firstName: string; lastName: string; middleName?: string | null
  preferredName?: string | null
  email?: string | null; phone?: string | null; photoUrl?: string | null
  gender?: string | null; dateOfBirth?: string | null
  address?: string | null; emergencyName?: string | null; emergencyPhone?: string | null
  status: string; isMinor: boolean; guardianName?: string | null
  dateJoined: string; baptized: boolean; baptizedDate?: string | null
  notes?: string | null; privateNotes?: string | null
  branch?: BranchRef | null; departments: (DeptRef & { joinedAt?: string })[]
  statusHistory: { id: string; status: string; reason?: string | null; changedAt: string }[]
  attendanceCount: number
  donations: { total: number; count: number } | null
  followUpOwner?: { id: string; name: string; email: string } | null
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'visitor', label: 'Visitor' },
  { value: 'new_convert', label: 'New Convert' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'transferred', label: 'Transferred' },
  { value: 'deceased', label: 'Deceased' },
]

const STATUS_STYLES: Record<string, string> = {
  visitor: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300',
  new_convert: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  follow_up: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  active: 'bg-primary/10 text-primary border-primary/20',
  inactive: 'bg-muted text-muted-foreground border-border',
  transferred: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300',
  deceased: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
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
export default function MembersModule() {
  const { user, organization, detailRef, clearDetail } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  // Permissions
  const canCreate = can(role, 'members', 'create')
  const canUpdate = can(role, 'members', 'update')
  const canDelete = can(role, 'members', 'delete')
  const canExport = can(role, 'members', 'export')
  const canViewFinance = can(role, 'finance', 'view')
  const isMemberRole = role === 'member'

  // Filter state
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterMarital, setFilterMarital] = useState('')
  const [filterWorker, setFilterWorker] = useState('')
  const [filterGender, setFilterGender] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const debouncedSearch = useDebouncedValue(search, 350)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [debouncedSearch, status, filterDept, filterMarital, filterWorker, filterGender])

  // Fetch departments for the filter dropdown
  const deptsQuery = useQuery<{ items: { id: string; name: string }[] }>({
    queryKey: ['departments', 'filter'],
    queryFn: async () => {
      const res = await fetch('/api/departments')
      if (!res.ok) return { items: [] }
      const d = await res.json()
      return { items: (d.items ?? d ?? []).map((x: any) => ({ id: x.id, name: x.name })) }
    },
    staleTime: 60_000,
  })
  const departments = deptsQuery.data?.items ?? []

  const queryKey = useMemo(
    () => ['members', 'list', debouncedSearch, status, filterDept, filterMarital, filterWorker, filterGender, page, pageSize] as const,
    [debouncedSearch, status, filterDept, filterMarital, filterWorker, filterGender, page],
  )

  const { data, isLoading, isError, refetch, isFetching } = useQuery<MembersListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (status) params.set('status', status)
      if (filterDept) params.set('departmentId', filterDept)
      if (filterMarital) params.set('maritalStatus', filterMarital)
      if (filterWorker) params.set('isWorker', filterWorker)
      if (filterGender) params.set('gender', filterGender)
      const res = await fetch(`/api/members?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load members')
      }
      return res.json()
    },
  })

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  // Detail dialog state
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // Add/Edit dialog state
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  // Delete confirmation state
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  // Open the member detail dialog when a notification is clicked (detailRef).
  useEffect(() => {
    if (!detailRef || detailRef.module !== 'members') return
    const refId = detailRef.refId
    // Defer setState to avoid the synchronous-setState-in-effect lint rule.
    const t = setTimeout(() => {
      if (refId) openDetail(refId)
      clearDetail()
    }, 0)
    return () => clearTimeout(t)
  }, [detailRef?.nonce, clearDetail, openDetail])

  const openEdit = useCallback((id: string) => {
    setEditId(id)
    setEditOpen(true)
  }, [])

  const openDelete = useCallback((id: string, name: string) => {
    setDeleteId(id)
    setDeleteName(name)
  }, [])

  const resetFilters = () => {
    setSearch('')
    setStatus('')
    setFilterDept('')
    setFilterMarital('')
    setFilterWorker('')
    setFilterGender('')
    setPage(1)
  }

  // CSV export
  const exportCsv = async () => {
    try {
      toast.loading('Preparing export…', { id: 'export' })
      const params = new URLSearchParams({ page: '1', pageSize: '500' })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (status) params.set('status', status)
      const res = await fetch(`/api/members?${params}`)
      if (!res.ok) throw new Error('Failed to export')
      const payload: MembersListResponse = await res.json()
      const header = ['Member ID', 'First Name', 'Last Name', 'Status', 'Email', 'Phone', 'Branch', 'Departments', 'Date Joined']
      const rows = payload.items.map((m) => [
        m.memberId ?? '',
        m.firstName,
        m.lastName,
        m.status,
        m.email ?? '',
        m.phone ?? '',
        m.branch?.name ?? '',
        m.departments.map((d) => d.name).join('; '),
        formatDate(m.dateJoined),
      ])
      const csv = [header, ...rows]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `members-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${payload.items.length} members`, { id: 'export' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      toast.error(msg, { id: 'export' })
    }
  }

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/members/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Member deleted')
      queryClient.invalidateQueries({ queryKey: ['members'] })
      setDeleteId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const stats = data?.stats ?? { total: 0, active: 0, visitors: 0, followUp: 0 }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        eyebrow="People"
        description={isMemberRole
          ? `Browse the ${organization?.name ?? 'church'} member directory.`
          : 'Manage your church membership registry — profiles, status, departments.'}
        icon={Users}
        actions={
          <>
            {canExport && (
              <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
                <Download className="size-4" /> Export CSV
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                <Plus className="size-4" /> Add Member
              </Button>
            )}
          </>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={Users} label="Total" value={stats.total.toLocaleString()} accent="primary" />
            <StatCard icon={UserCheck} label="Active" value={stats.active.toLocaleString()} accent="emerald" />
            <StatCard icon={UserPlus} label="Visitors" value={stats.visitors.toLocaleString()} accent="violet" />
            <StatCard icon={HeartHandshake} label="Follow-up" value={stats.followUp.toLocaleString()} accent="amber" />
          </>
        )}
      </div>

      {/* Filter bar */}
      <Card className="glass border-transparent">
        <CardContent className="p-4">
          <Toolbar>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, phone or member ID…"
                className="pl-9"
                aria-label="Search members"
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
            <Select value={status} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-48" aria-label="Filter by status">
                <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value || 'all'} value={s.value || 'all'}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Department filter */}
            <Select value={filterDept || 'all'} onValueChange={(v) => setFilterDept(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-44" aria-label="Filter by department">
                <Network className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Marital status filter */}
            <Select value={filterMarital || 'all'} onValueChange={(v) => setFilterMarital(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-40" aria-label="Filter by marital status">
                <Heart className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All marital" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All marital</SelectItem>
                <SelectItem value="single">Single</SelectItem>
                <SelectItem value="married">Married</SelectItem>
                <SelectItem value="divorced">Divorced</SelectItem>
                <SelectItem value="widowed">Widowed</SelectItem>
              </SelectContent>
            </Select>
            {/* Worker filter */}
            <Select value={filterWorker || 'all'} onValueChange={(v) => setFilterWorker(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-36" aria-label="Filter by worker status">
                <Briefcase className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All members" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All members</SelectItem>
                <SelectItem value="true">Workers only</SelectItem>
                <SelectItem value="false">Non-workers</SelectItem>
              </SelectContent>
            </Select>
            {/* Gender filter */}
            <Select value={filterGender || 'all'} onValueChange={(v) => setFilterGender(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-36" aria-label="Filter by gender">
                <Users className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All genders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0 gap-2">
              <RefreshCw className="size-3.5" /> Reset
            </Button>
          </Toolbar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass border-transparent overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load members"
              description="Please try again or adjust your filters."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No members found"
              description={search || status
                ? 'Try changing your search or filters.'
                : 'Get started by adding your first member.'}
              action={canCreate && (
                <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                  <Plus className="size-4" /> Add Member
                </Button>
              )}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 backdrop-blur-sm hover:bg-muted/40 border-border/60">
                    <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Member</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Contact</TableHead>
                    <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Branch</TableHead>
                    <TableHead className="hidden xl:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Departments</TableHead>
                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Joined</TableHead>
                    <TableHead className="text-right pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((m) => (
                    <TableRow
                      key={m.id}
                      className="cursor-pointer hover:bg-muted/40 border-border/60"
                      onClick={() => openDetail(m.id)}
                    >
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9 ring-2 ring-primary/15">
                            {m.photoUrl && <AvatarImage src={m.photoUrl} alt={fullName(m.firstName, m.lastName)} />}
                            <AvatarFallback className="size-9 text-xs bg-gradient-to-br from-primary/15 to-primary/5 text-primary font-semibold">
                              {initials(m.firstName, m.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {fullName(m.firstName, m.lastName, m.preferredName)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {m.memberId ?? '—'}
                              {m.baptized && <span className="ml-1.5 text-primary">· Baptized</span>}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={m.status} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="text-xs space-y-0.5">
                          {m.phone && <div className="truncate">{m.phone}</div>}
                          {m.email ? (
                            <div className="truncate text-muted-foreground">{m.email}</div>
                          ) : (
                            <div className="text-muted-foreground">—</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {m.branch ? (
                          <span className="text-xs inline-flex items-center gap-1.5">
                            <Church className="size-3 text-muted-foreground" />
                            {m.branch.name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {m.departments.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            m.departments.slice(0, 2).map((d) => (
                              <span
                                key={d.id}
                                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/40"
                              >
                                <span className="size-1.5 rounded-full" style={{ background: d.color || 'var(--primary)' }} />
                                {d.name}
                              </span>
                            ))
                          )}
                          {m.departments.length > 2 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{m.departments.length - 2}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground nums">
                        {formatDate(m.dateJoined)}
                      </TableCell>
                      <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label="Member actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(m.id)}>
                              <Eye className="size-3.5" /> View profile
                            </DropdownMenuItem>
                            {canUpdate && (
                              <DropdownMenuItem onClick={() => openEdit(m.id)}>
                                <Pencil className="size-3.5" /> Edit
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => openDelete(m.id, fullName(m.firstName, m.lastName))}
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

              {/* Pagination footer */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-4 border-t border-border/60">
                <p className="text-xs text-muted-foreground">
                  Showing <span className="font-medium text-foreground nums">{(page - 1) * pageSize + 1}</span>
                  {'–'}
                  <span className="font-medium text-foreground nums">{Math.min(page * pageSize, data.total)}</span>
                  {' '}of <span className="font-medium text-foreground nums">{data.total}</span> members
                  {isFetching && <span className="ml-2 text-primary">· updating…</span>}
                </p>
                <Pagination className="md:justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => { e.preventDefault(); if (page > 1) setPage(page - 1) }}
                        aria-disabled={page === 1}
                        className={page === 1 ? 'pointer-events-none opacity-50' : ''}
                      />
                    </PaginationItem>
                    {renderPageButtons(page, totalPages).map((p, i) =>
                      p === '...' ? (
                        <PaginationItem key={`e${i}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            href="#"
                            isActive={p === page}
                            onClick={(e) => { e.preventDefault(); setPage(p) }}
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => { e.preventDefault(); if (page < totalPages) setPage(page + 1) }}
                        aria-disabled={page === totalPages}
                        className={page === totalPages ? 'pointer-events-none opacity-50' : ''}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      {detailOpen && detailId && (
        <MemberDetailDialog
          id={detailId}
          open={detailOpen}
          onOpenChange={(o) => {
            setDetailOpen(o)
            if (!o) setDetailId(null)
          }}
          canEdit={canUpdate}
          canViewFinance={canViewFinance}
          currency={organization?.currency}
          onEdit={() => {
            setDetailOpen(false)
            openEdit(detailId)
          }}
        />
      )}

      {/* Add Dialog */}
      {addOpen && (
        <MemberFormDialog
          mode="create"
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['members'] })
          }}
          currency={organization?.currency}
        />
      )}

      {/* Edit Dialog */}
      {editOpen && editId && (
        <MemberFormDialog
          mode="edit"
          memberId={editId}
          open={editOpen}
          onOpenChange={(o) => {
            setEditOpen(o)
            if (!o) setEditId(null)
          }}
          onSaved={() => {
            setEditOpen(false)
            queryClient.invalidateQueries({ queryKey: ['members'] })
            queryClient.invalidateQueries({ queryKey: ['member', editId] })
          }}
          currency={organization?.currency}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete member?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteName}</strong> and remove their attendance,
              memberships, and donations records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteId) deleteMutation.mutate(deleteId)
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

// ---------- helpers ----------
function renderPageButtons(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | '...')[] = [1]
  if (current > 3) out.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) out.push(i)
  if (current < total - 2) out.push('...')
  out.push(total)
  return out
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] || 'bg-muted text-muted-foreground border-border'
  return (
    <Badge variant="outline" className={`text-[11px] font-medium ${cls}`}>
      {titleCase(status)}
    </Badge>
  )
}

// ---------- detail dialog ----------
function MemberDetailDialog({
  id, open, onOpenChange, canEdit, canViewFinance, currency, onEdit,
}: {
  id: string
  open: boolean
  onOpenChange: (o: boolean) => void
  canEdit: boolean
  canViewFinance: boolean
  currency?: string
  onEdit: () => void
}) {
  const { data, isLoading, isError } = useQuery<MemberDetail>({
    queryKey: ['member', id],
    queryFn: async () => {
      const res = await fetch(`/api/members/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load member')
      }
      return res.json()
    },
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto scroll-thin glass-strong border-transparent">
        {isLoading ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <div className="py-10 text-center">
            <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium">Failed to load member</p>
          </div>
        ) : data ? (
          <>
            <DialogHeader>
              {/* Aurora hero header */}
              <div className="relative overflow-hidden rounded-2xl aurora-hero glass p-5 -m-2 mb-1">
                <div className="flex items-start gap-4">
                  <Avatar className="size-16 shrink-0 ring-2 ring-primary/30 shadow-lg">
                    {data.photoUrl && <AvatarImage src={data.photoUrl} alt={fullName(data.firstName, data.lastName)} />}
                    <AvatarFallback className="text-lg bg-gradient-to-br from-primary/25 to-primary/5 text-primary font-bold">
                      {initials(data.firstName, data.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="text-xl tracking-tight">
                      {fullName(data.firstName, data.lastName, data.preferredName)}
                    </DialogTitle>
                    <DialogDescription className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="kbd">{data.memberId ?? 'No member ID'}</span>
                      <StatusBadge status={data.status} />
                      {data.baptized && (
                        <Badge variant="outline" className="text-[10px] bg-primary/8 border-primary/20 text-primary">
                          <Droplet className="size-2.5" /> Baptized
                        </Badge>
                      )}
                    </DialogDescription>
                  </div>
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={onEdit} className="gap-2 shrink-0">
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                  )}
                </div>
              </div>
            </DialogHeader>

            {/* Contact */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <InfoLine icon={Mail} label="Email" value={data.email} />
              <InfoLine icon={Phone} label="Phone" value={data.phone} />
              <InfoLine icon={MapPin} label="Address" value={data.address} />
              <InfoLine icon={Church} label="Branch" value={data.branch?.name} />
              <InfoLine icon={CalendarDays} label="Date Joined" value={formatDate(data.dateJoined)} />
              <InfoLine icon={CalendarDays} label="Date of Birth" value={data.dateOfBirth ? formatDate(data.dateOfBirth) : null} />
              <InfoLine icon={AlertTriangle} label="Emergency" value={data.emergencyName ? `${data.emergencyName} (${data.emergencyPhone ?? '—'})` : null} />
              <InfoLine icon={Droplet} label="Baptized" value={data.baptized ? (data.baptizedDate ? formatDate(data.baptizedDate) : 'Yes') : 'No'} />
            </section>

            {/* Departments */}
            <section>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Layers className="size-3.5" /> Departments
              </p>
              {data.departments.length === 0 ? (
                <p className="text-xs text-muted-foreground">Not assigned to any department.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.departments.map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg glass-subtle">
                      <span className="size-2 rounded-full ring-2 ring-background/60" style={{ background: d.color || 'var(--primary)' }} />
                      {d.name}
                      {d.role && d.role !== 'member' && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1">{titleCase(d.role)}</Badge>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Stats grid */}
            <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatBox label="Attendance" value={String(data.attendanceCount)} accent="text-emerald-700 dark:text-emerald-300" />
              {canViewFinance && data.donations && (
                <StatBox label="Total Giving" value={formatCurrency(data.donations.total, currency)} accent="text-amber-700 dark:text-amber-300" />
              )}
              {canViewFinance && data.donations && (
                <StatBox label="Donations" value={String(data.donations.count)} accent="text-primary" />
              )}
            </section>

            {/* Notes */}
            {(data.notes || (canEdit && data.privateNotes)) && (
              <section className="space-y-2">
                {data.notes && (
                  <div className="rounded-xl glass-subtle p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{data.notes}</p>
                  </div>
                )}
                {canEdit && data.privateNotes && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">Private Notes (restricted)</p>
                    <p className="text-xs whitespace-pre-wrap">{data.privateNotes}</p>
                  </div>
                )}
              </section>
            )}

            {/* Status history */}
            <section>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Status History</p>
              {data.statusHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground">No status changes recorded.</p>
              ) : (
                <ol className="space-y-2 max-h-44 overflow-y-auto scroll-thin pr-1">
                  {data.statusHistory.map((h) => (
                    <li key={h.id} className="flex items-start gap-2.5 text-xs rounded-lg glass-subtle px-3 py-2">
                      <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0 shadow-[0_0_8px_var(--primary)]" />
                      <div className="min-w-0">
                        <p>
                          <StatusBadge status={h.status} />
                          <span className="ml-2 text-muted-foreground">{formatDateTime(h.changedAt)}</span>
                        </p>
                        {h.reason && <p className="text-muted-foreground mt-0.5">{h.reason}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function InfoLine({
  icon: Icon, label, value,
}: {
  icon: typeof Mail; label: string; value?: string | null
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl glass-subtle px-3 py-2.5">
      <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/15">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{value || <span className="text-muted-foreground font-normal">—</span>}</p>
      </div>
    </div>
  )
}

function StatBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`rounded-xl glass p-3.5 aurora-stat-card ${accent}`}>
      <p className="text-[10px] uppercase font-semibold tracking-wider opacity-80">{label}</p>
      <p className="text-xl font-bold mt-1 nums aurora-glow">{value}</p>
    </div>
  )
}

// ---------- form dialog (create / edit) ----------
interface FormState {
  // Personal
  firstName: string
  middleName: string
  lastName: string
  preferredName: string
  gender: string
  dateOfBirth: string
  placeOfBirth: string
  nationality: string
  stateOfOrigin: string
  occupation: string
  employer: string
  educationLevel: string
  languages: string
  // Contact
  phone: string
  phoneSecondary: string
  email: string
  address: string
  city: string
  stateProvince: string
  country: string
  postalCode: string
  // Emergency
  emergencyName: string
  emergencyPhone: string
  emergencyRelationship: string
  // Church
  status: string
  membershipType: string
  orgUnitType: string
  memberId: string
  formerChurch: string
  communicationPreference: string
  photoConsent: boolean
  dataConsent: boolean
  // Family
  householdName: string
  headOfHousehold: boolean
  spouseName: string
  spouseMemberId: string
  // Notes
  notes: string
  privateNotes: string
}

const EMPTY_FORM: FormState = {
  firstName: '', middleName: '', lastName: '', preferredName: '', gender: '',
  dateOfBirth: '', placeOfBirth: '', nationality: '', stateOfOrigin: '',
  occupation: '', employer: '', educationLevel: '', languages: '',
  phone: '', phoneSecondary: '', email: '', address: '', city: '', stateProvince: '',
  country: '', postalCode: '',
  emergencyName: '', emergencyPhone: '', emergencyRelationship: '',
  status: 'visitor', membershipType: 'member', orgUnitType: '', memberId: '',
  formerChurch: '', communicationPreference: 'sms', photoConsent: false, dataConsent: false,
  householdName: '', headOfHousehold: false, spouseName: '', spouseMemberId: '',
  notes: '', privateNotes: '',
}

function MemberFormDialog({
  mode, memberId, open, onOpenChange, onSaved, currency: _currency,
}: {
  mode: 'create' | 'edit'
  memberId?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
  currency?: string
}) {
  const { user } = useAuth()
  const role = user?.role ?? 'member'
  const canEditStatus = can(role, 'members', 'update')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [createLogin, setCreateLogin] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginRole, setLoginRole] = useState('member')

  // Load branches (small list, no permissions endpoint exists — use dashboard-friendly fetch via /api/me? No, fetch directly)
  // Branches are referenced in member PATCH, so we provide a static fetch.
  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const res = await fetch('/api/members?pageSize=1')
        // We don't have a /api/branches endpoint — branch is optional. Provide a graceful fallback list using known seed branch IDs.
        setBranches([
          { id: 'branch-main', name: 'Main Campus — Lagos' },
          { id: 'branch-east', name: 'East Campus — Lekki' },
        ])
        void res
      } catch {
        setBranches([])
      }
    })()
  }, [open])

  // For edit mode, load the existing member
  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && memberId) {
      ;(async () => {
        try {
          const res = await fetch(`/api/members/${memberId}`)
          if (!res.ok) throw new Error('Failed')
          const m: MemberDetail = await res.json()
          setForm({
            firstName: m.firstName,
            lastName: m.lastName,
            email: m.email ?? '',
            phone: m.phone ?? '',
            gender: m.gender ?? '',
            dateOfBirth: m.dateOfBirth ? new Date(m.dateOfBirth).toISOString().slice(0, 10) : '',
            status: m.status,
            branchId: m.branch?.id ?? '',
            baptized: m.baptized,
            baptizedDate: m.baptizedDate ? new Date(m.baptizedDate).toISOString().slice(0, 10) : '',
            address: m.address ?? '',
            emergencyName: m.emergencyName ?? '',
            emergencyPhone: m.emergencyPhone ?? '',
            notes: m.notes ?? '',
            privateNotes: m.privateNotes ?? '',
            memberId: m.memberId ?? '',
          })
        } catch {
          toast.error('Failed to load member for editing')
          onOpenChange(false)
        }
      })()
    } else {
      setForm(EMPTY_FORM)
    }
  }, [mode, memberId, open, onOpenChange])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First and last name are required')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        // Personal
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        lastName: form.lastName.trim(),
        preferredName: form.preferredName.trim() || null,
        gender: form.gender || null,
        dateOfBirth: form.dateOfBirth || null,
        placeOfBirth: form.placeOfBirth.trim() || null,
        nationality: form.nationality.trim() || null,
        stateOfOrigin: form.stateOfOrigin.trim() || null,
        occupation: form.occupation.trim() || null,
        employer: form.employer.trim() || null,
        educationLevel: form.educationLevel || null,
        languages: form.languages.trim() || null,
        // Contact
        phone: form.phone.trim() || null,
        phoneSecondary: form.phoneSecondary.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        stateProvince: form.stateProvince.trim() || null,
        country: form.country.trim() || null,
        postalCode: form.postalCode.trim() || null,
        // Emergency
        emergencyName: form.emergencyName.trim() || null,
        emergencyPhone: form.emergencyPhone.trim() || null,
        emergencyRelationship: form.emergencyRelationship.trim() || null,
        // Church
        membershipType: form.membershipType || 'member',
        orgUnitType: form.orgUnitType || null,
        formerChurch: form.formerChurch.trim() || null,
        communicationPreference: form.communicationPreference || 'sms',
        photoConsent: form.photoConsent,
        dataConsent: form.dataConsent,
        memberId: form.memberId.trim() || null,
        // Family
        householdName: form.householdName.trim() || null,
        headOfHousehold: form.headOfHousehold,
        spouseName: form.spouseName.trim() || null,
        spouseMemberId: form.spouseMemberId.trim() || null,
        // Notes
        notes: form.notes.trim() || null,
      }
      if (canEditStatus) payload.status = form.status
      if (canEditStatus) payload.privateNotes = form.privateNotes.trim() || null

      // Login account creation (only on create mode)
      if (mode === 'create' && createLogin && loginEmail.trim() && loginPassword.trim()) {
        payload.createLogin = true
        payload.loginEmail = loginEmail.trim()
        payload.loginPassword = loginPassword
        payload.loginRole = loginRole
      }

      const url = mode === 'create' ? '/api/members' : `/api/members/${memberId}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Failed to ${mode} member`)
      }
      toast.success(mode === 'create' ? 'Member added' : 'Member updated')
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
          <DialogTitle>{mode === 'create' ? 'Add New Member' : 'Edit Member'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Fill in the member profile. Required fields are marked with *.'
              : 'Update the member profile. Changes will be audited.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto scroll-thin pr-1">

          {/* ===== SECTION 1: PERSONAL INFORMATION ===== */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border/40">
              <Users className="size-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Personal Information</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="First name *"><Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="John" /></Field>
              <Field label="Last name *"><Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Doe" /></Field>
              <Field label="Middle name"><Input value={form.middleName} onChange={(e) => set('middleName', e.target.value)} placeholder="" /></Field>
              <Field label="Preferred name"><Input value={form.preferredName} onChange={(e) => set('preferredName', e.target.value)} placeholder="Nickname" /></Field>
              <Field label="Gender">
                <Select value={form.gender || 'none'} onValueChange={(v) => set('gender', v === 'none' ? '' : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
              <Field label="Place of birth"><Input value={form.placeOfBirth} onChange={(e) => set('placeOfBirth', e.target.value)} placeholder="City, Country" /></Field>
              <Field label="Nationality"><Input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} placeholder="Nigerian" /></Field>
              <Field label="State of origin"><Input value={form.stateOfOrigin} onChange={(e) => set('stateOfOrigin', e.target.value)} placeholder="Lagos" /></Field>
              <Field label="Occupation"><Input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} placeholder="Engineer" /></Field>
              <Field label="Employer / Business"><Input value={form.employer} onChange={(e) => set('employer', e.target.value)} placeholder="Company" /></Field>
              <Field label="Education level">
                <Select value={form.educationLevel || 'none'} onValueChange={(v) => set('educationLevel', v === 'none' ? '' : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="primary">Primary</SelectItem><SelectItem value="secondary">Secondary</SelectItem><SelectItem value="tertiary">Tertiary</SelectItem><SelectItem value="postgraduate">Postgraduate</SelectItem></SelectContent>
                </Select>
              </Field>
              <div className="sm:col-span-2"><Field label="Languages spoken"><Input value={form.languages} onChange={(e) => set('languages', e.target.value)} placeholder="English, Yoruba" /></Field></div>
            </div>
          </div>

          {/* ===== SECTION 2: CONTACT INFORMATION ===== */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border/40">
              <Phone className="size-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact Information</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone (primary)"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+234 801 000 0000" /></Field>
              <Field label="Phone (secondary)"><Input value={form.phoneSecondary} onChange={(e) => set('phoneSecondary', e.target.value)} placeholder="" /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@church.org" /></Field>
              <div className="sm:col-span-2"><Field label="Residential address"><Textarea rows={1} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street address" /></Field></div>
              <Field label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Lagos" /></Field>
              <Field label="State / Province"><Input value={form.stateProvince} onChange={(e) => set('stateProvince', e.target.value)} placeholder="Lagos State" /></Field>
              <Field label="Country"><Input value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="Nigeria" /></Field>
              <Field label="Postal code"><Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} placeholder="100001" /></Field>
            </div>
          </div>

          {/* ===== SECTION 3: EMERGENCY CONTACT ===== */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border/40">
              <AlertTriangle className="size-4 text-amber-500" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Emergency Contact</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Contact name"><Input value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} placeholder="" /></Field>
              <Field label="Contact phone"><Input value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} placeholder="" /></Field>
              <Field label="Relationship"><Input value={form.emergencyRelationship} onChange={(e) => set('emergencyRelationship', e.target.value)} placeholder="Spouse, Parent" /></Field>
            </div>
          </div>

          {/* ===== SECTION 4: CHURCH INFORMATION ===== */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border/40">
              <Church className="size-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Church Information</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Membership status">
                <Select value={form.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_OPTIONS.filter((s) => s.value).map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Membership type">
                <Select value={form.membershipType} onValueChange={(v) => set('membershipType', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="worker">Worker</SelectItem>
                    <SelectItem value="deacon">Deacon</SelectItem>
                    <SelectItem value="deaconess">Deaconess</SelectItem>
                    <SelectItem value="minister">Minister</SelectItem>
                    <SelectItem value="pastor">Pastor</SelectItem>
                    <SelectItem value="asst_pastor">Asst. Pastor</SelectItem>
                    <SelectItem value="senior_pastor">Senior Pastor</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Organizational unit">
                <Select value={form.orgUnitType || 'none'} onValueChange={(v) => set('orgUnitType', v === 'none' ? '' : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="branch">Branch</SelectItem><SelectItem value="parish">Parish</SelectItem><SelectItem value="province">Province</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Member ID"><Input value={form.memberId} onChange={(e) => set('memberId', e.target.value)} placeholder="Auto-generated" disabled /></Field>
              <div className="sm:col-span-2"><Field label="Former church (if transferred)"><Input value={form.formerChurch} onChange={(e) => set('formerChurch', e.target.value)} placeholder="" /></Field></div>
              <Field label="Communication preference">
                <Select value={form.communicationPreference} onValueChange={(v) => set('communicationPreference', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="sms">SMS</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem></SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={form.photoConsent} onCheckedChange={(v) => set('photoConsent', !!v)} />
                <span className="text-sm">Photo consent</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={form.dataConsent} onCheckedChange={(v) => set('dataConsent', !!v)} />
                <span className="text-sm">Data processing consent</span>
              </label>
            </div>
          </div>

          {/* ===== SECTION 5: FAMILY INFORMATION ===== */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border/40">
              <HeartHandshake className="size-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Family Information</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Household / Family name"><Input value={form.householdName} onChange={(e) => set('householdName', e.target.value)} placeholder="e.g. The Doe Family" /></Field>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer pb-2">
                  <Checkbox checked={form.headOfHousehold} onCheckedChange={(v) => set('headOfHousehold', !!v)} />
                  <span className="text-sm">Head of household</span>
                </label>
              </div>
              <Field label="Spouse name"><Input value={form.spouseName} onChange={(e) => set('spouseName', e.target.value)} placeholder="" /></Field>
              <Field label="Spouse member ID"><Input value={form.spouseMemberId} onChange={(e) => set('spouseMemberId', e.target.value)} placeholder="If spouse is also a member" /></Field>
            </div>
          </div>

          {/* ===== SECTION 6: LOGIN ACCOUNT (create mode only) ===== */}
          {mode === 'create' && canEditStatus && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-border/40">
                <ShieldCheck className="size-4 text-primary" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Login Account (optional)</h4>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Checkbox checked={createLogin} onCheckedChange={(v) => setCreateLogin(!!v)} />
                  <span className="text-sm font-medium">Create login account for this member</span>
                </label>
                {createLogin && (
                  <div className="grid sm:grid-cols-2 gap-3 pl-6">
                    <Field label="Login email"><Input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder={form.email || 'member@church.org'} className="h-9" /></Field>
                    <Field label="Password"><Input type="text" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Temporary password" className="h-9" /></Field>
                    <Field label="Role">
                      <Select value={loginRole} onValueChange={setLoginRole}>
                        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="department_assistant">Dept Assistant</SelectItem>
                          <SelectItem value="unit_leader">Unit Leader</SelectItem>
                          <SelectItem value="department_head">Dept Head</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== SECTION 7: NOTES ===== */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border/40">
              <FileText className="size-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</h4>
            </div>
            <div className="space-y-3">
              <Field label="Public notes"><Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Visible to authorized staff" /></Field>
              {canEditStatus && (
                <Field label="Private notes (restricted)"><Textarea rows={2} value={form.privateNotes} onChange={(e) => set('privateNotes', e.target.value)} placeholder="Confidential — pastoral staff only" /></Field>
              )}
            </div>
          </div>

        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving ? 'Saving…' : mode === 'create' ? 'Add member' : 'Save changes'}
            {!saving && <ArrowRight className="size-3.5" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
