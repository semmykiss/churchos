'use client'

// ChurchOS — Global permission-aware Search module
// Reads the query from its own input box (auto-focused). Debounced 300ms.
// Results grouped by type (members / events / donations / assets / documents / tasks).
import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Search as SearchIcon, Users, CalendarDays, Wallet, Package, FileText, ListChecks,
  ArrowRight, Sparkles, X, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { PageHeader, EmptyState, TableSkeleton } from '@/components/churchos/ui'

interface SearchResult {
  id: string
  label: string
  subtitle?: string
  type: string
}
interface SearchResponse {
  results: {
    members: SearchResult[]
    events: SearchResult[]
    donations: SearchResult[]
    assets: SearchResult[]
    documents: SearchResult[]
    tasks: SearchResult[]
  }
  total: number
  q: string
}

const TYPE_META: Record<string, { label: string; icon: any; module: string; color: string }> = {
  members: { label: 'Members', icon: Users, module: 'members', color: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-500/15' },
  events: { label: 'Events', icon: CalendarDays, module: 'events', color: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/15' },
  donations: { label: 'Donations', icon: Wallet, module: 'finance', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/15' },
  assets: { label: 'Assets', icon: Package, module: 'assets', color: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/15' },
  documents: { label: 'Documents', icon: FileText, module: 'documents', color: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-500/15' },
  tasks: { label: 'Tasks', icon: ListChecks, module: 'tasks', color: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/15' },
}

// Deep-link targets per result type. AppShell listens for the
// 'churchos:navigate' CustomEvent with { module, refId } detail and forwards it
// to the auth store (setModule + openDetail); each module consumes refId in its
// own format (see the detailRef consumers): plain record id for
// members/events/tasks/documents/assets/visitors/announcements/departments/
// pastoral, and 'user:<id>' for the access module.
// Types without an entry here (e.g. donations → finance, where a donation id
// is not a valid finance refId) fall back to module-only navigation via
// TYPE_META in goTo().
const NAV_TARGETS: Record<string, { module: string; refId: (id: string) => string }> = {
  members: { module: 'members', refId: (id) => id },
  departments: { module: 'departments', refId: (id) => id },
  events: { module: 'events', refId: (id) => id },
  users: { module: 'access', refId: (id) => `user:${id}` },
  visitors: { module: 'visitors', refId: (id) => id },
  announcements: { module: 'announcements', refId: (id) => id },
  assets: { module: 'assets', refId: (id) => id },
  documents: { module: 'documents', refId: (id) => id },
  tasks: { module: 'tasks', refId: (id) => id },
  pastoral: { module: 'pastoral', refId: (id) => id },
}

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function SearchModule() {
  const { user, setModule } = useAuth()
  const role = user?.role ?? 'member'
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query.trim(), 300)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const { data, isLoading, isError, refetch } = useQuery<SearchResponse>({
    queryKey: ['search', 'global', debounced],
    queryFn: async () => {
      const params = new URLSearchParams({ q: debounced })
      const res = await fetch(`/api/search?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Search failed')
      }
      return res.json()
    },
    enabled: debounced.length >= 2,
  })

  const groups = useMemo(() => {
    if (!data) return []
    return Object.entries(data.results).filter(([, arr]) => arr.length > 0) as [string, SearchResult[]][]
  }, [data])

  const goTo = (type: string, id: string) => {
    const target = NAV_TARGETS[type]
    if (target) {
      // Deep-link: navigate to the module AND open the specific record.
      window.dispatchEvent(
        new CustomEvent('churchos:navigate', {
          detail: { module: target.module, refId: target.refId(id) },
        }),
      )
      return
    }
    // Fallback: module-only navigation for types with no deep-link mapping.
    const meta = TYPE_META[type]
    if (meta) setModule(meta.module as any)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        eyebrow="Discover"
        description="Permission-aware global search across members, events, finance, assets, documents, and tasks."
        icon={SearchIcon}
      />

      {/* Prominent search input */}
      <Card className="border-border/60 overflow-hidden bg-brand-gradient">
        <CardContent className="p-5">
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              type="text"
              autoComplete="off"
              placeholder="Type to search across ChurchOS…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 pl-12 pr-12 text-base bg-card/80 backdrop-blur"
              aria-label="Search ChurchOS"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); inputRef.current?.focus() }}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Results respect your role&apos;s permissions. Pastoral case notes are never surfaced here.
          </p>
        </CardContent>
      </Card>

      {/* Empty / no query */}
      {debounced.length < 2 && (
        <Card className="border-border/60">
          <EmptyState
            icon={Sparkles}
            title="Search across ChurchOS"
            description="Find members, events, donations, assets, documents, and tasks. Try typing a name or keyword."
            action={
              <div className="flex flex-wrap gap-2 justify-center">
                {Object.entries(TYPE_META).map(([k, m]) => {
                  const allowed = can(role, k as any, 'view')
                  return (
                    <Badge
                      key={k}
                      variant="outline"
                      className={`gap-1 text-[11px] font-medium ${m.color} ${!allowed ? 'opacity-40' : ''}`}
                    >
                      <m.icon className="size-3" /> {m.label}
                    </Badge>
                  )
                })}
              </div>
            }
          />
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <TableSkeleton rows={4} />
      )}

      {/* Error */}
      {isError && !isLoading && (
        <Card className="border-border/60">
          <EmptyState
            icon={AlertTriangle}
            title="Search failed"
            description="We couldn't complete your search. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            }
          />
        </Card>
      )}

      {/* No results */}
      {!isLoading && data && groups.length === 0 && debounced.length >= 2 && (
        <Card className="border-border/60">
          <EmptyState
            icon={SearchIcon}
            title={`No results for "${debounced}"`}
            description="Try a different spelling or fewer words. Or pick a category above to browse."
          />
        </Card>
      )}

      {/* Results */}
      {!isLoading && data && groups.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground nums">
            {data.total} result{data.total === 1 ? '' : 's'} for &quot;{data.q}&quot;
          </p>
          {groups.map(([type, items]) => {
            const meta = TYPE_META[type]
            if (!meta) return null
            const Icon = meta.icon
            return (
              <Card key={type} className="border-border/60">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-lg p-1.5 ${meta.color}`}>
                        <Icon className="size-4" />
                      </span>
                      <p className="text-sm font-semibold">{meta.label}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-medium nums">{items.length}</Badge>
                  </div>
                  <ul className="divide-y divide-border/60">
                    {items.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => goTo(type, r.id)}
                          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 group"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{r.label}</p>
                            {r.subtitle && (
                              <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>
                            )}
                          </div>
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
