'use client'

// ChurchOS — Enterprise Access Control module (Task ID 26)
// 5 tabs:
//   1. Roles          — Role catalog with create/edit/clone/retire/delete
//   2. Matrix         — Editable permission matrix (role × module × action)
//   3. Users          — User directory + multi-role / scoped / expiring assignments
//   4. Simulation     — Read-only effective-permission simulation for any user
//   5. Audit          — Access-control audit log + approval policies + access reviews
//
// Premium navy/indigo design (matches globals.css palette). All mutations go
// through TanStack Query, with toasts (sonner), loading skeletons, empty
// states, error toasts, and confirmation dialogs for high-impact operations.
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { relativeTime, formatDateTime, titleCase } from '@/lib/format'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  KeyRound, ShieldCheck, Lock, Info, Users as UsersIcon, Eye, Code2, Plus,
  RefreshCw, AlertTriangle, Search, MoreVertical, Copy, Trash2, Power,
  Pencil, UserCog, FlaskConical, ScrollText, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, ShieldAlert, Clock, Globe, Layers, Filter,
  History, Eye as EyeIcon, Building2, Calendar, Fingerprint, FileCheck2,
} from 'lucide-react'
import {
  PageHeader, StatCard, EmptyState, StatCardSkeleton, TableSkeleton,
} from '@/components/churchos/ui'

// ===========================================================================
// Constants & helpers
// ===========================================================================

// Full module list for the matrix (MODULES + access + search).
const MATRIX_MODULES = [
  'dashboard', 'members', 'departments', 'attendance', 'visitors', 'followups',
  'events', 'finance', 'announcements', 'pastoral', 'tasks', 'assets',
  'documents', 'reports', 'audit', 'settings', 'access', 'search',
  'celebrations', 'townhall', 'ai',
] as const

const MATRIX_ACTIONS = [
  'view', 'create', 'update', 'delete', 'approve', 'export', 'manage', 'assign',
] as const

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', members: 'Members', departments: 'Departments',
  attendance: 'Attendance', visitors: 'Visitors', followups: 'Follow-ups',
  events: 'Events', finance: 'Finance', announcements: 'Announcements',
  pastoral: 'Pastoral Care', tasks: 'Tasks', assets: 'Assets',
  documents: 'Documents', reports: 'Reports', audit: 'Audit Log',
  settings: 'Settings', access: 'Access Control', search: 'Search',
  celebrations: 'Celebrations', townhall: 'Townhall', ai: 'AI Assistant',
}
function moduleLabel(m: string) { return MODULE_LABELS[m] ?? titleCase(m) }

const ACTION_SHORT: Record<string, string> = {
  view: 'V', create: 'C', update: 'U', delete: 'D',
  approve: 'A', export: 'E', manage: 'M', assign: 'S',
}
const ACTION_COLOR: Record<string, string> = {
  view: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  create: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  update: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  delete: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  approve: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  export: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  manage: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
  assign: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
}

// Lockout: these (role.name, module, action) cells can never be unchecked.
const LOCKED_CELLS: { roleName: string; module: string; action: string }[] = [
  { roleName: 'super_admin', module: 'access', action: 'manage' },
  { roleName: 'super_admin', module: 'access', action: 'view' },
  { roleName: 'super_admin', module: 'dashboard', action: 'view' },
]

const ACCESS_LEVEL_COLOR: Record<string, string> = {
  none: 'bg-muted text-muted-foreground border-border',
  masked: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  view: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300',
  edit: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
}

const SCOPE_LABELS: Record<string, { label: string; icon: typeof Globe }> = {
  org: { label: 'Organization', icon: Globe },
  branch: { label: 'Branch', icon: Building2 },
  department: { label: 'Department', icon: Building2 },
  group: { label: 'Group', icon: Layers },
  record: { label: 'Record', icon: Fingerprint },
  self: { label: 'Self', icon: UserCog },
}

