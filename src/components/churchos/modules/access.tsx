'use client'

// ChurchOS — Access Control module (Task ID 9)
// Two tabs:
//   1. Permission Matrix — read-only viewer of the live role/module/action matrix
//      defined in src/lib/permissions.ts. Admins (church_admin, super_admin) can
//      SEE exactly what each role can do.
//   2. Role Assignments — for each role, the list of users currently assigned.
//      Provides a "Manage users" shortcut to Settings → Users & Roles.
//
// The matrix is CODE-DEFINED for security. To change a role's permissions, edit
// `src/lib/permissions.ts` and redeploy. To change a user's role, use Users & Roles.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-store'
import { relativeTime, titleCase } from '@/lib/format'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  KeyRound, ShieldCheck, Lock, Info, Users as UsersIcon, Eye, Code2,
  ArrowRight, CircleDot,
} from 'lucide-react'

// ---------- types ----------
interface MatrixResponse {
  matrix: Record<string, Record<string, string[]>>
  modules: string[]
  roles: string[]
  actions: string[]
  roleAssignments: RoleAssignment[]
  totalUsers: number
  canEdit: boolean
  currentUser: { id: string; role: string }
  matrixSource: string
}
interface RoleAssignment {
  role: string
  count: number
  users: UserLite[]
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

// ---------- role meta ----------
const ROLE_META: Record<string, { label: string; color: string }> = {
  super_admin: { label: 'Super Admin', color: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300' },
  church_admin: { label: 'Church Admin', color: 'bg-primary/10 text-primary border-primary/20' },
  pastor: { label: 'Pastor', color: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300' },
  finance_officer: { label: 'Finance Officer', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300' },
  department_head: { label: 'Department Head', color: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300' },
  department_assistant: { label: 'Dept Assistant', color: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300' },
  unit_leader: { label: 'Unit Leader', color: 'bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300' },
  member: { label: 'Member', color: 'bg-muted text-muted-foreground border-border' },
  guest: { label: 'Guest', color: 'bg-muted text-muted-foreground border-border' },
}
function roleLabel(r: string) { return ROLE_META[r]?.label ?? titleCase(r) }
function roleColor(r: string) { return ROLE_META[r]?.color ?? 'bg-muted text-muted-foreground border-border' }

const ACTION_META: Record<string, { label: string; short: string; color: string }> = {
  view: { label: 'View', short: 'V', color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  create: { label: 'Create', short: 'C', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  update: { label: 'Update', short: 'U', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  delete: { label: 'Delete', short: 'D', color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  approve: { label: 'Approve', short: 'A', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  export: { label: 'Export', short: 'E', color: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' },
  manage: { label: 'Manage', short: 'M', color: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300' },
  assign: { label: 'Assign', short: 'S', color: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
}

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', members: 'Members', departments: 'Departments',
  attendance: 'Attendance', visitors: 'Visitors', followups: 'Follow-ups',
  events: 'Events', finance: 'Finance', announcements: 'Announcements',
  pastoral: 'Pastoral Care', tasks: 'Tasks', assets: 'Assets',
  documents: 'Documents', reports: 'Reports', audit: 'Audit Log',
  settings: 'Settings',
}
function moduleLabel(m: string) { return MODULE_LABELS[m] ?? titleCase(m) }

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

// ---------- main module ----------
export default function AccessModule() {
  const { user } = useAuth()
  const role = user?.role ?? 'member'
  const canEdit = role === 'super_admin'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
              <KeyRound className="size-4" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Access Control</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Inspect the role-based permission matrix and see who has each role.
          </p>
        </div>
        {canEdit ? (
          <Badge variant="outline" className="gap-1.5 self-start bg-primary/5">
            <ShieldCheck className="size-3.5" /> Super Admin · full visibility
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5 self-start">
            <Eye className="size-3.5" /> Read-only viewer
          </Badge>
        )}
      </div>

      {/* Security notice */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/15 text-primary grid place-items-center shrink-0">
            <Lock className="size-4" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium">
              Permission matrix is defined in application code.
            </p>
            <p className="text-xs text-muted-foreground">
              For security, role permissions live in <code className="rounded bg-muted/60 px-1 py-0.5 text-[11px]">src/lib/permissions.ts</code> and are evaluated server-side on every request.
              To change a role&apos;s permissions, contact the platform administrator or modify the matrix and redeploy.
              To change a user&apos;s role, use <strong>Users &amp; Roles</strong>.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="matrix" className="space-y-4">
        <TabsList>
          <TabsTrigger value="matrix" className="gap-2"><KeyRound className="size-4" /> Permission Matrix</TabsTrigger>
          <TabsTrigger value="assignments" className="gap-2"><UsersIcon className="size-4" /> Role Assignments</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix" className="space-y-4">
          <MatrixTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="assignments" className="space-y-4">
          <RoleAssignmentsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- matrix tab ----------
function MatrixTab({ canEdit }: { canEdit: boolean }) {
  const [focusRole, setFocusRole] = useState<string>('__all')

  const { data, isLoading, isError, refetch } = useQuery<MatrixResponse>({
    queryKey: ['access', 'matrix'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load access matrix')
      }
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm font-medium text-destructive mb-2">Failed to load permission matrix</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </CardContent>
      </Card>
    )
  }

  const { matrix, modules, roles, actions, roleAssignments, totalUsers, matrixSource } = data

  // Total permission grants for the stats strip
  let totalGrants = 0
  for (const r of roles) for (const m of modules) totalGrants += (matrix[r]?.[m]?.length ?? 0)

  const focusActive = focusRole !== '__all'

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={UsersIcon} label="Users" value={totalUsers} accent="bg-primary/10 text-primary" />
        <StatTile icon={KeyRound} label="Roles" value={roles.length} accent="bg-violet-500/10 text-violet-600" />
        <StatTile icon={Code2} label="Modules" value={modules.length} accent="bg-sky-500/10 text-sky-600" />
        <StatTile icon={ShieldCheck} label="Permission grants" value={totalGrants} accent="bg-emerald-500/10 text-emerald-600" />
      </div>

      {/* Role distribution */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Distribution:</span>
            {roleAssignments.map((ra) => (
              <Badge key={ra.role} variant="outline" className={`text-[10px] ${roleColor(ra.role)}`}>
                {roleLabel(ra.role)}: {ra.count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Focus role selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Matrix · {modules.length} modules × {roles.length} roles × {actions.length} actions</h3>
          <p className="text-xs text-muted-foreground">
            Cells show the action codes granted to each role. Empty cell = no access. Use the role selector to focus.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Focus role:</Label>
          <Select value={focusRole} onValueChange={setFocusRole}>
            <SelectTrigger className="w-[200px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All roles</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Matrix table */}
      <Card className="border-border/60">
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[640px] overflow-y-auto scroll-thin">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="sticky left-0 z-20 bg-card min-w-[180px]">Module</TableHead>
                  {roles.map((r) => (
                    <TableHead
                      key={r}
                      className={`text-center min-w-[120px] ${focusActive && r !== focusRole ? 'opacity-40' : ''}`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[11px] font-semibold">{roleLabel(r)}</span>
                        <Badge variant="outline" className={`text-[9px] h-4 px-1 ${roleColor(r)}`}>
                          {roleAssignments.find((ra) => ra.role === r)?.count ?? 0} users
                        </Badge>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {modules.map((m) => (
                  <TableRow key={m} className="hover:bg-muted/40">
                    <TableCell className="sticky left-0 z-10 bg-card font-medium">
                      {moduleLabel(m)}
                    </TableCell>
                    {roles.map((r) => {
                      const acts = matrix[r]?.[m] ?? []
                      const dim = focusActive && r !== focusRole
                      return (
                        <TableCell key={r} className={`text-center ${dim ? 'opacity-30' : ''}`}>
                          {acts.length === 0 ? (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          ) : (
                            <div className="flex flex-wrap justify-center gap-1">
                              {acts.map((a) => (
                                <span
                                  key={a}
                                  title={ACTION_META[a]?.label ?? a}
                                  className={`inline-flex items-center justify-center size-5 rounded text-[9px] font-bold ${ACTION_META[a]?.color ?? 'bg-muted text-muted-foreground'}`}
                                >
                                  {ACTION_META[a]?.short ?? a.charAt(0).toUpperCase()}
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Info className="size-3.5" /> Action legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <div key={a} className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1">
                <span className={`inline-flex items-center justify-center size-5 rounded text-[9px] font-bold ${ACTION_META[a]?.color ?? 'bg-muted text-muted-foreground'}`}>
                  {ACTION_META[a]?.short ?? a.charAt(0).toUpperCase()}
                </span>
                <span className="text-xs">{ACTION_META[a]?.label ?? titleCase(a)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Footer notice */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Code2 className="size-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              Source: <code className="rounded bg-amber-500/10 px-1 py-0.5">{matrixSource}</code>
            </p>
            <p className="text-amber-700/80 dark:text-amber-400/80">
              This matrix is enforced server-side on every API request via <code className="rounded bg-amber-500/10 px-1 py-0.5">requirePermission()</code>.
              {canEdit
                ? ' You can edit user roles from the Role Assignments tab or Users & Roles.'
                : ' You can edit user roles in Users & Roles.'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- role assignments tab ----------
function RoleAssignmentsTab() {
  const { setModule } = useAuth()
  const { data, isLoading, isError, refetch } = useQuery<MatrixResponse>({
    queryKey: ['access', 'matrix'] as const,
    queryFn: async () => {
      const res = await fetch('/api/access')
      if (!res.ok) throw new Error('Failed to load')
      return res.json()
    },
  })

  if (isLoading) {
    return <Skeleton className="h-96 rounded-xl" />
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm font-medium text-destructive mb-2">Failed to load role assignments</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </CardContent>
      </Card>
    )
  }

  const { roleAssignments, currentUser } = data

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Roles &amp; assignments</h3>
          <p className="text-xs text-muted-foreground">
            {data.totalUsers} users across {roleAssignments.length} roles. Change a user&apos;s role in Users &amp; Roles.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setModule('settings')} className="gap-2 self-start">
          <ArrowRight className="size-3.5" /> Manage users
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {roleAssignments.map((ra) => (
          <Card key={ra.role} className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge variant="outline" className={roleColor(ra.role)}>{roleLabel(ra.role)}</Badge>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {ra.count} {ra.count === 1 ? 'user' : 'users'}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {ra.users.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                  <CircleDot className="size-3.5" /> No users assigned to this role.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto scroll-thin pr-1">
                  {ra.users.map((u) => {
                    const isSelf = u.id === currentUser.id
                    return (
                      <div
                        key={u.id}
                        className="flex items-center gap-3 rounded-md border border-border/60 p-2 hover:bg-muted/40 transition-colors"
                      >
                        <Avatar className="size-8 shrink-0">
                          {u.avatarUrl ? <AvatarImage src={u.avatarUrl} /> : null}
                          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                            {initials(u.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {u.name}
                            {isSelf && <span className="text-xs text-muted-foreground ml-1">(you)</span>}
                            {!u.active && (
                              <Badge variant="outline" className="ml-2 text-[9px] h-4 px-1 border-rose-500/30 text-rose-700">
                                inactive
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                        {u.department && (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            <span
                              className="size-1.5 rounded-full mr-1 inline-block"
                              style={{ background: u.department.color ?? '#888' }}
                            />
                            {u.department.name}
                          </Badge>
                        )}
                        <div className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">
                          {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Permission scope notice */}
      <Card className="border-border/60 bg-muted/30">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="size-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong>Scoped roles</strong> (department_head, department_assistant, unit_leader) are
              further restricted to their own department at runtime — even if the matrix grants an action,
              the database query filters by the user&apos;s <code className="rounded bg-muted px-1 py-0.5">departmentId</code>.
            </p>
            <p>
              <strong>Deny-by-default:</strong> any role/module/action combination not present in the
              matrix returns <code className="rounded bg-muted px-1 py-0.5">403 Forbidden</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- shared mini stat ----------
function StatTile({ icon: Icon, label, value, accent }: {
  icon: typeof UsersIcon
  label: string
  value: number | string
  accent: string
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`size-9 rounded-lg grid place-items-center ${accent}`}>
          <Icon className="size-4" />
        </div>
        <div>
          <p className="text-xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}
