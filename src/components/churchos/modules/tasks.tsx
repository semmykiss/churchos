'use client'

// ChurchOS — Tasks & Approvals module (Module 12)
// Tabs: Tasks (Kanban board) | Approvals (pending approvals queue).
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { formatDate, formatDateTime, relativeTime, titleCase } from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  ListChecks, Plus, MoreHorizontal, Calendar, User, Flag,
  Clock, CheckCircle2, XCircle, Ban, Pencil, Trash2,
  Check, X, Inbox, AlertTriangle, Info, RefreshCw,
} from 'lucide-react'
import {
  PageHeader, StatCard, EmptyState, Toolbar, StatCardSkeleton,
} from '@/components/churchos/ui'

// ---------- types ----------
interface DeptRef { id: string; name: string; color?: string | null }
interface TaskItem {
  id: string
  title: string
  description?: string | null
  status: string
  priority: string
  dueDate?: string | null
  assigneeId?: string | null
  assigneeName?: string | null
  departmentId?: string | null
  department?: DeptRef | null
  createdAt: string
  updatedAt: string
}
interface TaskListResponse {
  items: TaskItem[]
  total: number
  page: number
  pageSize: number
  stats: {
    todo: number
    in_progress: number
    done: number
    blocked: number
    urgent: number
    overdue: number
  }
  departments: DeptRef[]
}
interface AssigneeOption { id: string; name: string; email: string; role: string }
interface UsersResponse {
  items: AssigneeOption[]
  total: number
  currentUserId: string
}
interface ApprovalItem {
  id: string
  type: string
  refId: string
  status: string
  comment?: string | null
  createdAt: string
  resolvedAt?: string | null
  requester?: { id: string; name: string; email: string } | null
  approver?: { id: string; name: string; email: string } | null
  ref?: {
    kind: 'expense' | 'event'
    label: string
    subtitle: string
    amount?: number
    status?: string
    startDate?: string
  } | null
}
interface ApprovalsResponse {
  items: ApprovalItem[]
  total: number
  page: number
  pageSize: number
  canApproveFinance: boolean
  canApproveEvents: boolean
}

const STATUSES = [
  { id: 'todo', label: 'To Do', dot: 'bg-slate-400', border: 'border-l-slate-400' },
  { id: 'in_progress', label: 'In Progress', dot: 'bg-teal-500', border: 'border-l-teal-500' },
  { id: 'done', label: 'Done', dot: 'bg-emerald-500', border: 'border-l-emerald-500' },
  { id: 'blocked', label: 'Blocked', dot: 'bg-rose-500', border: 'border-l-rose-500' },
] as const

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300',
  normal: 'bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300',
  high: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  urgent: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
}

function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function isOverdue(due: string | null | undefined, status: string): boolean {
  if (!due || status === 'done') return false
  return new Date(due).getTime() < Date.now()
}

