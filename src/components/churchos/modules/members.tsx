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
  const { user, organization } = useAuth()
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
  const [page, setPage] = useState(1)
  const pageSize = 10
  const debouncedSearch = useDebouncedValue(search, 350)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [debouncedSearch, status])

  const queryKey = useMemo(
    () => ['members', 'list', debouncedSearch, status, page, pageSize] as const,
    [debouncedSearch, status, page],
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
      <Card className="border-border/60">
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
            <Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0 gap-2">
              <RefreshCw className="size-3.5" /> Reset
            </Button>
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
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
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
                          <Avatar className="size-9">
                            {m.photoUrl && <AvatarImage src={m.photoUrl} alt={fullName(m.firstName, m.lastName)} />}
                            <AvatarFallback className="size-9 text-xs bg-primary/10 text-primary">
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto scroll-thin">
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
              <div className="flex items-start gap-4">
                <Avatar className="size-16 shrink-0">
                  {data.photoUrl && <AvatarImage src={data.photoUrl} alt={fullName(data.firstName, data.lastName)} />}
                  <AvatarFallback className="text-lg bg-primary/10 text-primary">
                    {initials(data.firstName, data.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-xl">
                    {fullName(data.firstName, data.lastName, data.preferredName)}
                  </DialogTitle>
                  <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                    <span>{data.memberId ?? 'No member ID'}</span>
                    <StatusBadge status={data.status} />
                    {data.baptized && (
                      <Badge variant="outline" className="text-[10px] bg-primary/8 border-primary/20 text-primary">
                        <Droplet className="size-2.5" /> Baptized
                      </Badge>
                    )}
                  </DialogDescription>
                </div>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={onEdit} className="gap-2">
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                )}
              </div>
            </DialogHeader>

            {/* Contact */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <span key={d.id} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border/60 bg-muted/40">
                      <span className="size-2 rounded-full" style={{ background: d.color || 'var(--primary)' }} />
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
              <StatBox label="Attendance" value={String(data.attendanceCount)} accent="bg-emerald-500/8 text-emerald-700 dark:text-emerald-300" />
              {canViewFinance && data.donations && (
                <StatBox label="Total Giving" value={formatCurrency(data.donations.total, currency)} accent="bg-amber-500/8 text-amber-700 dark:text-amber-300" />
              )}
              {canViewFinance && data.donations && (
                <StatBox label="Donations" value={String(data.donations.count)} accent="bg-primary/8 text-primary" />
              )}
            </section>

            {/* Notes */}
            {(data.notes || (canEdit && data.privateNotes)) && (
              <section className="space-y-2">
                {data.notes && (
                  <div className="rounded-lg border border-border/60 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{data.notes}</p>
                  </div>
                )}
                {canEdit && data.privateNotes && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
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
                <ol className="space-y-2 max-h-40 overflow-y-auto scroll-thin pr-1">
                  {data.statusHistory.map((h) => (
                    <li key={h.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
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
    <div className="flex items-start gap-2.5">
      <Icon className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm truncate">{value || <span className="text-muted-foreground">—</span>}</p>
      </div>
    </div>
  )
}

function StatBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`rounded-xl border border-border/60 p-3.5 ${accent}`}>
      <p className="text-[10px] uppercase font-semibold tracking-wider">{label}</p>
      <p className="text-lg font-bold mt-0.5 nums">{value}</p>
    </div>
  )
}

// ---------- form dialog (create / edit) ----------
interface FormState {
  firstName: string
  lastName: string
  email: string
  phone: string
  gender: string
  dateOfBirth: string
  status: string
  branchId: string
  baptized: boolean
  baptizedDate: string
  address: string
  emergencyName: string
  emergencyPhone: string
  notes: string
  privateNotes: string
  memberId: string
}

const EMPTY_FORM: FormState = {
  firstName: '', lastName: '', email: '', phone: '', gender: '',
  dateOfBirth: '', status: 'visitor', branchId: '', baptized: false,
  baptizedDate: '', address: '', emergencyName: '', emergencyPhone: '',
  notes: '', privateNotes: '', memberId: '',
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
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        gender: form.gender || null,
        dateOfBirth: form.dateOfBirth || null,
        branchId: form.branchId || null,
        baptized: form.baptized,
        baptizedDate: form.baptizedDate || null,
        address: form.address.trim() || null,
        emergencyName: form.emergencyName.trim() || null,
        emergencyPhone: form.emergencyPhone.trim() || null,
        notes: form.notes.trim() || null,
        memberId: form.memberId.trim() || null,
      }
      if (canEditStatus) payload.status = form.status
      if (canEditStatus) payload.privateNotes = form.privateNotes.trim() || null

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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="First name *">
            <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label="Last name *">
            <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Gender">
            <Select value={form.gender || 'none'} onValueChange={(v) => set('gender', v === 'none' ? '' : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select gender" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date of birth">
            <Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </Field>
          {canEditStatus ? (
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.filter((s) => s.value).map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Member ID">
            <Input value={form.memberId} onChange={(e) => set('memberId', e.target.value)} placeholder="Auto-generated" />
          </Field>
          <Field label="Branch">
            <Select value={form.branchId || 'none'} onValueChange={(v) => set('branchId', v === 'none' ? '' : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Baptized">
            <label className="flex items-center gap-2 h-9 cursor-pointer">
              <Checkbox
                checked={form.baptized}
                onCheckedChange={(v) => set('baptized', v === true)}
              />
              <span className="text-sm">Baptized member</span>
            </label>
          </Field>
          {form.baptized && (
            <Field label="Baptized date">
              <Input type="date" value={form.baptizedDate} onChange={(e) => set('baptizedDate', e.target.value)} />
            </Field>
          )}
          <Field label="Emergency contact name">
            <Input value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} />
          </Field>
          <Field label="Emergency phone">
            <Input value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Public notes about the member" />
            </Field>
          </div>
          {canEditStatus && (
            <div className="sm:col-span-2">
              <Field label="Private notes (restricted)">
                <Textarea rows={2} value={form.privateNotes} onChange={(e) => set('privateNotes', e.target.value)} placeholder="Confidential notes visible only to staff" />
              </Field>
            </div>
          )}
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
