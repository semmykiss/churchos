'use client'

// ChurchOS — Audit Log module
// Read-only administrative audit trail with filters + CSV export.
import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { formatDateTime, relativeTime, titleCase } from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  ShieldCheck, Search, Filter, Download, ShieldAlert, RefreshCw, Lock,
  X, ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  PageHeader, EmptyState, Toolbar, TableSkeleton,
} from '@/components/churchos/ui'

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
interface AuditListResponse {
  items: AuditItem[]
  total: number
  page: number
  pageSize: number
  actors: { id: string; name: string; email: string; role: string }[]
}

function useDebouncedValue<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function actionColor(action: string): string {
  if (action.includes('.delete')) return 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300'
  if (action.includes('.create')) return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300'
  if (action.includes('.update') || action.includes('.change')) return 'bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300'
  if (action.includes('.approve')) return 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300'
  if (action.includes('.export')) return 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300'
  if (action.includes('password') || action.includes('auth')) return 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300'
  return 'bg-muted text-muted-foreground border-border'
}

function truncateMetadata(meta: string | null | undefined, max = 80): string {
  if (!meta) return '—'
  try {
    const obj = JSON.parse(meta)
    const flat = JSON.stringify(obj)
    return flat.length > max ? flat.slice(0, max) + '…' : flat
  } catch {
    return meta.length > max ? meta.slice(0, max) + '…' : meta
  }
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export default function AuditModule() {
  const { user } = useAuth()
  const role = user?.role ?? 'member'
  const canView = can(role, 'audit', 'view')
  const canExport = can(role, 'audit', 'export')

  const [search, setSearch] = useState('')
  const [actorId, setActorId] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 50
  const debouncedSearch = useDebouncedValue(search, 350)

  // Reset page when filters change — wrapped to defer setState past the effect body.
  useEffect(() => {
    void Promise.resolve().then(() => setPage(1))
  }, [debouncedSearch, actorId, action, from, to])

  const queryKey = useMemo(
    () => ['audit', 'list', debouncedSearch, actorId, action, from, to, page] as const,
    [debouncedSearch, actorId, action, from, to, page],
  )

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AuditListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (actorId) params.set('actorId', actorId)
      if (action) params.set('action', action)
      if (from) params.set('from', new Date(from).toISOString())
      if (to) params.set('to', new Date(to).toISOString())
      const res = await fetch(`/api/audit?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load audit log')
      }
      return res.json()
    },
    enabled: canView,
  })

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  const resetFilters = () => {
    setSearch(''); setActorId(''); setAction(''); setFrom(''); setTo(''); setPage(1)
  }

  // CSV export — client-side from current page (capped)
  const exportCsv = () => {
    if (!data || data.items.length === 0) {
      toast.error('Nothing to export')
      return
    }
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }
    const rows = [
      ['Timestamp', 'Actor', 'Email', 'Role', 'Action', 'Target Type', 'Target ID', 'Metadata'],
      ...data.items.map((i) => [
        i.createdAt,
        i.actor?.name ?? 'System',
        i.actor?.email ?? '',
        i.actor?.role ?? '',
        i.action,
        i.targetType ?? '',
        i.targetId ?? '',
        i.metadata ?? '',
      ]),
    ]
    const csv = rows.map((r) => r.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${data.items.length} audit entries`)
  }

  // Member role / no access guard
  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Audit Log"
          eyebrow="Administration"
          description="Every administrative action is recorded for accountability."
          icon={ShieldCheck}
        />
        <Card className="border-border/60">
          <EmptyState
            icon={Lock}
            title="Restricted — administrative access only"
            description="The audit log is available to church administrators only."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        eyebrow="Administration"
        description="Every administrative action is recorded for accountability."
        icon={ShieldCheck}
        actions={
          canExport ? (
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
              <Download className="size-4" /> Export CSV
            </Button>
          ) : undefined
        }
      />

      {/* Restricted notice — primary-tinted */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="size-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/15">
            <ShieldAlert className="size-4" />
          </div>
          <div className="text-sm">
            <p className="font-medium">Restricted — administrative access only</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              Every write operation in ChurchOS is recorded here. The audit log is read-only.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <Toolbar>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search action, target, metadata…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
                aria-label="Search audit log"
              />
            </div>
            <Select value={actorId || '__all'} onValueChange={(v) => setActorId(v === '__all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-48 h-9" aria-label="Filter by actor">
                <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All actors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All actors</SelectItem>
                {(data?.actors ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name} · {titleCase(a.role)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Action contains (e.g. create)"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="h-9 md:w-52"
            />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 md:w-40" aria-label="From date" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 md:w-40" aria-label="To date" />
          </Toolbar>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-2">
              <X className="size-3.5" /> Reset filters
            </Button>
            {isFetching && <span className="text-xs text-muted-foreground">Syncing…</span>}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <TableSkeleton rows={8} />
      ) : isError ? (
        <Card className="border-border/60">
          <EmptyState
            icon={ShieldAlert}
            title="Failed to load audit log"
            description="We couldn't fetch the audit entries. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            }
          />
        </Card>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card className="border-border/60">
          <EmptyState
            icon={ShieldCheck}
            title="No audit entries match your filters"
            description="Try adjusting or clearing the filters."
          />
        </Card>
      ) : (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-22rem)] overflow-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                    <TableHead className="w-[180px] text-xs uppercase tracking-wide text-muted-foreground font-medium">Timestamp</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Actor</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Action</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Target</TableHead>
                    <TableHead className="min-w-[260px] text-xs uppercase tracking-wide text-muted-foreground font-medium">Metadata</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.items.map((entry) => (
                    <TableRow key={entry.id} className="hover:bg-muted/40 border-border/60">
                      <TableCell className="align-top">
                        <div>
                          <p className="font-medium text-sm nums">{formatDateTime(entry.createdAt)}</p>
                          <p className="text-xs text-muted-foreground nums">{relativeTime(entry.createdAt)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {entry.actor ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="size-7 shrink-0">
                              <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
                                {initials(entry.actor.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{entry.actor.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {titleCase(entry.actor.role)} · {entry.actor.email}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">System</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className={`text-[10px] font-mono font-medium ${actionColor(entry.action)}`}>
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top">
                        <p className="text-sm">{entry.targetType ? titleCase(entry.targetType) : '—'}</p>
                        {entry.targetId && (
                          <p className="font-mono text-xs text-muted-foreground">
                            {entry.targetId.length > 18 ? entry.targetId.slice(0, 8) + '…' : entry.targetId}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <p className="font-mono text-xs text-muted-foreground">
                          {truncateMetadata(entry.metadata)}
                        </p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-border/60 p-3">
              <p className="text-xs text-muted-foreground nums">
                Page {data!.page} of {totalPages} · {data!.total} entries
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data!.page <= 1}
                  className="gap-1.5"
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={data!.page >= totalPages}
                  className="gap-1.5"
                >
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
