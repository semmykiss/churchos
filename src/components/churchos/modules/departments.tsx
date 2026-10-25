'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can, isScopedRole } from '@/lib/permissions'
import { formatDate, initials, fullName, titleCase } from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'
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
import {
  Network, Plus, Users, ListChecks, CalendarDays, Boxes, MoreHorizontal,
  Pencil, Trash2, Crown, ArrowRight, Mail, Phone, UserPlus, Search, X,
  RefreshCw, Check,
} from 'lucide-react'
import {
  PageHeader, StatCard, EmptyState, Toolbar, TableSkeleton,
} from '@/components/churchos/ui'
import { useMemberSearch } from '@/components/churchos/member-picker'

// ---------- types ----------
interface DeptHead { id: string; name: string; email: string; avatarUrl?: string | null }
interface DeptListItem {
  id: string; name: string; description?: string | null; color?: string | null
  createdAt: string; updatedAt: string
  head: DeptHead | null
  counts: { members: number; tasks: number; events: number; units: number }
}
interface DeptListResponse {
  items: DeptListItem[]
  colors: string[]
}
interface DeptMembership {
  id: string; role: string; joinedAt: string
  member: {
    id: string; firstName: string; lastName: string; preferredName?: string | null
    email?: string | null; phone?: string | null; photoUrl?: string | null
    status: string; memberId?: string | null
  }
}
interface DeptUnit { id: string; name: string }
interface DeptTask {
  id: string; title: string; status: string; priority: string; dueDate?: string | null
}
interface DeptDetail {
  id: string; name: string; description?: string | null; color?: string | null
  createdAt: string; updatedAt: string
  head: DeptHead | null
  memberships: DeptMembership[]
  units: DeptUnit[]
  tasks: DeptTask[]
  counts: { members: number; tasks: number; events: number; units: number }
}

const PRESET_COLORS = ['#0d9488', '#7c3aed', '#ea580c', '#db2777', '#16a34a', '#0891b2', '#ca8a04', '#dc2626']
const MEMBER_ROLES = ['leader', 'assistant', 'secretary', 'member'] as const

const ROLE_STYLES: Record<string, string> = {
  leader: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  assistant: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300',
  secretary: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300',
  member: 'bg-muted text-muted-foreground border-border',
}

// Member status badge styles (same pattern as member-picker.tsx)
const STATUS_BADGE_STYLES: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  visitor: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  follow_up: 'border-teal-500/30 bg-teal-500/5 text-teal-700 dark:text-teal-400',
  new_convert: 'border-lime-500/30 bg-lime-500/5 text-lime-700 dark:text-lime-400',
  inactive: 'border-zinc-500/30 bg-zinc-500/5 text-zinc-700 dark:text-zinc-400',
  transferred: 'border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-400',
  deceased: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  visitor: 'Visitor',
  follow_up: 'Follow-up',
  new_convert: 'New convert',
  inactive: 'Inactive',
  transferred: 'Transferred',
  deceased: 'Deceased',
}

function MemberStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-1.5 font-medium leading-4 text-[9px] ${
        STATUS_BADGE_STYLES[status] ?? 'border-border/60 bg-muted/40 text-muted-foreground'
      }`}
    >
      {STATUS_LABELS[status] ?? titleCase(status)}
    </span>
  )
}

// ---------- main module ----------
export default function DepartmentsModule() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'departments', 'create')
  const canUpdate = can(role, 'departments', 'update')
  const canDelete = can(role, 'departments', 'delete')
  const isScoped = isScopedRole(role)

  const [search, setSearch] = useState('')
  const [manageId, setManageId] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteDept, setDeleteDept] = useState<{ id: string; name: string } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<DeptListResponse>({
    queryKey: ['departments', 'list'],
    queryFn: async () => {
      const res = await fetch('/api/departments')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load departments')
      }
      return res.json()
    },
  })

  const filtered = (data?.items ?? []).filter((d) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      d.name.toLowerCase().includes(q) ||
      (d.description ?? '').toLowerCase().includes(q) ||
      (d.head?.name ?? '').toLowerCase().includes(q)
    )
  })

  const openManage = useCallback((id: string) => {
    setManageId(id)
    setManageOpen(true)
  }, [])

  const openEdit = useCallback((id: string) => {
    setEditId(id)
    setEditOpen(true)
  }, [])

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to delete')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Department deleted')
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setDeleteDept(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments & Units"
        eyebrow="People"
        description={isScoped
          ? 'Your department — manage roster, tasks and events.'
          : 'Teams, units and ministry departments in your church.'}
        icon={Network}
        actions={canCreate && (
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="size-4" /> Add Department
          </Button>
        )}
      />

      {/* Search bar */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <Toolbar>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search departments, heads, descriptions…"
                className="pl-9"
                aria-label="Search departments"
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
          </Toolbar>
        </CardContent>
      </Card>

      {/* Departments grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card className="border-border/60">
          <CardContent className="p-10 text-center">
            <EmptyState
              icon={Network}
              title="Failed to load departments"
              action={<Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2"><RefreshCw className="size-3.5" /> Retry</Button>}
            />
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={Network}
              title="No departments found"
              description={search ? 'Try a different search.' : 'Create your first department to organize teams.'}
              action={canCreate && (
                <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                  <Plus className="size-4" /> Add Department
                </Button>
              )}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => (
            <Card key={d.id} className="border-border/60 hover:shadow-premium-md hover:-translate-y-0.5 transition-all overflow-hidden group rounded-xl">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="size-9 rounded-lg grid place-items-center shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10"
                      style={{ background: `${d.color ?? '#6366f1'}1a`, color: d.color ?? '#6366f1' }}
                    >
                      <Boxes className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{d.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {d.head ? <span className="inline-flex items-center gap-1"><Crown className="size-3" />{d.head.name}</span> : 'No head assigned'}
                      </p>
                    </div>
                  </div>
                  {(canUpdate || canDelete) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7" aria-label="Department actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openManage(d.id)}>
                          <Network className="size-3.5" /> Manage
                        </DropdownMenuItem>
                        {canUpdate && (
                          <DropdownMenuItem onClick={() => openEdit(d.id)}>
                            <Pencil className="size-3.5" /> Edit
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteDept({ id: d.id, name: d.name })}
                            >
                              <Trash2 className="size-3.5" /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem] mb-4">
                  {d.description ?? 'No description provided.'}
                </p>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <MiniStat icon={Users} value={d.counts.members} label="Members" />
                  <MiniStat icon={ListChecks} value={d.counts.tasks} label="Tasks" />
                  <MiniStat icon={CalendarDays} value={d.counts.events} label="Events" />
                </div>

                <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => openManage(d.id)}>
                  Manage <ArrowRight className="size-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Manage Dialog */}
      {manageOpen && manageId && (
        <ManageDepartmentDialog
          id={manageId}
          open={manageOpen}
          onOpenChange={(o) => {
            setManageOpen(o)
            if (!o) setManageId(null)
          }}
          canEdit={canUpdate}
          onEdit={() => {
            setManageOpen(false)
            openEdit(manageId)
          }}
        />
      )}

      {/* Add Dialog */}
      {addOpen && (
        <DeptFormDialog
          mode="create"
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['departments'] })
          }}
        />
      )}

      {/* Edit Dialog */}
      {editOpen && editId && (
        <DeptFormDialog
          mode="edit"
          departmentId={editId}
          open={editOpen}
          onOpenChange={(o) => {
            setEditOpen(o)
            if (!o) setEditId(null)
          }}
          onSaved={() => {
            setEditOpen(false)
            queryClient.invalidateQueries({ queryKey: ['departments'] })
            queryClient.invalidateQueries({ queryKey: ['department', editId] })
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteDept}
        onOpenChange={(o) => { if (!o) setDeleteDept(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete department?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteDept?.name}</strong> including its
              memberships, units and tasks. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteDept) deleteMutation.mutate(deleteDept.id)
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

function MiniStat({ icon: Icon, value, label }: { icon: typeof Users; value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-2 text-center">
      <Icon className="size-3 text-muted-foreground mx-auto mb-0.5" />
      <p className="text-sm font-semibold leading-none nums">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

// ---------- manage dialog ----------
function ManageDepartmentDialog({
  id, open, onOpenChange, canEdit, onEdit,
}: {
  id: string
  open: boolean
  onOpenChange: (o: boolean) => void
  canEdit: boolean
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [newMemberId, setNewMemberId] = useState('')
  const [newMemberRole, setNewMemberRole] = useState<string>('member')
  const [memberSearch, setMemberSearch] = useState('')

  const { data, isLoading, isError } = useQuery<DeptDetail>({
    queryKey: ['department', id],
    queryFn: async () => {
      const res = await fetch(`/api/departments/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load department')
      }
      return res.json()
    },
    enabled: open,
  })

  // Search members to add (only when canEdit). Shared debounced hook — excludeIds
  // keeps members already on the roster out of the results.
  const rosterMemberIds = (data?.memberships ?? []).map((m) => m.member.id)
  const { results: memberResults, isLoading: memberSearchLoading } = useMemberSearch({
    q: memberSearch,
    enabled: addMemberOpen,
    pageSize: 20,
    excludeIds: rosterMemberIds,
  })

  const addMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      const res = await fetch(`/api/departments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addMemberId: memberId, memberRole: role }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to add member')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Member added to department')
      queryClient.invalidateQueries({ queryKey: ['department', id] })
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setNewMemberId('')
      setNewMemberRole('member')
      setAddMemberOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await fetch(`/api/departments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeMemberId: memberId }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to remove member')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Member removed')
      queryClient.invalidateQueries({ queryKey: ['department', id] })
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto scroll-thin">
        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isError ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium">Failed to load department</p>
          </div>
        ) : data ? (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <span
                  className="size-10 rounded-xl grid place-items-center shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10"
                  style={{ background: `${data.color ?? '#6366f1'}1a`, color: data.color ?? '#6366f1' }}
                >
                  <Boxes className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-xl truncate">{data.name}</DialogTitle>
                  <DialogDescription className="mt-0.5">
                    {data.description || 'No description provided.'}
                  </DialogDescription>
                </div>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={onEdit} className="gap-2">
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                )}
              </div>
            </DialogHeader>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MiniStat icon={Users} value={data.counts.members} label="Members" />
              <MiniStat icon={Boxes} value={data.counts.units} label="Units" />
              <MiniStat icon={ListChecks} value={data.counts.tasks} label="Tasks" />
              <MiniStat icon={CalendarDays} value={data.counts.events} label="Events" />
            </div>

            {/* Head card */}
            {data.head && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-3">
                <Avatar className="size-10">
                  {data.head.avatarUrl && <AvatarImage src={data.head.avatarUrl} alt={data.head.name} />}
                  <AvatarFallback className="text-xs bg-amber-500/15 text-amber-700 dark:text-amber-300">
                    {initials(data.head.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-xs text-amber-700 dark:text-amber-300 uppercase tracking-wider">Department Head</p>
                  <p className="text-sm font-medium truncate">{data.head.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{data.head.email}</p>
                </div>
              </div>
            )}

            {/* Roster */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Users className="size-3.5" /> Roster ({data.memberships.length})
                </p>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => setAddMemberOpen((v) => !v)} className="gap-2">
                    <UserPlus className="size-3.5" /> Add
                  </Button>
                )}
              </div>

              {canEdit && addMemberOpen && (
                <div className="rounded-lg border border-border/60 p-3 mb-3 space-y-2 bg-muted/30">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search members to add…"
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                  {memberSearch.trim() && (
                    <div className="max-h-32 overflow-y-auto scroll-thin border border-border/60 rounded-md">
                      {memberSearchLoading && memberResults.length === 0 ? (
                        <p className="px-2.5 py-3 text-xs text-muted-foreground text-center">Searching…</p>
                      ) : memberResults.length === 0 ? (
                        <p className="px-2.5 py-3 text-xs text-muted-foreground text-center">No new members found.</p>
                      ) : (
                        memberResults.slice(0, 8).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setNewMemberId(m.id)}
                            className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-accent/60 transition-colors flex items-center justify-between gap-2 border-b border-border/40 last:border-0 ${
                              newMemberId === m.id ? 'bg-primary/10' : ''
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <Avatar className="size-6 shrink-0">
                                {m.photoUrl && <AvatarImage src={m.photoUrl} alt={fullName(m.firstName, m.lastName)} />}
                                <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                                  {initials(m.firstName, m.lastName)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate">
                                {fullName(m.firstName, m.lastName, m.preferredName)}
                                <span className="text-muted-foreground"> · {m.memberId ?? '—'}</span>
                              </span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {m.status ? <MemberStatusBadge status={m.status} /> : null}
                              {newMemberId === m.id && <Badge variant="secondary" className="text-[9px] h-4 px-1">selected</Badge>}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Select value={newMemberRole} onValueChange={setNewMemberRole}>
                      <SelectTrigger className="h-8 w-32 text-xs" size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MEMBER_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{titleCase(r)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={!newMemberId || addMutation.isPending}
                      onClick={() => newMemberId && addMutation.mutate({ memberId: newMemberId, role: newMemberRole })}
                    >
                      {addMutation.isPending ? 'Adding…' : 'Add to department'}
                    </Button>
                  </div>
                </div>
              )}

              {data.memberships.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
                  <Users className="size-5 text-muted-foreground mx-auto mb-1.5" />
                  <p className="text-xs text-muted-foreground">No members in this department yet.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                        <TableHead className="pl-3 text-xs uppercase tracking-wide text-muted-foreground font-medium">Member</TableHead>
                        <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Contact</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Role</TableHead>
                        <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Joined</TableHead>
                        {canEdit && <TableHead className="text-right pr-3 text-xs uppercase tracking-wide text-muted-foreground font-medium"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.memberships.map((m) => (
                        <TableRow key={m.id} className="hover:bg-muted/40 border-border/60">
                          <TableCell className="pl-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-8">
                                {m.member.photoUrl && <AvatarImage src={m.member.photoUrl} alt={fullName(m.member.firstName, m.member.lastName)} />}
                                <AvatarFallback className="size-8 text-[10px] bg-primary/10 text-primary">
                                  {initials(m.member.firstName, m.member.lastName)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {fullName(m.member.firstName, m.member.lastName, m.member.preferredName)}
                                </p>
                                <p className="text-[10px] text-muted-foreground">{m.member.memberId ?? '—'}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                            {m.member.phone || m.member.email || '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[11px] font-medium ${ROLE_STYLES[m.role] ?? ROLE_STYLES.member}`}>
                              {titleCase(m.role)}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground nums">
                            {formatDate(m.joinedAt)}
                          </TableCell>
                          {canEdit && (
                            <TableCell className="text-right pr-3">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:text-destructive"
                                onClick={() => removeMutation.mutate(m.member.id)}
                                disabled={removeMutation.isPending}
                                aria-label="Remove from department"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {/* Units */}
            {data.units.length > 0 && (
              <section>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Boxes className="size-3.5" /> Units
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.units.map((u) => (
                    <span key={u.id} className="text-xs px-2 py-1 rounded-md border border-border/60 bg-muted/40">
                      {u.name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Recent tasks */}
            {data.tasks.length > 0 && (
              <section>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ListChecks className="size-3.5" /> Recent Tasks
                </p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto scroll-thin pr-1">
                  {data.tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-xs border border-border/60 rounded-lg px-2.5 py-1.5 hover:bg-muted/30 transition-colors">
                      <span className="truncate">{t.title}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className="text-[10px]">{titleCase(t.status)}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------- form dialog (create / edit) ----------
interface DeptFormState {
  name: string
  description: string
  color: string
  headUserId: string
}
const EMPTY_DEPT: DeptFormState = { name: '', description: '', color: PRESET_COLORS[0], headUserId: '' }

function DeptFormDialog({
  mode, departmentId, open, onOpenChange, onSaved,
}: {
  mode: 'create' | 'edit'
  departmentId?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<DeptFormState>(EMPTY_DEPT)
  const [saving, setSaving] = useState(false)
  const [headCandidates, setHeadCandidates] = useState<{ id: string; name: string; email: string }[]>([])
  // Current head from the loaded department, kept so it stays selectable in edit
  // mode even when its user account is inactive (absent from the active list).
  const [headFallback, setHeadFallback] = useState<{ id: string; name: string; email: string } | null>(null)
  const [memberSearch, setMemberSearch] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<{ id: string; name: string }[]>([])

  // Shared debounced member search (create mode "Add Members").
  const { results: memberResults, isLoading: memberSearchLoading } = useMemberSearch({
    q: memberSearch,
    enabled: open,
    pageSize: 10,
  })

  // Merge the current head into the candidates when missing from the active list.
  const headOptions = headFallback && !headCandidates.some((u) => u.id === headFallback.id)
    ? [...headCandidates, headFallback]
    : headCandidates

  // Load real head candidates from the authenticated users directory when the
  // dialog opens; reset member selection in create mode.
  useEffect(() => {
    if (!open) return
    setHeadFallback(null)
    // Reset member selection on open
    if (mode === 'create') {
      setSelectedMembers([])
      setMemberSearch('')
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/users?active=true&pageSize=200')
        if (!res.ok) throw new Error('Failed to load users')
        const json: { users?: { id: string; name: string; email: string }[] } = await res.json()
        if (!cancelled) {
          setHeadCandidates((json.users ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email })))
        }
      } catch {
        // Degrade gracefully: empty candidates list, dropdown shows only "— None —".
        if (!cancelled) setHeadCandidates([])
      }
    })()
    return () => { cancelled = true }
  }, [open, mode])

  const toggleMember = (m: { id: string; firstName: string; lastName: string }) => {
    setSelectedMembers((prev) => {
      const exists = prev.find((p) => p.id === m.id)
      if (exists) return prev.filter((p) => p.id !== m.id)
      return [...prev, { id: m.id, name: `${m.firstName} ${m.lastName}` }]
    })
  }

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && departmentId) {
      ;(async () => {
        try {
          const res = await fetch(`/api/departments/${departmentId}`)
          if (!res.ok) throw new Error('Failed')
          const d: DeptDetail = await res.json()
          setForm({
            name: d.name,
            description: d.description ?? '',
            color: d.color ?? PRESET_COLORS[0],
            headUserId: d.head?.id ?? '',
          })
          // Keep the current head visible/selectable in the dropdown even when its
          // account is inactive and therefore missing from the active-users list.
          setHeadFallback(d.head ? { id: d.head.id, name: d.head.name || 'Current head', email: d.head.email || '' } : null)
        } catch {
          toast.error('Failed to load department for editing')
          onOpenChange(false)
        }
      })()
    } else {
      setForm(EMPTY_DEPT)
    }
  }, [mode, departmentId, open, onOpenChange])

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error('Department name is required')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color,
        headUserId: form.headUserId || null,
      }
      const url = mode === 'create' ? '/api/departments' : `/api/departments/${departmentId}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Failed to ${mode} department`)
      }
      const created = await res.json()

      // Add selected members to the new department (create mode only)
      if (mode === 'create' && selectedMembers.length > 0 && created.id) {
        for (const m of selectedMembers) {
          await fetch(`/api/departments/${created.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addMemberId: m.id, memberRole: 'member' }),
          }).catch(() => {})
        }
        toast.success(`Department created with ${selectedMembers.length} member${selectedMembers.length > 1 ? 's' : ''}`)
      } else {
        toast.success(mode === 'create' ? 'Department created' : 'Department updated')
      }
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Department' : 'Edit Department'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Create a new ministry department or unit.'
              : 'Update department details. Changes will be audited.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Name *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Worship & Music" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Short description of the department's mission" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Color</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className={`size-7 rounded-full border-2 transition-transform ${form.color === c ? 'scale-110 border-foreground' : 'border-transparent'}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Department Head</Label>
            <Select value={form.headUserId || 'none'} onValueChange={(v) => setForm((f) => ({ ...f, headUserId: v === 'none' ? '' : v }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a head (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {headOptions.length === 0 && (
                  <SelectItem value="no-candidates" disabled>No active users found</SelectItem>
                )}
                {headOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Add members at creation (create mode only) */}
          {mode === 'create' && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Add Members (optional)</Label>
              <p className="text-[11px] text-muted-foreground">Search and select members to add to this department.</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search members by name…"
                  className="h-9 pl-9 text-sm"
                />
              </div>
              {/* Search results */}
              {memberSearch.trim() && (
                <div className="max-h-32 overflow-y-auto scroll-thin rounded-lg border border-border/60 divide-y divide-border/40">
                  {memberSearchLoading && memberResults.length === 0 ? (
                    <p className="px-3 py-2.5 text-sm text-muted-foreground text-center">Searching…</p>
                  ) : memberResults.length === 0 ? (
                    <p className="px-3 py-2.5 text-sm text-muted-foreground text-center">No members found.</p>
                  ) : (
                    memberResults.slice(0, 5).map((m) => {
                      const isSelected = selectedMembers.some((s) => s.id === m.id)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleMember(m)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent/40 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <Avatar className="size-6 shrink-0">
                              {m.photoUrl && <AvatarImage src={m.photoUrl} alt={fullName(m.firstName, m.lastName)} />}
                              <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                                {initials(m.firstName, m.lastName)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm truncate">
                              {fullName(m.firstName, m.lastName, m.preferredName)}
                              {m.memberId ? <span className="ml-1.5 text-[10px] text-muted-foreground">{m.memberId}</span> : null}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {m.status ? <MemberStatusBadge status={m.status} /> : null}
                            {isSelected ? (
                              <Check className="size-4 text-primary" />
                            ) : (
                              <Plus className="size-4 text-muted-foreground" />
                            )}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              )}
              {/* Selected members */}
              {selectedMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedMembers.map((m) => (
                    <Badge key={m.id} variant="outline" className="text-xs gap-1 pr-1">
                      {m.name}
                      <button
                        type="button"
                        onClick={() => toggleMember({ id: m.id, firstName: m.name.split(' ')[0], lastName: m.name.split(' ')[1] ?? '' })}
                        className="ml-0.5 hover:text-destructive"
                        aria-label={`Remove ${m.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
            {!saving && <ArrowRight className="size-3.5" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