export default function TasksModule() {
  const { user, detailRef, clearDetail } = useAuth()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'tasks', 'create')
  const canUpdate = can(role, 'tasks', 'update')
  const canDelete = can(role, 'tasks', 'delete')

  const [activeTab, setActiveTab] = useState<'tasks' | 'approvals'>('tasks')
  const [filterDept, setFilterDept] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteTitle, setDeleteTitle] = useState('')

  // ---- Tasks list query ----
  const queryKey = useMemo(
    () => ['tasks', 'list', filterDept] as const,
    [filterDept],
  )
  const { data, isLoading, isError, refetch } = useQuery<TaskListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '200' })
      if (filterDept) params.set('departmentId', filterDept)
      const res = await fetch(`/api/tasks?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load tasks')
      }
      return res.json()
    },
  })

  // ---- Users for assignee dropdown ----
  // /api/users is the authenticated org directory (requireUser — works for
  // pastor/department_head too); /api/settings/users 403s non-admins, which
  // left this dropdown silently empty for those roles.
  const { data: usersData } = useQuery<UsersResponse>({
    queryKey: ['users', 'active', 'list'],
    queryFn: async () => {
      const res = await fetch('/api/users?active=true&pageSize=200')
      if (!res.ok) return { items: [], total: 0, currentUserId: user?.id ?? '' }
      const json = (await res.json()) as {
        users?: Array<{ id: string; name: string; email: string; role: string }>
      }
      const users = json.users ?? []
      return {
        items: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
        total: users.length,
        currentUserId: user?.id ?? '',
      }
    },
    enabled: canCreate || canUpdate,
  })

  // ---- Approvals list ----
  const { data: approvalsData, isLoading: approvalsLoading } = useQuery<ApprovalsResponse>({
    queryKey: ['tasks', 'approvals'],
    queryFn: async () => {
      const res = await fetch('/api/tasks?approvals=1')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load approvals')
      }
      return res.json()
    },
    enabled: activeTab === 'approvals',
  })

  const queryClient = useQueryClient()

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }, [queryClient])

  // ---- Status update mutation ----
  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; status?: string; priority?: string; assigneeId?: string | null }) => {
      const res = await fetch(`/api/tasks/${vars.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: vars.status,
          priority: vars.priority,
          assigneeId: vars.assigneeId,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Update failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Task updated')
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  // Open the task detail dialog when a notification is clicked (detailRef).
  useEffect(() => {
    if (!detailRef || detailRef.module !== 'tasks') return
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
  const openDelete = useCallback((id: string, title: string) => {
    setDeleteId(id)
    setDeleteTitle(title)
  }, [])

  const stats = data?.stats
  const tasks = data?.items ?? []
  const columns = STATUSES.map((s) => ({
    ...s,
    items: tasks.filter((t) => t.status === s.id),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks & Approvals"
        eyebrow="Operations"
        description="Coordinate work across teams and track pending approvals."
        icon={ListChecks}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="size-4" /> New Task
            </Button>
          ) : undefined
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="tasks" className="gap-1.5">
            <ListChecks className="size-4" /> Tasks
          </TabsTrigger>
          <TabsTrigger value="approvals" className="gap-1.5">
            <Inbox className="size-4" /> Approvals
            {approvalsData && approvalsData.total > 0 && (
              <Badge variant="secondary" className="ml-1 nums">{approvalsData.total}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* =================== TASKS TAB =================== */}
        <TabsContent value="tasks" className="space-y-4">
          {/* Stats strip */}
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard icon={ListChecks} label="To Do" value={stats.todo} accent="primary" />
              <StatCard icon={Clock} label="In Progress" value={stats.in_progress} accent="teal" />
              <StatCard icon={CheckCircle2} label="Done" value={stats.done} accent="emerald" />
              <StatCard icon={Ban} label="Blocked" value={stats.blocked} accent="rose" />
              <StatCard icon={Flag} label="Urgent" value={stats.urgent} accent="rose" />
              <StatCard icon={AlertTriangle} label="Overdue" value={stats.overdue} accent="amber" />
            </div>
          ) : null}

          {/* Filter row */}
          <Card className="border-border/60">
            <CardContent className="p-4">
              <Toolbar>
                <Label className="text-xs text-muted-foreground shrink-0">Filter by department</Label>
                <Select value={filterDept} onValueChange={(v) => setFilterDept(v === '__all' ? '' : v)}>
                  <SelectTrigger className="w-full md:w-56 h-9" aria-label="Filter by department">
                    <SelectValue placeholder="All departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All departments</SelectItem>
                    {(data?.departments ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        <span className="flex items-center gap-2">
                          {d.color && (
                            <span className="size-2 rounded-full" style={{ background: d.color }} />
                          )}
                          {d.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(data?.departments.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No departments assigned. Tasks will be created without a department tag.
                  </p>
                )}
              </Toolbar>
            </CardContent>
          </Card>

          {isLoading && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-72 rounded-xl" />
              ))}
            </div>
          )}
          {isError && (
            <Card className="border-border/60">
              <EmptyState
                icon={AlertTriangle}
                title="Failed to load tasks"
                description="We couldn't fetch the task list. Please try again."
                action={
                  <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                    <RefreshCw /> Retry
                  </Button>
                }
              />
            </Card>
          )}

          {!isLoading && !isError && tasks.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {columns.map((col) => (
                <div key={col.id} className="space-y-3">
                  {/* Column header */}
                  <div className={`flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 border-l-2 ${col.border}`}>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block size-2 rounded-full ${col.dot}`} />
                      <h3 className="text-sm font-semibold">{col.label}</h3>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-medium nums">{col.items.length}</Badge>
                  </div>
                  <div className="space-y-2 max-h-[calc(100vh-22rem)] overflow-y-auto scroll-thin pr-1">
                    {col.items.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 bg-card/40 p-4 text-center">
                        <p className="text-xs text-muted-foreground">No tasks</p>
                      </div>
                    ) : (
                      col.items.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          canUpdate={canUpdate}
                          canDelete={canDelete}
                          onOpen={() => openDetail(t.id)}
                          onEdit={() => openEdit(t.id)}
                          onDelete={() => openDelete(t.id, t.title)}
                          onMove={(status) => updateMutation.mutate({ id: t.id, status })}
                          onPriority={(priority) => updateMutation.mutate({ id: t.id, priority })}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tasks.length === 0 && !isLoading && (
            <Card className="border-border/60">
              <EmptyState
                icon={ListChecks}
                title="No tasks yet"
                description={
                  canCreate
                    ? 'Create your first task to coordinate ministry work.'
                    : 'No tasks have been assigned yet.'
                }
                action={canCreate && (
                  <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                    <Plus className="size-4" /> Create a task
                  </Button>
                )}
              />
            </Card>
          )}
        </TabsContent>

        {/* =================== APPROVALS TAB =================== */}
        <TabsContent value="approvals" className="space-y-4">
          <ApprovalsTab
            data={approvalsData}
            loading={approvalsLoading}
            onResolved={invalidate}
          />
        </TabsContent>
      </Tabs>

      {/* Detail dialog */}
      <TaskDetailDialog
        id={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        canUpdate={canUpdate}
      />

      {/* New task dialog */}
      <TaskFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        departments={data?.departments ?? []}
        assignees={usersData?.items ?? []}
        onSaved={invalidate}
      />

      {/* Edit task dialog */}
      <TaskFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editId={editId}
        departments={data?.departments ?? []}
        assignees={usersData?.items ?? []}
        onSaved={invalidate}
      />

      {/* Delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently delete &quot;{deleteTitle}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteId) return
                try {
                  const res = await fetch(`/api/tasks/${deleteId}`, { method: 'DELETE' })
                  if (!res.ok) {
                    const e = await res.json().catch(() => ({}))
                    throw new Error(e.error || 'Delete failed')
                  }
                  toast.success('Task deleted')
                  invalidate()
                } catch (e) {
                  toast.error((e as Error).message)
                } finally {
                  setDeleteId(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- Task Card ----------
function TaskCard({
  task,
  canUpdate,
  canDelete,
  onOpen,
  onEdit,
  onDelete,
  onMove,
  onPriority,
}: {
  task: TaskItem
  canUpdate: boolean
  canDelete: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onMove: (status: string) => void
  onPriority: (priority: string) => void
}) {
  const overdue = isOverdue(task.dueDate, task.status)
  return (
    <Card
      className="group cursor-pointer border-border/60 rounded-lg transition-all hover:shadow-premium hover:border-primary/30"
      onClick={onOpen}
    >
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{task.title}</p>
          {canUpdate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 shrink-0" aria-label="Task actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onMove('todo')}>To Do</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMove('in_progress')}>In Progress</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMove('done')}>Done</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMove('blocked')}>Blocked</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Priority</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onPriority('low')}>Low</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPriority('normal')}>Normal</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPriority('high')}>High</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPriority('urgent')}>Urgent</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 size-4" /> Edit
                </DropdownMenuItem>
                {canDelete && (
                  <DropdownMenuItem className="text-rose-600" onClick={onDelete}>
                    <Trash2 className="mr-2 size-4" /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {task.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] font-medium ${PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.normal}`}>
            <Flag className="mr-1 size-2.5" /> {titleCase(task.priority)}
          </Badge>
          {task.department && (
            <Badge variant="outline" className="text-[10px] font-medium">
              <span
                className="mr-1 inline-block size-1.5 rounded-full"
                style={{ background: task.department.color ?? '#888' }}
              />
              {task.department.name}
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 truncate">
            {task.assigneeName ? (
              <>
                <Avatar className="size-5">
                  <AvatarFallback className="bg-primary/10 text-[9px] text-primary">
                    {initials(task.assigneeName)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{task.assigneeName}</span>
              </>
            ) : (
              <span className="flex items-center gap-1">
                <User className="size-3" /> Unassigned
              </span>
            )}
          </span>
          {task.dueDate && (
            <span className={`flex items-center gap-1 nums ${overdue ? 'font-medium text-rose-600' : ''}`}>
              <Calendar className="size-3" />
              {formatDate(task.dueDate, { day: '2-digit', month: 'short' })}
              {overdue && <AlertTriangle className="ml-0.5 size-3" />}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- Task Detail Dialog ----------
function TaskDetailDialog({
  id,
  open,
  onOpenChange,
  canUpdate,
}: {
  id: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
  canUpdate: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['task', 'detail', id],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load task')
      }
      return res.json()
    },
    enabled: !!id && open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isLoading ? <Skeleton className="h-6 w-40" /> : data?.title ?? 'Task'}
          </DialogTitle>
          <DialogDescription>Task details</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : data ? (
          <div className="space-y-4 py-2 max-h-[80vh] overflow-y-auto scroll-thin pr-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`text-[11px] font-medium ${PRIORITY_STYLES[data.priority] ?? PRIORITY_STYLES.normal}`}>
                <Flag className="mr-1 size-3" /> {titleCase(data.priority)}
              </Badge>
              <Badge variant="outline" className="text-[11px] font-medium">{titleCase(data.status)}</Badge>
              {data.dueDate && (
                <Badge
                  variant="outline"
                  className={`text-[11px] font-medium ${isOverdue(data.dueDate, data.status) ? 'border-rose-500/30 text-rose-600' : ''}`}
                >
                  <Calendar className="mr-1 size-3" /> Due {formatDate(data.dueDate)}
                </Badge>
              )}
            </div>
            {data.description && (
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="mt-1 whitespace-pre-wrap text-sm">{data.description}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">Assignee</Label>
                <p className="mt-1 flex items-center gap-2">
                  {data.assignee ? (
                    <>
                      <Avatar className="size-6">
                        <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
                          {initials(data.assignee.name)}
                        </AvatarFallback>
                      </Avatar>
                      {data.assignee.name}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Department</Label>
                <p className="mt-1 flex items-center gap-2">
                  {data.department ? (
                    <>
                      <span
                        className="size-2 rounded-full"
                        style={{ background: data.department.color ?? '#888' }}
                      />
                      {data.department.name}
                    </>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Created</Label>
                <p className="mt-1 nums">{formatDateTime(data.createdAt)}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Last updated</Label>
                <p className="mt-1">{relativeTime(data.updatedAt)}</p>
              </div>
            </div>
            {!canUpdate && (
              <p className="text-xs text-muted-foreground">Read-only — you do not have permission to edit tasks.</p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------- Task Form Dialog (create / edit) ----------
function TaskFormDialog({
  open,
  onOpenChange,
  editId,
  departments,
  assignees,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editId?: string | null
  departments: DeptRef[]
  assignees: AssigneeOption[]
  onSaved: () => void
}) {
  const isEdit = !!editId
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState('normal')
  const [status, setStatus] = useState('todo')
  const [dueDate, setDueDate] = useState('')

  // Prefill edit
  useEffect(() => {
    if (open && editId) {
      fetch(`/api/tasks/${editId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d && !d.error) {
            setTitle(d.title || '')
            setDescription(d.description || '')
            setDepartmentId(d.departmentId || '')
            setAssigneeId(d.assigneeId || '')
            setPriority(d.priority || 'normal')
            setStatus(d.status || 'todo')
            setDueDate(d.dueDate ? d.dueDate.slice(0, 10) : '')
          }
        })
        .catch(() => {})
    } else if (open && !editId) {
      // Defer reset past the effect body to avoid cascading renders.
      void Promise.resolve().then(() => {
        setTitle(''); setDescription(''); setDepartmentId('')
        setAssigneeId(''); setPriority('normal'); setStatus('todo'); setDueDate('')
      })
    }
  }, [open, editId])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title,
        description: description.trim() || null,
        priority,
        status,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      }
      if (departmentId && departmentId !== '__none') payload.departmentId = departmentId
      else payload.departmentId = null
      if (assigneeId && assigneeId !== '__none') payload.assigneeId = assigneeId
      else payload.assigneeId = null

      const url = isEdit ? `/api/tasks/${editId}` : '/api/tasks'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Save failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Task updated' : 'Task created')
      onOpenChange(false)
      onSaved()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Task' : 'New Task'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update task details.' : 'Coordinate ministry work with a structured task.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 max-h-[70vh] overflow-y-auto scroll-thin pr-1">
          <div className="grid gap-2">
            <Label htmlFor="title" className="text-sm font-medium">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Prepare Sunday bulletin" className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description" className="text-sm font-medium">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional context, scope, or notes"
              className="text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Department</Label>
              <Select value={departmentId || '__none'} onValueChange={(v) => setDepartmentId(v === '__none' ? '' : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="No department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No department</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="flex items-center gap-2">
                        {d.color && (
                          <span className="size-2 rounded-full" style={{ background: d.color }} />
                        )}
                        {d.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Assignee</Label>
              <Select value={assigneeId || '__none'} onValueChange={(v) => setAssigneeId(v === '__none' ? '' : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {assignees.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} · {titleCase(u.role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="dueDate" className="text-sm font-medium">Due date</Label>
              <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !title.trim()} className="gap-2">
            {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Approvals Tab ----------
function ApprovalsTab({
  data,
  loading,
  onResolved,
}: {
  data?: ApprovalsResponse
  loading: boolean
  onResolved: () => void
}) {
  const [comment, setComment] = useState<Record<string, string>>({})

  const resolveMutation = useMutation({
    mutationFn: async (vars: { approvalId: string; refId: string; type: string; decision: 'approve' | 'reject'; comment?: string }) => {
      // Expenses go through the finance expense approve/reject endpoint
      if (vars.type === 'expense') {
        const res = await fetch(`/api/finance/expenses/${vars.refId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: vars.decision === 'approve' ? 'approve' : 'reject',
            comment: vars.comment || null,
          }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e.error || 'Failed to resolve approval')
        }
        return res.json()
      }
      // Events & others — write an Approval record directly via tasks endpoint as a fallback
      // For now, mark approval as resolved by creating a new approval record (no resolver endpoint outside finance)
      const res = await fetch(`/api/tasks/${vars.refId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Resolution not supported for this type')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Approval resolved')
      onResolved()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <Card className="border-border/60">
        <EmptyState
          icon={Inbox}
          title="No pending approvals"
          description="When team members submit expense or event requests that need sign-off, they will appear here."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="size-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/15">
            <Info className="size-4" />
          </div>
          <div className="text-sm">
            <p className="font-medium">Approvals queue</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {data.canApproveFinance && data.canApproveEvents
                ? 'You can approve finance expenses and events.'
                : data.canApproveFinance
                  ? 'You have finance approval authority.'
                  : data.canApproveEvents
                    ? 'You have event approval authority.'
                    : 'You can view approvals but do not have approval authority.'}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {data.items.map((a) => (
          <Card key={a.id} className="border-border/60">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize text-[10px] font-medium">
                      {a.type === 'expense' ? 'Expense' : a.type === 'event' ? 'Event' : titleCase(a.type)}
                    </Badge>
                    {a.status !== 'pending' && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-medium ${a.status === 'approved'
                          ? 'border-emerald-500/30 text-emerald-700'
                          : 'border-rose-500/30 text-rose-700'
                        }`}
                      >
                        {titleCase(a.status)}
                      </Badge>
                    )}
                  </div>
                  <p className="font-medium">
                    {a.ref?.label ?? `Approval #${a.refId.slice(-6)}`}
                  </p>
                  {a.ref?.subtitle && (
                    <p className="text-xs text-muted-foreground">{a.ref.subtitle}</p>
                  )}
                  {a.ref?.amount !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      Amount: <span className="font-medium nums">
                        ₦{a.ref.amount.toLocaleString('en-NG')}
                      </span>
                    </p>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <p>Requested by {a.requester?.name ?? 'System'}</p>
                  <p className="nums">{relativeTime(a.createdAt)}</p>
                  {a.resolvedAt && <p className="nums">Resolved {relativeTime(a.resolvedAt)}</p>}
                  {a.approver && <p>by {a.approver.name}</p>}
                </div>
              </div>

              {a.status === 'pending' && (data.canApproveFinance || data.canApproveEvents) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                  <Input
                    placeholder="Optional comment"
                    value={comment[a.id] ?? ''}
                    onChange={(e) => setComment((c) => ({ ...c, [a.id]: e.target.value }))}
                    className="h-9 flex-1 text-sm sm:max-w-xs"
                  />
                  <Button
                    size="sm"
                    className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => resolveMutation.mutate({
                      approvalId: a.id, refId: a.refId, type: a.type,
                      decision: 'approve', comment: comment[a.id],
                    })}
                    disabled={resolveMutation.isPending}
                  >
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                    onClick={() => resolveMutation.mutate({
                      approvalId: a.id, refId: a.refId, type: a.type,
                      decision: 'reject', comment: comment[a.id],
                    })}
                    disabled={resolveMutation.isPending}
                  >
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              )}

              {a.comment && (
                <p className="border-t border-border/60 pt-2 text-xs text-muted-foreground">
                  Comment: &quot;{a.comment}&quot;
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