const DECISION_COLOR: Record<string, string> = {
  approved: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  revoked: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
  modified: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  pending: 'bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300',
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ===========================================================================
// Types — mirror the API contracts
// ===========================================================================

interface RoleListItem {
  id: string
  name: string
  label: string
  description: string | null
  color: string | null
  isSystem: boolean
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  permissionCount: number
  fieldPermissionCount: number
  userCount: number
}

interface RoleListResponse { roles: RoleListItem[] }

interface RoleDetailResponse {
  role: {
    id: string; name: string; label: string; description: string | null
    color: string | null; isSystem: boolean; active: boolean; sortOrder: number
    createdAt: string; updatedAt: string
  }
  permissions: Record<string, string[]>
  fieldPermissions: Record<string, { field: string; access: string }[]>
  permissionCount: number
  fieldPermissionCount: number
  assignments: RoleAssignmentEntry[]
  assignedUsersCount: number
}

interface RoleAssignmentEntry {
  id: string
  userId: string
  roleId: string
  scopeType: string
  scopeId: string | null
  expiresAt: string | null
  reason: string | null
  createdAt: string
  active: boolean
  user: {
    id: string; name: string; email: string; role: string
    avatarUrl?: string | null; active: boolean; lastLoginAt?: string | null
    department?: { id: string; name: string; color?: string | null } | null
  }
}

interface AccessMatrixResponse {
  matrix: Record<string, Record<string, string[]>>
  modules: string[]
  roles: string[]
  actions: string[]
  roleAssignments: { role: string; count: number; users: any[] }[]
  totalUsers: number
  canEdit: boolean
  currentUser: { id: string; role: string }
  matrixSource: string
}

interface UserLite {
  id: string
  name: string
  email: string
  role: string
  phone?: string | null
  avatarUrl?: string | null
  active: boolean
  departmentId?: string | null
  department?: { id: string; name: string; color?: string | null } | null
  lastLoginAt?: string | null
}
interface UsersResponse { users: UserLite[]; roles: RoleListItem[] }

interface SimulationResponse {
  user: {
    id: string; name: string; email: string; role: string; active: boolean
    departmentId?: string | null; avatarUrl?: string | null
    department?: { id: string; name: string } | null
  }
  simulation: {
    roles: { id: string; name: string; label: string; color: string | null; isSystem: boolean; active: boolean }[]
    modules: string[]
    permissions: Record<string, string[]>
    scopes: { type: string; id?: string }[]
    fieldAccess: Record<string, Record<string, Record<string, string>>>
  }
  readOnly: boolean
  notice: string
}

interface ApprovalPolicyItem {
  id: string; name: string; action: string; description: string | null
  requiresApproval: boolean; approverRoleId: string | null
  approverRole: { id: string; name: string; label: string; color: string | null } | null
  selfApprovalBlocked: boolean; minApprovers: number; active: boolean
  createdAt: string; updatedAt: string
}
interface PoliciesResponse { policies: ApprovalPolicyItem[]; approverRoles: RoleListItem[]; total: number }

interface AccessReviewItem {
  id: string
  userId: string
  user: { id: string; name: string; email: string; role: string; avatarUrl?: string | null }
  roleId: string | null
  role: { id: string; name: string; label: string; color: string | null } | null
  reviewerId: string | null
  reviewer: { id: string; name: string; email: string; role: string } | null
  reviewDate: string
  decision: string
  notes: string | null
  nextReviewDate: string | null
}
interface ReviewsResponse { reviews: AccessReviewItem[]; total: number }

interface AuditItem {
  id: string
  actorId?: string | null
  actor?: { id: string; name: string; email: string; role: string } | null
  action: string
  targetType?: string | null
  targetId?: string | null
  metadata?: string | null
  createdAt: string
}

interface FieldsResponse {
  role: { id: string; name: string; label: string }
  permissions: Record<string, { field: string; access: string }[]>
  catalogue: Record<string, string[]>
  validAccessLevels: string[]
}

// ===========================================================================
// Main module
// ===========================================================================

type TabKey = 'roles' | 'matrix' | 'users' | 'simulation' | 'audit'

export default function AccessModule() {
  const { user, canClient } = useAuth()
  const [tab, setTab] = useState<TabKey>('roles')
  const [matrixRoleId, setMatrixRoleId] = useState<string | null>(null)
  const [usersFilterRoleId, setUsersFilterRoleId] = useState<string | null>(null)
  const [simulateUserId, setSimulateUserId] = useState<string | null>(null)

  const canManage = canClient('access', 'manage')
  const canView = canClient('access', 'view')
  void user

  // Cross-tab navigation callbacks
  const goMatrix = useCallback((roleId: string) => {
    setMatrixRoleId(roleId)
    setTab('matrix')
  }, [])
  const goUsers = useCallback((roleId: string) => {
    setUsersFilterRoleId(roleId)
    setTab('users')
  }, [])
  const goSimulate = useCallback((userId: string) => {
    setSimulateUserId(userId)
    setTab('simulation')
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access Control"
        eyebrow="Security · RBAC + ABAC"
        description="Roles, permissions, scoped assignments, approval policies, and access reviews."
        icon={KeyRound}
        actions={
          canManage ? (
            <Badge variant="outline" className="gap-1.5 bg-primary/5 border-primary/20 text-primary">
              <ShieldCheck className="size-3.5" /> Manager
            </Badge>
          ) : canView ? (
            <Badge variant="outline" className="gap-1.5">
              <Eye className="size-3.5" /> Read-only
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-rose-500/30 text-rose-700">
              <Lock className="size-3.5" /> Restricted
            </Badge>
          )
        }
      />

      {/* Security notice — primary-tinted */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/15">
            <Lock className="size-4" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium">
              Enterprise-grade access governance.
            </p>
            <p className="text-xs text-muted-foreground">
              Multi-role assignments with scope + expiry, field-level permissions, segregation-of-duty
              approval policies, periodic access reviews, and read-only permission simulation. All
              mutations are server-audited (<code className="rounded bg-muted/60 px-1 py-0.5 text-[11px]">access.*</code> actions)
              and matrix-cache-invalidating.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <TabsList className="h-9 overflow-x-auto">
          <TabsTrigger value="roles" className="gap-1.5"><KeyRound className="size-4" /> Roles</TabsTrigger>
          <TabsTrigger value="matrix" className="gap-1.5"><Layers className="size-4" /> Matrix</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5"><UsersIcon className="size-4" /> Users</TabsTrigger>
          <TabsTrigger value="simulation" className="gap-1.5"><FlaskConical className="size-4" /> Simulation</TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5"><ScrollText className="size-4" /> Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="space-y-4">
          <RolesTab canManage={canManage} goMatrix={goMatrix} goUsers={goUsers} />
        </TabsContent>
        <TabsContent value="matrix" className="space-y-4">
          <MatrixTab
            canManage={canManage}
            preselectedRoleId={matrixRoleId}
            onConsumePreselect={() => setMatrixRoleId(null)}
          />
        </TabsContent>
        <TabsContent value="users" className="space-y-4">
          <UsersTab
            canManage={canManage}
            preselectedRoleId={usersFilterRoleId}
            onConsumePreselect={() => setUsersFilterRoleId(null)}
            goSimulate={goSimulate}
          />
        </TabsContent>
        <TabsContent value="simulation" className="space-y-4">
          <SimulationTab preselectedUserId={simulateUserId} onConsumePreselect={() => setSimulateUserId(null)} />
        </TabsContent>
        <TabsContent value="audit" className="space-y-4">
          <AuditTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ===========================================================================
// Tab 1: Roles
// ===========================================================================

function RolesTab({
  canManage, goMatrix, goUsers,
}: {
  canManage: boolean
  goMatrix: (roleId: string) => void
  goUsers: (roleId: string) => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'system' | 'custom' | 'active' | 'inactive'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [editRole, setEditRole] = useState<RoleListItem | null>(null)
  const [cloneRole, setCloneRole] = useState<RoleListItem | null>(null)
  const [deleteRole, setDeleteRole] = useState<RoleListItem | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<RoleListResponse>({
    queryKey: ['access', 'roles'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access/roles')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load roles')
      }
      return res.json()
    },
  })

  // Stats: also need active users count + total grants. We piggy-back on the
  // legacy /api/access endpoint for totalUsers + totalGrants since it already
  // aggregates them server-side.
  const { data: legacy } = useQuery<AccessMatrixResponse>({
    queryKey: ['access', 'matrix-legacy'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access')
      if (!res.ok) throw new Error('Failed to load matrix')
      return res.json()
    },
    enabled: !isLoading,
  })

  const roles = data?.roles ?? []
  const filtered = useMemo(() => {
    let out = roles
    if (filter === 'system') out = out.filter((r) => r.isSystem)
    else if (filter === 'custom') out = out.filter((r) => !r.isSystem)
    else if (filter === 'active') out = out.filter((r) => r.active)
    else if (filter === 'inactive') out = out.filter((r) => !r.active)
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
      )
    }
    return out
  }, [roles, filter, search])

  const totalGrants = useMemo(() => {
    if (!legacy) return 0
    let s = 0
    for (const r of legacy.roles) for (const m of legacy.modules) s += legacy.matrix[r]?.[m]?.length ?? 0
    return s
  }, [legacy])

  // Mutations
  const retireMutation = useMutation({
    mutationFn: async ({ role, active }: { role: RoleListItem; active: boolean }) => {
      const res = await fetch(`/api/access/roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || `Failed to ${active ? 'activate' : 'retire'} role`)
      }
      return res.json()
    },
    onSuccess: (_d, { role, active }) => {
      toast.success(`${role.label} ${active ? 'activated' : 'retired'}`)
      void queryClient.invalidateQueries({ queryKey: ['access', 'roles'] })
      void queryClient.invalidateQueries({ queryKey: ['access'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (role: RoleListItem) => {
      const res = await fetch(`/api/access/roles/${role.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to delete role')
      }
      return res.json()
    },
    onSuccess: (_d, role) => {
      toast.success(`Role "${role.label}" deleted. Affected users reassigned to Member.`)
      void queryClient.invalidateQueries({ queryKey: ['access', 'roles'] })
      void queryClient.invalidateQueries({ queryKey: ['access'] })
      setDeleteRole(null)
    },
    onError: (e: Error) => {
      toast.error(e.message)
      setDeleteRole(null)
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      </div>
    )
  }
  if (isError) {
    return (
      <Card className="border-border/60">
        <EmptyState
          icon={AlertTriangle}
          title="Failed to load roles"
          description="We couldn't fetch the role catalog. Please try again."
          action={<Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2"><RefreshCw className="size-3.5" /> Retry</Button>}
        />
      </Card>
    )
  }

  const systemCount = roles.filter((r) => r.isSystem).length
  const customCount = roles.filter((r) => !r.isSystem).length
  const activeUsers = legacy?.totalUsers ?? 0

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={KeyRound} label="Total Roles" value={roles.length} accent="primary" />
        <StatCard icon={ShieldCheck} label="System Roles" value={systemCount} accent="indigo" />
        <StatCard icon={Layers} label="Custom Roles" value={customCount} accent="violet" />
        <StatCard icon={UsersIcon} label="Active Users" value={activeUsers} accent="emerald" />
        <StatCard icon={Code2} label="Total Grants" value={totalGrants} accent="amber" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2.5 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search roles…"
              className="h-9 pl-8 w-[240px]"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="system">System only</SelectItem>
              <SelectItem value="custom">Custom only</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Retired</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" /> Create Role
          </Button>
        )}
      </div>

      {/* Role cards grid */}
      {filtered.length === 0 ? (
        <Card className="border-border/60">
          <EmptyState
            icon={KeyRound}
            title="No roles match your filters"
            description={search || filter !== 'all'
              ? 'Try clearing the search/filter to see all roles.'
              : 'Create your first custom role to get started.'}
            action={canManage ? <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="size-4" /> Create Role</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <RoleCard
              key={r.id}
              role={r}
              canManage={canManage}
              onEdit={() => setEditRole(r)}
              onClone={() => setCloneRole(r)}
              onRetireToggle={() => retireMutation.mutate({ role: r, active: !r.active })}
              onDelete={() => setDeleteRole(r)}
              onViewMatrix={() => goMatrix(r.id)}
              onManageUsers={() => goUsers(r.id)}
              isRetirePending={retireMutation.isPending && retireMutation.variables?.role.id === r.id}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <RoleCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          existingRoles={roles}
        />
      )}
      {editRole && (
        <RoleEditDialog
          key={editRole.id}
          role={editRole}
          open={!!editRole}
          onOpenChange={(o) => !o && setEditRole(null)}
        />
      )}
      {cloneRole && (
        <RoleCloneDialog
          key={cloneRole.id}
          source={cloneRole}
          open={!!cloneRole}
          onOpenChange={(o) => !o && setCloneRole(null)}
        />
      )}
      {deleteRole && (
        <AlertDialog open={!!deleteRole} onOpenChange={(o) => !o && setDeleteRole(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-rose-600" /> Delete role &quot;{deleteRole.label}&quot;?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the role and its {deleteRole.permissionCount} permission{deleteRole.permissionCount === 1 ? '' : 's'}.
                Any user whose primary role is <code className="rounded bg-muted px-1 py-0.5 text-xs">{deleteRole.name}</code> will be
                downgraded to <strong>Member</strong>. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); deleteMutation.mutate(deleteRole) }}
                disabled={deleteMutation.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete role'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

function RoleCard({
  role, canManage, onEdit, onClone, onRetireToggle, onDelete, onViewMatrix, onManageUsers, isRetirePending,
}: {
  role: RoleListItem
  canManage: boolean
  onEdit: () => void
  onClone: () => void
  onRetireToggle: () => void
  onDelete: () => void
  onViewMatrix: () => void
  onManageUsers: () => void
  isRetirePending: boolean
}) {
  return (
    <Card className={`border-border/60 transition-all hover:shadow-premium-md ${!role.active ? 'opacity-60' : ''}`}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="size-3 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
              style={{ background: role.color ?? '#64748b' }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold truncate">{role.label}</span>
                {role.isSystem ? (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/30 text-primary bg-primary/5">SYSTEM</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-violet-500/30 text-violet-700 dark:text-violet-300 bg-violet-500/5">CUSTOM</Badge>
                )}
                {!role.active && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-rose-500/30 text-rose-700 bg-rose-500/5">RETIRED</Badge>
                )}
              </div>
              <code className="text-[11px] text-muted-foreground font-mono">{role.name}</code>
            </div>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Role actions">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={onEdit}><Pencil className="size-3.5 mr-2" /> Edit details</DropdownMenuItem>
                <DropdownMenuItem onClick={onClone}><Copy className="size-3.5 mr-2" /> Clone role</DropdownMenuItem>
                <DropdownMenuItem onClick={onViewMatrix}><Eye className="size-3.5 mr-2" /> View permissions</DropdownMenuItem>
                <DropdownMenuItem onClick={onManageUsers}><UsersIcon className="size-3.5 mr-2" /> Manage users</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onRetireToggle} disabled={isRetirePending} className={role.active ? 'text-amber-700' : 'text-emerald-700'}>
                  <Power className="size-3.5 mr-2" /> {role.active ? 'Retire role' : 'Activate role'}
                </DropdownMenuItem>
                {!role.isSystem && (
                  <DropdownMenuItem onClick={onDelete} className="text-rose-700 focus:text-rose-700">
                    <Trash2 className="size-3.5 mr-2" /> Delete role
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
          {role.description ?? 'No description provided.'}
        </p>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/60">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Users</div>
            <div className="text-base font-semibold nums">{role.userCount}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Perms</div>
            <div className="text-base font-semibold nums">{role.permissionCount}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Fields</div>
            <div className="text-base font-semibold nums">{role.fieldPermissionCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onViewMatrix} className="gap-1.5 flex-1 h-8">
            <Eye className="size-3.5" /> Permissions
          </Button>
          <Button variant="outline" size="sm" onClick={onManageUsers} className="gap-1.5 flex-1 h-8">
            <UsersIcon className="size-3.5" /> Users
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// --- Create dialog ---
function RoleCreateDialog({
  open, onOpenChange, existingRoles,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  existingRoles: RoleListItem[]
}) {
  const queryClient = useQueryClient()
  // Fresh state each time this component mounts (parent only renders it when open=true).
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#4f46e5')
  const [cloneFromRoleId, setCloneFromRoleId] = useState<string>('')

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/access/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, label, description: description || undefined, color,
          cloneFromRoleId: cloneFromRoleId || undefined,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to create role')
      }
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(`Role "${data.label}" created${data.clonedFrom ? ` (cloned from ${data.clonedFrom.name})` : ''}`)
      void queryClient.invalidateQueries({ queryKey: ['access', 'roles'] })
      void queryClient.invalidateQueries({ queryKey: ['access'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const nameErr = name && !/^[a-z][a-z0-9_]{1,48}$/.test(name) ? 'Must be snake_case (a-z, 0-9, _) — 2–49 chars' : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="size-4" /> Create Custom Role</DialogTitle>
          <DialogDescription>
            Custom roles inherit the same server-side enforcement as system roles. Optionally clone permissions from an existing role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="rc-name">Role name <span className="text-rose-600">*</span></Label>
            <Input
              id="rc-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="media_lead" className="font-mono"
              aria-invalid={!!nameErr}
            />
            {nameErr ? <p className="text-[11px] text-rose-600">{nameErr}</p> : <p className="text-[11px] text-muted-foreground">Snake_case identifier used in code + JWT.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-label">Display label <span className="text-rose-600">*</span></Label>
            <Input id="rc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Media Lead" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-desc">Description</Label>
            <Textarea id="rc-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional summary of what this role can do." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rc-color">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color" value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="size-9 rounded-md border border-border cursor-pointer"
                  aria-label="Pick color"
                />
                <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono text-xs h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-clone">Clone from</Label>
              <Select value={cloneFromRoleId} onValueChange={(v) => setCloneFromRoleId(v === '__blank' ? '' : v)}>
                <SelectTrigger id="rc-clone" className="h-9"><SelectValue placeholder="Start blank" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__blank">— Start blank —</SelectItem>
                  {existingRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label} <span className="text-muted-foreground font-mono text-[10px]">{r.name}</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name || !label || !!nameErr}
            className="gap-2"
          >
            {createMutation.isPending ? 'Creating…' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Edit dialog ---
function RoleEditDialog({
  role, open, onOpenChange,
}: {
  role: RoleListItem
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const queryClient = useQueryClient()
  // Fresh state per role (parent uses key={role.id} so a different role remounts us).
  const [label, setLabel] = useState(role.label)
  const [description, setDescription] = useState(role.description ?? '')
  const [color, setColor] = useState(role.color ?? '#64748b')
  const [active, setActive] = useState(role.active)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/access/roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, description: description || null, color, active }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to update role')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(`Role "${label}" updated`)
      void queryClient.invalidateQueries({ queryKey: ['access', 'roles'] })
      void queryClient.invalidateQueries({ queryKey: ['access'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="size-4" /> Edit Role</DialogTitle>
          <DialogDescription>
            Editing <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">{role.name}</code>{role.isSystem ? ' (system role — label/description/color/active only)' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="re-label">Display label</Label>
            <Input id="re-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="re-desc">Description</Label>
            <Textarea id="re-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="re-color" className="w-16">Color</Label>
            <input
              type="color" value={color}
              onChange={(e) => setColor(e.target.value)}
              className="size-9 rounded-md border border-border cursor-pointer"
            />
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono text-xs h-9 flex-1" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
            <div>
              <Label htmlFor="re-active" className="text-sm font-medium">Active</Label>
              <p className="text-[11px] text-muted-foreground">Inactive roles cannot be assigned to new users.</p>
            </div>
            <Switch id="re-active" checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !label.trim()} className="gap-2">
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Clone dialog ---
function RoleCloneDialog({
  source, open, onOpenChange,
}: {
  source: RoleListItem
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const queryClient = useQueryClient()
  // Fresh state per source role (parent uses key={source.id}).
  const [name, setName] = useState(`${source.name}_copy`)
  const [label, setLabel] = useState(`${source.label} (Copy)`)
  const [description, setDescription] = useState(source.description ?? '')
  const [color, setColor] = useState(source.color ?? '#4f46e5')

  const cloneMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/access/roles/${source.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, label, description: description || undefined, color }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to clone role')
      }
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(`Cloned "${source.label}" → "${data.label}" (${data.permissionCount ?? '?'} permissions)`)
      void queryClient.invalidateQueries({ queryKey: ['access', 'roles'] })
      void queryClient.invalidateQueries({ queryKey: ['access'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const nameErr = name && !/^[a-z][a-z0-9_]{1,48}$/.test(name) ? 'Must be snake_case — 2–49 chars' : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Copy className="size-4" /> Clone Role</DialogTitle>
          <DialogDescription>
            Creates a new custom role by copying <strong>{source.label}</strong> and all its
            <span className="nums"> {source.permissionCount}</span> permission{source.permissionCount === 1 ? '' : 's'} + <span className="nums">{source.fieldPermissionCount}</span> field-permission{source.fieldPermissionCount === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="rcl-name">New role name <span className="text-rose-600">*</span></Label>
            <Input id="rcl-name" value={name} onChange={(e) => setName(e.target.value)} className="font-mono" />
            {nameErr && <p className="text-[11px] text-rose-600">{nameErr}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rcl-label">Display label <span className="text-rose-600">*</span></Label>
            <Input id="rcl-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rcl-desc">Description</Label>
            <Textarea id="rcl-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="rcl-color" className="w-16">Color</Label>
            <input
              type="color" value={color}
              onChange={(e) => setColor(e.target.value)}
              className="size-9 rounded-md border border-border cursor-pointer"
            />
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono text-xs h-9 flex-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => cloneMutation.mutate()}
            disabled={cloneMutation.isPending || !name || !label || !!nameErr}
            className="gap-2"
          >
            {cloneMutation.isPending ? 'Cloning…' : 'Clone role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Tab 2: Permission Matrix (editable)
// ===========================================================================

function MatrixTab({
  canManage, preselectedRoleId, onConsumePreselect,
}: {
  canManage: boolean
  preselectedRoleId: string | null
  onConsumePreselect: () => void
}) {
  const queryClient = useQueryClient()
  const [selectedRoleId, setSelectedRoleId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Record<string, Set<string>> | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Track which role the draft was last synced from (avoids useEffect-based reset).
  const [syncedRoleId, setSyncedRoleId] = useState<string | null>(null)
  // Track which preselect has been consumed (avoids setState-in-effect).
  const [consumedPreselect, setConsumedPreselect] = useState<string | null>(null)

  // Fetch role list
  const { data: rolesData } = useQuery<RoleListResponse>({
    queryKey: ['access', 'roles'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access/roles')
      if (!res.ok) throw new Error('Failed to load roles')
      return res.json()
    },
  })

  // Apply preselected role once — using "set state during render" pattern (React-recommended)
  // instead of useEffect, which avoids cascading renders.
  if (preselectedRoleId && preselectedRoleId !== consumedPreselect && rolesData?.roles.some((r) => r.id === preselectedRoleId)) {
    setConsumedPreselect(preselectedRoleId)
    setSelectedRoleId(preselectedRoleId)
    onConsumePreselect()
  } else if (!selectedRoleId && rolesData?.roles.length) {
    setSelectedRoleId(rolesData.roles[0].id)
  }

  // Fetch role detail
  const { data: roleDetail, isLoading: detailLoading } = useQuery<RoleDetailResponse>({
    queryKey: ['access', 'role', selectedRoleId] as const,
    queryFn: async () => {
      const res = await fetch(`/api/access/roles/${selectedRoleId}`)
      if (!res.ok) throw new Error('Failed to load role detail')
      return res.json()
    },
    enabled: !!selectedRoleId,
  })

  // Sync draft when role detail loads — using "set state during render" pattern
  // (React docs: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  if (roleDetail && syncedRoleId !== roleDetail.role.id) {
    const d: Record<string, Set<string>> = {}
    for (const m of MATRIX_MODULES) d[m] = new Set(roleDetail.permissions[m] ?? [])
    setDraft(d)
    setCollapsed(new Set())
    setSyncedRoleId(roleDetail.role.id)
  }

  const selectedRole = rolesData?.roles.find((r) => r.id === selectedRoleId) ?? null
  const isDirty = useMemo(() => {
    if (!draft || !roleDetail) return false
    for (const m of MATRIX_MODULES) {
      const current = new Set(roleDetail.permissions[m] ?? [])
      const draftSet = draft[m] ?? new Set()
      if (current.size !== draftSet.size) return true
      for (const a of current) if (!draftSet.has(a)) return true
      for (const a of draftSet) if (!current.has(a)) return true
    }
    return false
  }, [draft, roleDetail])

  const filteredModules = useMemo(() => {
    if (!search.trim()) return MATRIX_MODULES
    const q = search.toLowerCase()
    return MATRIX_MODULES.filter((m) => moduleLabel(m).toLowerCase().includes(q) || m.includes(q))
  }, [search])

  const toggleCell = (module: string, action: string) => {
    if (!draft || !canManage) return
    // Lockout: prevent unchecking locked cells on super_admin
    if (selectedRole?.name === 'super_admin') {
      if (LOCKED_CELLS.some((L) => L.roleName === 'super_admin' && L.module === module && L.action === action)) {
        toast.error('Lockout protection: this permission cannot be removed from super_admin.')
        return
      }
    }
    setDraft((prev) => {
      const next = { ...prev }
      const set = new Set(next[module] ?? new Set())
      if (set.has(action)) set.delete(action); else set.add(action)
      next[module] = set
      return next
    })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft || !selectedRoleId) return
      const payload: Record<string, string[]> = {}
      for (const m of MATRIX_MODULES) payload[m] = [...(draft[m] ?? new Set())]
      const res = await fetch(`/api/access/roles/${selectedRoleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: payload }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to save permissions')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Permission matrix updated')
      void queryClient.invalidateQueries({ queryKey: ['access', 'role', selectedRoleId] })
      void queryClient.invalidateQueries({ queryKey: ['access'] })
      void queryClient.invalidateQueries({ queryKey: ['access', 'roles'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const resetDraft = () => {
    if (roleDetail) {
      const d: Record<string, Set<string>> = {}
      for (const m of MATRIX_MODULES) d[m] = new Set(roleDetail.permissions[m] ?? [])
      setDraft(d)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card className="border-border/60">
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Editing role</Label>
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId} disabled={!canManage}>
                <SelectTrigger className="w-[260px] h-9"><SelectValue placeholder="Select a role…" /></SelectTrigger>
                <SelectContent>
                  {(rolesData?.roles ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-full inline-block" style={{ background: r.color ?? '#64748b' }} />
                        {r.label}
                        {!r.active && <span className="text-[10px] text-rose-600">(retired)</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter modules…" className="h-9 pl-8 w-[200px]" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-700 bg-amber-500/5">
                Unsaved changes
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={resetDraft} disabled={!isDirty || saveMutation.isPending} className="gap-2 h-8">
              <RefreshCw className="size-3.5" /> Reset
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!isDirty || saveMutation.isPending || !selectedRoleId} className="gap-2 h-8">
                {saveMutation.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                Save changes
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedRole ? (
        <Card className="border-border/60">
          <EmptyState icon={Layers} title="Select a role" description="Choose a role above to view or edit its permission matrix." />
        </Card>
      ) : detailLoading || !draft || !roleDetail ? (
        <Skeleton className="h-[640px] rounded-xl" />
      ) : (
        <>
          {/* Header strip */}
          <Card className="border-border/60 bg-primary/5">
            <CardContent className="p-3 flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: selectedRole.color ?? '#64748b' }} />
                <span className="font-semibold">{selectedRole.label}</span>
                <code className="font-mono text-muted-foreground">{selectedRole.name}</code>
              </div>
              <Badge variant="outline" className="text-[10px]">{selectedRole.permissionCount} grants</Badge>
              <Badge variant="outline" className="text-[10px]">{selectedRole.userCount} users</Badge>
              {selectedRole.isSystem ? (
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary bg-primary/5">SYSTEM</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-700 bg-violet-500/5">CUSTOM</Badge>
              )}
              {!canManage && (
                <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-700 bg-amber-500/5">
                  <Lock className="size-3 mr-1" /> Read-only
                </Badge>
              )}
            </CardContent>
          </Card>

          {/* Matrix table */}
          <Card className="border-border/60">
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[640px] overflow-y-auto scroll-thin">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                      <TableHead className="sticky left-0 z-20 bg-card min-w-[200px] text-xs uppercase tracking-wide text-muted-foreground font-medium">Module</TableHead>
                      {MATRIX_ACTIONS.map((a) => (
                        <TableHead key={a} className="text-center min-w-[64px] text-xs uppercase tracking-wide text-muted-foreground font-medium">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`inline-flex items-center justify-center size-5 rounded text-[9px] font-bold ${ACTION_COLOR[a]}`}>{ACTION_SHORT[a]}</span>
                            <span className="text-[10px] normal-case tracking-normal">{a}</span>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredModules.map((m) => {
                      const isCollapsed = collapsed.has(m)
                      const activeCount = draft[m]?.size ?? 0
                      const hasAny = activeCount > 0
                      return (
                        <TableRow key={m} className="hover:bg-muted/40 border-border/60">
                          <TableCell className="sticky left-0 z-10 bg-card font-medium text-sm">
                            <div className="flex items-center gap-2">
                              {canManage ? (
                                <button
                                  type="button"
                                  onClick={() => setCollapsed((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(m)) next.delete(m); else next.add(m)
                                    return next
                                  })}
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                                >
                                  {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                                </button>
                              ) : (
                                <span className="size-4 inline-block" />
                              )}
                              <span>{moduleLabel(m)}</span>
                              {hasAny && (
                                <Badge variant="outline" className={`text-[9px] h-4 px-1 ${activeCount === MATRIX_ACTIONS.length ? 'border-emerald-500/30 text-emerald-700 bg-emerald-500/5' : ''}`}>
                                  <span className="nums">{activeCount}</span>/{MATRIX_ACTIONS.length}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          {MATRIX_ACTIONS.map((a) => {
                            const checked = draft[m]?.has(a) ?? false
                            const locked = selectedRole.name === 'super_admin' && LOCKED_CELLS.some((L) => L.module === m && L.action === a)
                            return (
                              <TableCell key={a} className="text-center">
                                <div className="flex items-center justify-center">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => toggleCell(m, a)}
                                    disabled={!canManage || locked}
                                    aria-label={`${moduleLabel(m)} ${a}`}
                                  />
                                  {locked && <Lock className="size-3 text-amber-600 ml-1 absolute pointer-events-none" />}
                                </div>
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Legend */}
          <Card className="border-border/60">
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5"><Info className="size-3.5" /> Legend:</span>
              {MATRIX_ACTIONS.map((a) => (
                <span key={a} className="flex items-center gap-1.5 text-xs">
                  <span className={`inline-flex items-center justify-center size-5 rounded text-[9px] font-bold ${ACTION_COLOR[a]}`}>{ACTION_SHORT[a]}</span>
                  <span className="capitalize">{a}</span>
                </span>
              ))}
              {selectedRole.name === 'super_admin' && (
                <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <Lock className="size-3.5" /> Locked cells protect against super_admin lockout.
                </span>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ===========================================================================
// Tab 3: Users
// ===========================================================================

function UsersTab({
  canManage, preselectedRoleId, onConsumePreselect, goSimulate,
}: {
  canManage: boolean
  preselectedRoleId: string | null
  onConsumePreselect: () => void
  goSimulate: (userId: string) => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [manageUser, setManageUser] = useState<UserLite | null>(null)
  const [suspendUser, setSuspendUser] = useState<UserLite | null>(null)
  // Track which preselect has been consumed (avoids setState-in-effect).
  const [consumedPreselect, setConsumedPreselect] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(search, 350)

  const { data, isLoading, isError, refetch } = useQuery<UsersResponse>({
    queryKey: ['access', 'users', debouncedSearch, roleFilter] as const,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (roleFilter !== 'all') params.set('role', roleFilter)
      const res = await fetch(`/api/access/users?${params}`)
      if (!res.ok) throw new Error('Failed to load users')
      return res.json()
    },
  })

  // Apply preselected role filter once — using "set state during render" pattern.
  if (preselectedRoleId && preselectedRoleId !== consumedPreselect) {
    const r = data?.roles.find((x) => x.id === preselectedRoleId)
    if (r) {
      setConsumedPreselect(preselectedRoleId)
      setRoleFilter(r.name)
      onConsumePreselect()
    }
  }

  const users = data?.users ?? []
  const roles = data?.roles ?? []
  const filtered = useMemo(() => {
    let out = users
    if (statusFilter === 'active') out = out.filter((u) => u.active)
    else if (statusFilter === 'inactive') out = out.filter((u) => !u.active)
    return out
  }, [users, statusFilter])

  // Suspend / activate mutation — uses existing /api/settings/users endpoint if present
  const suspendMutation = useMutation({
    mutationFn: async (u: UserLite) => {
      // Fall back to PATCH /api/settings/users/[id] which is the canonical user route.
      const res = await fetch(`/api/settings/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !u.active }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to change user status')
      }
      return res.json()
    },
    onSuccess: (_d, u) => {
      toast.success(`${u.name} ${u.active ? 'suspended' : 'reactivated'}`)
      void queryClient.invalidateQueries({ queryKey: ['access', 'users'] })
      setSuspendUser(null)
    },
    onError: (e: Error) => { toast.error(e.message); setSuspendUser(null) },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 rounded-lg" />
        <TableSkeleton rows={8} />
      </div>
    )
  }
  if (isError) {
    return (
      <Card className="border-border/60">
        <EmptyState
          icon={AlertTriangle}
          title="Failed to load users"
          description="We couldn't fetch the user directory."
          action={<Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2"><RefreshCw className="size-3.5" /> Retry</Button>}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="border-border/60">
        <CardContent className="p-3 flex flex-col md:flex-row md:items-center gap-2.5 justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…" className="h-9 pl-8 w-[240px]" />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="All roles" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.name}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="nums">{filtered.length}</span> user{filtered.length === 1 ? '' : 's'}
            {roleFilter !== 'all' && <> · filtered by role</>}
          </div>
        </CardContent>
      </Card>

      {/* Users table */}
      <Card className="border-border/60">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState icon={UsersIcon} title="No users found" description="Adjust your filters or search to find users." />
          ) : (
            <div className="overflow-x-auto max-h-[640px] overflow-y-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                    <TableHead className="min-w-[220px] text-xs uppercase tracking-wide text-muted-foreground font-medium">User</TableHead>
                    <TableHead className="min-w-[140px] text-xs uppercase tracking-wide text-muted-foreground font-medium">Primary Role</TableHead>
                    <TableHead className="min-w-[200px] text-xs uppercase tracking-wide text-muted-foreground font-medium">Department</TableHead>
                    <TableHead className="min-w-[120px] text-xs uppercase tracking-wide text-muted-foreground font-medium">Last Login</TableHead>
                    <TableHead className="min-w-[100px] text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => {
                    const role = roles.find((r) => r.name === u.role)
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/40 border-border/60">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8 shrink-0">
                              {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt={u.name} /> : null}
                              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{initials(u.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{u.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {role ? (
                            <Badge variant="outline" className="text-[10px] gap-1" style={{ borderColor: role.color ?? undefined }}>
                              <span className="size-1.5 rounded-full inline-block" style={{ background: role.color ?? '#64748b' }} />
                              {role.label}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">{u.role}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.department ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="size-1.5 rounded-full inline-block" style={{ background: u.department.color ?? '#888' }} />
                              {u.department.name}
                            </span>
                          ) : <span className="text-muted-foreground/60">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground nums">
                          {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}
                        </TableCell>
                        <TableCell>
                          {u.active
                            ? <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-700 bg-emerald-500/5">active</Badge>
                            : <Badge variant="outline" className="text-[10px] border-rose-500/30 text-rose-700 bg-rose-500/5">inactive</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-7" aria-label="User actions">
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Actions</DropdownMenuLabel>
                              {canManage && (
                                <DropdownMenuItem onClick={() => setManageUser(u)}>
                                  <UserCog className="size-3.5 mr-2" /> Manage access
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => goSimulate(u.id)}>
                                <FlaskConical className="size-3.5 mr-2" /> Simulate permissions
                              </DropdownMenuItem>
                              {canManage && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => setSuspendUser(u)}
                                    className={u.active ? 'text-rose-700 focus:text-rose-700' : 'text-emerald-700 focus:text-emerald-700'}
                                  >
                                    <Power className="size-3.5 mr-2" /> {u.active ? 'Suspend user' : 'Reactivate user'}
                                  </DropdownMenuItem>
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
            </div>
          )}
        </CardContent>
      </Card>

      {manageUser && (
        <ManageAccessDialog
          user={manageUser}
          roles={roles}
          open={!!manageUser}
          onOpenChange={(o) => !o && setManageUser(null)}
        />
      )}

      {suspendUser && (
        <AlertDialog open={!!suspendUser} onOpenChange={(o) => !o && setSuspendUser(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-600" />
                {suspendUser.active ? 'Suspend user' : 'Reactivate user'}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {suspendUser.active
                  ? <>This will immediately prevent <strong>{suspendUser.name}</strong> from logging in. Their existing role assignments are preserved and can be restored later.</>
                  : <>This will restore <strong>{suspendUser.name}</strong>&apos;s login access. Their previous role assignments will become effective again.</>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); suspendMutation.mutate(suspendUser) }}
                disabled={suspendMutation.isPending}
                className={suspendUser.active ? 'bg-rose-600 hover:bg-rose-700 text-white' : ''}
              >
                {suspendMutation.isPending ? 'Working…' : suspendUser.active ? 'Suspend user' : 'Reactivate user'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

// --- Manage Access dialog (assign roles with scope + expiry) ---
function ManageAccessDialog({
  user, roles, open, onOpenChange,
}: {
  user: UserLite
  roles: RoleListItem[]
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [newRoleId, setNewRoleId] = useState('')
  const [scopeType, setScopeType] = useState('org')
  const [scopeId, setScopeId] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [reason, setReason] = useState('')

  // Fetch all role-assignments for this user — we batch-call each role's /assignments
  // endpoint and filter to this user client-side.
  const { data: assignments, isLoading } = useQuery<RoleAssignmentEntry[]>({
    queryKey: ['access', 'user-assignments', user.id] as const,
    queryFn: async () => {
      const results = await Promise.all(
        roles.map(async (r) => {
          const res = await fetch(`/api/access/roles/${r.id}/assignments`)
          if (!res.ok) return []
          const data = await res.json()
          return (data.assignments ?? []).filter((a: RoleAssignmentEntry) => a.userId === user.id) as RoleAssignmentEntry[]
        }),
      )
      return results.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    },
    enabled: open,
  })

  const assignMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/access/roles/${newRoleId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          scopeType,
          scopeId: scopeId || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          reason: reason || null,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to assign role')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Role assigned')
      void queryClient.invalidateQueries({ queryKey: ['access', 'user-assignments', user.id] })
      void queryClient.invalidateQueries({ queryKey: ['access', 'roles'] })
      void queryClient.invalidateQueries({ queryKey: ['access', 'users'] })
      // Reset form
      setNewRoleId(''); setScopeType('org'); setScopeId(''); setExpiresAt(''); setReason('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unassignMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const res = await fetch(`/api/access/roles/${newRoleId || assignments?.find((a) => a.id === assignmentId)?.roleId}/assignments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to unassign role')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Role unassigned')
      void queryClient.invalidateQueries({ queryKey: ['access', 'user-assignments', user.id] })
      void queryClient.invalidateQueries({ queryKey: ['access', 'roles'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserCog className="size-4" /> Manage Access — {user.name}</DialogTitle>
          <DialogDescription>
            Assign one or more roles with scope + optional expiry. Multi-role support: a user can hold different roles in different scopes simultaneously.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Current assignments */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current assignments</h4>
              <Badge variant="outline" className="text-[10px] nums">{assignments?.filter((a) => a.active && (!a.expiresAt || new Date(a.expiresAt) > new Date())).length ?? 0} active</Badge>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (assignments?.length ?? 0) === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                No role assignments yet. The user&apos;s primary role <code className="rounded bg-muted px-1 py-0.5 font-mono">{user.role}</code> applies by default.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto scroll-thin pr-1">
                {assignments?.map((a) => {
                  const role = roles.find((r) => r.id === a.roleId)
                  const ScopeIcon = SCOPE_LABELS[a.scopeType]?.icon ?? Globe
                  const expired = a.expiresAt && new Date(a.expiresAt) < new Date()
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center gap-2 rounded-lg border p-2 ${a.active && !expired ? 'border-border/60 bg-card' : 'border-dashed border-border/40 opacity-60'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {role && <span className="size-1.5 rounded-full inline-block" style={{ background: role.color ?? '#64748b' }} />}
                          <span className="text-sm font-medium truncate">{role?.label ?? 'Unknown role'}</span>
                          <Badge variant="outline" className="text-[9px] gap-1"><ScopeIcon className="size-2.5" /> {SCOPE_LABELS[a.scopeType]?.label ?? a.scopeType}{a.scopeId ? ` · ${a.scopeId.slice(-6)}` : ''}</Badge>
                          {a.expiresAt && (
                            <Badge variant="outline" className={`text-[9px] gap-1 ${expired ? 'border-rose-500/30 text-rose-700' : 'border-amber-500/30 text-amber-700'}`}>
                              <Clock className="size-2.5" /> {expired ? 'expired' : 'expires'} {relativeTime(a.expiresAt)}
                            </Badge>
                          )}
                          {!a.active && <Badge variant="outline" className="text-[9px] border-rose-500/30 text-rose-700">inactive</Badge>}
                        </div>
                        {a.reason && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{a.reason}</p>}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-rose-600 hover:text-rose-700 hover:bg-rose-500/5"
                        onClick={() => unassignMutation.mutate(a.id)}
                        disabled={unassignMutation.isPending}
                        aria-label="Unassign"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Add new assignment */}
          <div className="space-y-2.5 rounded-lg border border-border/60 p-3 bg-muted/30">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Plus className="size-3.5" /> Add new assignment
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1 col-span-2">
                <Label className="text-[11px]">Role</Label>
                <Select value={newRoleId} onValueChange={setNewRoleId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select a role…" /></SelectTrigger>
                  <SelectContent>
                    {roles.filter((r) => r.active).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2 rounded-full inline-block" style={{ background: r.color ?? '#64748b' }} />
                          {r.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Scope type</Label>
                <Select value={scopeType} onValueChange={setScopeType}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Scope ID (optional)</Label>
                <Input value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder="dept-xxx / branch-xxx" className="h-9" disabled={scopeType === 'org' || scopeType === 'self'} />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Expires at (optional)</Label>
                <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Reason (optional)</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this assignment?" className="h-9" />
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => assignMutation.mutate()}
              disabled={assignMutation.isPending || !newRoleId}
              className="gap-2 w-full"
            >
              {assignMutation.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Assign role
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Tab 4: Simulation
// ===========================================================================

function SimulationTab({
  preselectedUserId, onConsumePreselect,
}: {
  preselectedUserId: string | null
  onConsumePreselect: () => void
}) {
  const [userId, setUserId] = useState<string>('')
  // Track which preselect has been consumed (avoids setState-in-effect).
  const [consumedPreselect, setConsumedPreselect] = useState<string | null>(null)

  // Fetch users list for the selector
  const { data: usersData } = useQuery<UsersResponse>({
    queryKey: ['access', 'users', '', 'all'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access/users')
      if (!res.ok) throw new Error('Failed to load users')
      return res.json()
    },
  })

  // Apply preselected user — using "set state during render" pattern.
  if (preselectedUserId && preselectedUserId !== consumedPreselect) {
    setConsumedPreselect(preselectedUserId)
    setUserId(preselectedUserId)
    onConsumePreselect()
  }

  const { data, isLoading, isError } = useQuery<SimulationResponse>({
    queryKey: ['access', 'simulate', userId] as const,
    queryFn: async () => {
      const res = await fetch(`/api/access/simulate?userId=${encodeURIComponent(userId)}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to simulate')
      }
      return res.json()
    },
    enabled: !!userId,
  })

  const users = usersData?.users ?? []

  return (
    <div className="space-y-4">
      {/* User selector */}
      <Card className="border-border/60">
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary/10 text-primary grid place-items-center ring-1 ring-inset ring-primary/15">
              <FlaskConical className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Permission simulation</h3>
              <p className="text-xs text-muted-foreground">Preview any user&apos;s effective permissions without accessing data.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-[260px] h-9"><SelectValue placeholder="Select a user…" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} <span className="text-muted-foreground text-[10px]">· {u.email}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!userId ? (
        <Card className="border-border/60">
          <EmptyState
            icon={FlaskConical}
            title="Select a user to simulate their permissions"
            description="Pick a user above to see their effective roles, modules, actions, scopes, and field-level access."
          />
        </Card>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : isError || !data ? (
        <Card className="border-border/60">
          <EmptyState icon={AlertTriangle} title="Failed to simulate" description="We couldn't fetch the simulation. Please try again." />
        </Card>
      ) : (
        <SimulationResult data={data} />
      )}
    </div>
  )
}

function SimulationResult({ data }: { data: SimulationResponse }) {
  const { user, simulation } = data
  return (
    <div className="space-y-4">
      {/* Read-only notice */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-3 flex items-start gap-2.5">
          <Lock className="size-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs">
            <strong>Read-only simulation.</strong> {data.notice} This view reflects the merged
            permissions from the user&apos;s primary role + all active role assignments.
          </p>
        </CardContent>
      </Card>

      {/* User card + roles */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
              <AvatarFallback className="bg-primary/10 text-primary">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold truncate">{user.name}</span>
                {!user.active && <Badge variant="outline" className="text-[9px] border-rose-500/30 text-rose-700">inactive</Badge>}
              </div>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Primary role</div>
              <div className="text-sm font-medium">{user.role}</div>
            </div>
          </div>
          <div className="flex items-start gap-2 flex-wrap pt-2 border-t border-border/60">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground self-center mr-1">Effective roles:</span>
            {simulation.roles.length === 0 ? (
              <span className="text-xs text-muted-foreground">None</span>
            ) : simulation.roles.map((r) => (
              <Badge key={r.id} variant="outline" className="text-[10px] gap-1" style={{ borderColor: r.color ?? undefined }}>
                <span className="size-1.5 rounded-full inline-block" style={{ background: r.color ?? '#64748b' }} />
                {r.label}
                {!r.active && <span className="text-[9px] text-rose-600">(inactive)</span>}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Layers} label="Modules accessible" value={simulation.modules.length} accent="primary" />
        <StatCard icon={Code2} label="Permission grants" value={Object.values(simulation.permissions).reduce((s, a) => s + a.length, 0)} accent="indigo" />
        <StatCard icon={Globe} label="Scopes" value={simulation.scopes.length} accent="violet" />
        <StatCard icon={KeyRound} label="Roles" value={simulation.roles.length} accent="emerald" />
      </div>

      {/* Effective modules + actions */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Layers className="size-4" /> Effective modules &amp; actions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {simulation.modules.length === 0 ? (
            <EmptyState icon={Layers} title="No modules accessible" description="This user has no effective permissions." />
          ) : (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Module</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Allowed actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {simulation.modules.map((m) => (
                    <TableRow key={m} className="hover:bg-muted/40 border-border/60">
                      <TableCell className="font-medium text-sm">{moduleLabel(m)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(simulation.permissions[m] ?? []).map((a) => (
                            <span key={a} className={`inline-flex items-center justify-center size-6 rounded text-[9px] font-bold ${ACTION_COLOR[a] ?? 'bg-muted text-muted-foreground'}`} title={a}>
                              {ACTION_SHORT[a] ?? a.charAt(0).toUpperCase()}
                            </span>
                          ))}
                          {(simulation.permissions[m] ?? []).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scopes */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Globe className="size-4" /> Scopes</CardTitle>
        </CardHeader>
        <CardContent>
          {simulation.scopes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No explicit scoped assignments — falls back to org-wide.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {simulation.scopes.map((s, i) => {
                const meta = SCOPE_LABELS[s.type]
                const Icon = meta?.icon ?? Globe
                return (
                  <Badge key={`${s.type}-${s.id ?? i}`} variant="outline" className="text-[10px] gap-1.5">
                    <Icon className="size-3" /> {meta?.label ?? s.type}
                    {s.id && <span className="text-muted-foreground font-mono">· {s.id.slice(-8)}</span>}
                  </Badge>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Field access */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Fingerprint className="size-4" /> Field-level access</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(simulation.fieldAccess).length === 0 ? (
            <p className="text-xs text-muted-foreground">No field-level permissions configured for this user&apos;s roles.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(simulation.fieldAccess).map(([module, fields]) => (
                <div key={module} className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{moduleLabel(module)}</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(fields).map(([field, roleAccess]) => {
                      // Show highest access level across roles
                      const levels = Object.values(roleAccess)
                      const best = levels.includes('edit') ? 'edit' : levels.includes('view') ? 'view' : levels.includes('masked') ? 'masked' : 'none'
                      return (
                        <span key={field} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${ACCESS_LEVEL_COLOR[best]}`}>
                          <code className="font-mono">{field}</code>
                          <span className="opacity-70">· {best}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ===========================================================================
// Tab 5: Audit (filtered audit log + policies + reviews)
// ===========================================================================

function AuditTab({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reviewUser, setReviewUser] = useState<UserLite | null>(null)
  const [policyOpen, setPolicyOpen] = useState(false)

  const debouncedSearch = useDebouncedValue(search, 350)

  // Fetch audit logs filtered to access.* actions
  const { data: auditData, isLoading: auditLoading, refetch } = useQuery<{ items: AuditItem[]; total: number }>({
    queryKey: ['access', 'audit', debouncedSearch, from, to] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '100' })
      // Always filter by access. prefix when no specific action provided
      if (debouncedSearch) params.set('q', debouncedSearch)
      params.set('action', 'access.')
      if (from) params.set('from', new Date(from).toISOString())
      if (to) {
        const toDate = new Date(to)
        toDate.setHours(23, 59, 59, 999)
        params.set('to', toDate.toISOString())
      }
      const res = await fetch(`/api/audit?${params}`)
      if (!res.ok) throw new Error('Failed to load audit log')
      return res.json()
    },
  })

  const { data: policiesData, refetch: refetchPolicies } = useQuery<PoliciesResponse>({
    queryKey: ['access', 'policies'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access/policies')
      if (!res.ok) throw new Error('Failed to load policies')
      return res.json()
    },
  })

  const { data: reviewsData, refetch: refetchReviews } = useQuery<ReviewsResponse>({
    queryKey: ['access', 'reviews'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access/reviews')
      if (!res.ok) throw new Error('Failed to load reviews')
      return res.json()
    },
  })

  // Fetch users list for the "create review" dialog
  const { data: usersData } = useQuery<UsersResponse>({
    queryKey: ['access', 'users', '', 'all'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access/users')
      if (!res.ok) throw new Error('Failed to load users')
      return res.json()
    },
    enabled: canManage,
  })

  return (
    <div className="space-y-4">
      {/* Top toolbar */}
      <Card className="border-border/60">
        <CardContent className="p-3 flex flex-col md:flex-row md:items-center gap-2.5 justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions / targets…" className="h-9 pl-8 w-[240px]" />
            </div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[140px]" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[140px]" />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{auditData?.total ?? 0} events</Badge>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 h-8"><RefreshCw className="size-3.5" /> Refresh</Button>
          </div>
        </CardContent>
      </Card>

      {/* Audit table */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><History className="size-4" /> Access-control audit trail</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditLoading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : (auditData?.items ?? []).length === 0 ? (
            <EmptyState icon={ScrollText} title="No audit events yet" description="Access-control mutations will appear here. Create a role, change permissions, or assign a user to populate the trail." />
          ) : (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">When</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Actor</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Action</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Target</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditData?.items.map((l) => (
                    <TableRow key={l.id} className="hover:bg-muted/40 border-border/60">
                      <TableCell className="text-xs text-muted-foreground nums whitespace-nowrap">{formatDateTime(l.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Avatar className="size-6">
                            <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                              {initials(l.actor?.name ?? '?')}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{l.actor?.name ?? 'system'}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{l.actor?.email ?? '—'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-[11px] font-mono rounded bg-muted px-1.5 py-0.5">{l.action}</code>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">{l.targetType ?? '—'}</span>
                          {l.targetId && <code className="text-[10px] font-mono text-muted-foreground truncate max-w-[160px]">{l.targetId}</code>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.metadata ? (
                          <code className="font-mono text-[10px] block max-w-[280px] truncate">{l.metadata}</code>
                        ) : <span>—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Policies + Reviews side-by-side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Approval Policies */}
        <Card className="border-border/60">
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><FileCheck2 className="size-4" /> Approval Policies (SoD)</CardTitle>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setPolicyOpen(true)} className="gap-2 h-7">
                <Plus className="size-3.5" /> New
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {(policiesData?.policies ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground py-3">No approval policies. Create one to require dual approval for sensitive operations.</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto scroll-thin pr-1">
                {policiesData?.policies.map((p) => (
                  <div key={p.id} className={`rounded-lg border p-2.5 ${p.active ? 'border-border/60' : 'border-dashed border-border/40 opacity-60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{p.name}</span>
                          {!p.active && <Badge variant="outline" className="text-[9px]">inactive</Badge>}
                        </div>
                        <code className="text-[10px] font-mono text-muted-foreground">{p.action}</code>
                      </div>
                      <Badge variant="outline" className={`text-[9px] ${p.requiresApproval ? 'border-amber-500/30 text-amber-700 bg-amber-500/5' : 'border-emerald-500/30 text-emerald-700 bg-emerald-500/5'}`}>
                        {p.requiresApproval ? 'requires approval' : 'auto'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                      {p.approverRole && <Badge variant="outline" className="text-[9px]" style={{ borderColor: p.approverRole.color ?? undefined }}>approver: {p.approverRole.label}</Badge>}
                      <span>min approvers: <span className="nums">{p.minApprovers}</span></span>
                      {p.selfApprovalBlocked && <Badge variant="outline" className="text-[9px] border-rose-500/30 text-rose-700">no self-approval</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Access Reviews */}
        <Card className="border-border/60">
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Calendar className="size-4" /> Access Reviews</CardTitle>
            {canManage && (
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  const u = usersData?.users?.[0]
                  if (u) setReviewUser(u)
                }}
                className="gap-2 h-7"
              >
                <Plus className="size-3.5" /> New
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {(reviewsData?.reviews ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground py-3">No access reviews recorded. Periodic access reviews help maintain least-privilege hygiene.</div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-thin pr-1">
                {reviewsData?.reviews.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border/60 p-2.5 flex items-start gap-2">
                    <Avatar className="size-7 shrink-0">
                      <AvatarFallback className="text-[9px] bg-primary/10 text-primary">{initials(r.user?.name ?? '?')}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium truncate">{r.user?.name ?? 'Unknown'}</span>
                        <Badge variant="outline" className={`text-[9px] ${DECISION_COLOR[r.decision] ?? ''}`}>{r.decision}</Badge>
                        {r.role && <Badge variant="outline" className="text-[9px]" style={{ borderColor: r.role.color ?? undefined }}>{r.role.label}</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        reviewed by {r.reviewer?.name ?? 'system'} · {formatDateTime(r.reviewDate)}
                        {r.nextReviewDate && <span> · next: {formatDateTime(r.nextReviewDate)}</span>}
                      </div>
                      {r.notes && <p className="text-[11px] text-muted-foreground mt-0.5 italic">{r.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {policyOpen && (
        <PolicyCreateDialog
          open={policyOpen}
          onOpenChange={setPolicyOpen}
          approverRoles={policiesData?.approverRoles ?? []}
          onCreated={() => { void refetchPolicies() }}
        />
      )}
      {reviewUser && (
        <ReviewCreateDialog
          key={reviewUser.id}
          user={reviewUser}
          users={usersData?.users ?? []}
          roles={usersData?.roles ?? []}
          open={!!reviewUser}
          onOpenChange={(o) => !o && setReviewUser(null)}
          onCreated={() => { void refetchReviews() }}
        />
      )}
    </div>
  )
}

function PolicyCreateDialog({
  open, onOpenChange, approverRoles, onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  approverRoles: RoleListItem[]
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [action, setAction] = useState('')
  const [description, setDescription] = useState('')
  const [requiresApproval, setRequiresApproval] = useState(true)
  const [approverRoleId, setApproverRoleId] = useState('')
  const [selfApprovalBlocked, setSelfApprovalBlocked] = useState(true)
  const [minApprovers, setMinApprovers] = useState(1)
  // Fresh state each mount — parent only renders this component when open=true.

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/access/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, action, description: description || undefined,
          requiresApproval, approverRoleId: approverRoleId || undefined,
          selfApprovalBlocked, minApprovers,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to create policy')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Approval policy created')
      onCreated()
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileCheck2 className="size-4" /> New Approval Policy</DialogTitle>
          <DialogDescription>Enforce segregation of duties for sensitive operations.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Policy name <span className="text-rose-600">*</span></Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Expense approval > ₦100k" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-action">Action key <span className="text-rose-600">*</span></Label>
            <Input id="p-action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="finance.expense.approve" className="font-mono" />
            <p className="text-[11px] text-muted-foreground">Dotted identifier — match against <code className="font-mono">requiresApproval(action)</code> calls in code.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-approver">Approver role</Label>
              <Select value={approverRoleId} onValueChange={(v) => setApproverRoleId(v === '__any' ? '' : v)}>
                <SelectTrigger id="p-approver" className="h-9"><SelectValue placeholder="Any admin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">— Any —</SelectItem>
                  {approverRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-min">Min approvers</Label>
              <Input id="p-min" type="number" min={1} max={10} value={minApprovers} onChange={(e) => setMinApprovers(parseInt(e.target.value, 10) || 1)} className="h-9" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-2.5">
            <Label htmlFor="p-req" className="text-xs">Requires approval</Label>
            <Switch id="p-req" checked={requiresApproval} onCheckedChange={setRequiresApproval} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-2.5">
            <div>
              <Label htmlFor="p-self" className="text-xs">Block self-approval</Label>
              <p className="text-[10px] text-muted-foreground">The actor who initiated the action cannot approve it.</p>
            </div>
            <Switch id="p-self" checked={selfApprovalBlocked} onCheckedChange={setSelfApprovalBlocked} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !name || !action} className="gap-2">
            {createMutation.isPending ? 'Creating…' : 'Create policy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReviewCreateDialog({
  user, users, roles, open, onOpenChange, onCreated,
}: {
  user: UserLite
  users: UserLite[]
  roles: RoleListItem[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const [userId, setUserId] = useState(user.id)
  const [roleId, setRoleId] = useState('')
  const [decision, setDecision] = useState('approved')
  const [notes, setNotes] = useState('')
  const [nextReviewDate, setNextReviewDate] = useState('')
  // Fresh state each mount — parent renders this component only when reviewUser != null,
  // and uses key={reviewUser.id} so a different user remounts us.

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/access/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, roleId: roleId || undefined, decision,
          notes: notes || undefined,
          nextReviewDate: nextReviewDate ? new Date(nextReviewDate).toISOString() : undefined,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to create review')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Access review recorded')
      onCreated()
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Calendar className="size-4" /> Record Access Review</DialogTitle>
          <DialogDescription>Periodic access review — attest, revoke, or modify a user&apos;s access.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="r-user">User <span className="text-rose-600">*</span></Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="r-user" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} <span className="text-muted-foreground text-[10px]">· {u.email}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-role">Role reviewed (optional)</Label>
            <Select value={roleId} onValueChange={(v) => setRoleId(v === '__all' ? '' : v)}>
              <SelectTrigger id="r-role" className="h-9"><SelectValue placeholder="All roles / overall" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">— Overall access —</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-decision">Decision <span className="text-rose-600">*</span></Label>
            <Select value={decision} onValueChange={setDecision}>
              <SelectTrigger id="r-decision" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approved — access retained</SelectItem>
                <SelectItem value="modified">Modified — access adjusted</SelectItem>
                <SelectItem value="revoked">Revoked — access removed</SelectItem>
                <SelectItem value="pending">Pending — under review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-notes">Notes</Label>
            <Textarea id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional context for this review decision." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-next">Next review date</Label>
            <Input id="r-next" type="date" value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} className="h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !userId || !decision} className="gap-2">
            {createMutation.isPending ? 'Recording…' : 'Record review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
