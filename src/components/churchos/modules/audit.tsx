'use client'

// ChurchOS — Audit Log module
// Read-only administrative audit trail with filters + CSV export.
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { formatDateTime, relativeTime, titleCase } from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  ShieldCheck, Search, Filter, Download, ShieldAlert, RefreshCw, Lock, X, ChevronLeft, ChevronRight,
} from 'lucide-react'

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
  if (action.includes('.update') || action.includes('.change')) return 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300'
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
        <Header />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Lock className="size-10 text-rose-500" />
            <div>
              <p className="font-medium">Restricted — administrative access only</p>
              <p className="text-sm text-muted-foreground">
                The audit log is available to church administrators only.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header canExport={canExport} onExport={exportCsv} />

      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldAlert className="size-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">Restricted — administrative access only</p>
            <p className="text-muted-foreground">
              Every write operation in ChurchOS is recorded here. The audit log is read-only.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search action, target, metadata…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={actorId || '__all'} onValueChange={(v) => setActorId(v === '__all' ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="All actors" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All actors</SelectItem>
            {(data?.actors ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name} · {titleCase(a.role)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Action contains (e.g. create)" value={action} onChange={(e) => setAction(e.target.value)} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1">
          <X className="size-4" /> Reset filters
        </Button>
        {isFetching && <span className="text-xs text-muted-foreground">Syncing…</span>}
      </div>

      {isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="size-8 text-rose-500" />
            <p className="text-sm text-muted-foreground">Failed to load audit log.</p>
            <Button variant="outline" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldCheck className="size-10 text-muted-foreground/60" />
            <div>
              <p className="font-medium">No audit entries match your filters</p>
              <p className="text-sm text-muted-foreground">Try adjusting or clearing the filters.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-22rem)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="w-[160px]">Timestamp</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="min-w-[260px]">Metadata</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="align-top">
                        <div>
                          <p className="font-medium">{formatDateTime(entry.createdAt)}</p>
                          <p className="text-xs text-muted-foreground">{relativeTime(entry.createdAt)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {entry.actor ? (
                          <div>
                            <p className="font-medium">{entry.actor.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {titleCase(entry.actor.role)} · {entry.actor.email}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">System</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className={`text-[10px] font-mono ${actionColor(entry.action)}`}>
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
            <div className="flex items-center justify-between border-t p-3">
              <p className="text-xs text-muted-foreground">
                Page {data!.page} of {totalPages} · {data!.total} entries
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data!.page <= 1}
                  className="gap-1"
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={data!.page >= totalPages}
                  className="gap-1"
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

function Header({ canExport, onExport }: { canExport?: boolean; onExport?: () => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="size-6 text-primary" />
          Audit Log
        </h1>
        <p className="text-sm text-muted-foreground">
          Every administrative action is recorded for accountability.
        </p>
      </div>
      {canExport && (
        <Button onClick={onExport} variant="outline" className="gap-2">
          <Download className="size-4" /> Export CSV
        </Button>
      )}
    </div>
  )
}
