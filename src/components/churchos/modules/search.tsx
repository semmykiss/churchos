'use client'

// ChurchOS — Global permission-aware Search module
// Reads the query from its own input box (auto-focused). Debounced 300ms.
// Results grouped by type (members / events / donations / assets / documents / tasks).
import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { titleCase } from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Search as SearchIcon, Users, CalendarDays, Wallet, Package, FileText, ListChecks,
  ArrowRight, Sparkles, X, AlertTriangle,
} from 'lucide-react'

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
  members: { label: 'Members', icon: Users, module: 'members', color: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  events: { label: 'Events', icon: CalendarDays, module: 'events', color: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  donations: { label: 'Donations', icon: Wallet, module: 'finance', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  assets: { label: 'Assets', icon: Package, module: 'assets', color: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  documents: { label: 'Documents', icon: FileText, module: 'documents', color: 'bg-teal-500/10 text-teal-700 dark:text-teal-300' },
  tasks: { label: 'Tasks', icon: ListChecks, module: 'tasks', color: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
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

  const { data, isLoading, isError } = useQuery<SearchResponse>({
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
    const meta = TYPE_META[type]
    if (meta) setModule(meta.module as any)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <SearchIcon className="size-6 text-primary" />
          Search
        </h1>
        <p className="text-sm text-muted-foreground">
          Permission-aware global search across members, events, finance, assets, documents, and tasks.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="text"
              autoComplete="off"
              placeholder="Type to search across ChurchOS…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 pl-12 pr-12 text-base"
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
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Sparkles className="size-10 text-muted-foreground/60" />
            <div>
              <p className="font-medium">Search across ChurchOS</p>
              <p className="text-sm text-muted-foreground">
                Find members, events, donations, assets, documents, and tasks. Try typing a name or keyword.
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(TYPE_META).map(([k, m]) => (
                <Badge
                  key={k}
                  variant="outline"
                  className={`gap-1 ${m.color} ${!can(role, k as any, 'view') ? 'opacity-40' : ''}`}
                >
                  <m.icon className="size-3" /> {m.label}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="size-8 text-rose-500" />
            <p className="text-sm text-muted-foreground">Search failed. Please try again.</p>
          </CardContent>
        </Card>
      )}

      {/* No results */}
      {!isLoading && data && groups.length === 0 && debounced.length >= 2 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <SearchIcon className="size-10 text-muted-foreground/60" />
            <div>
              <p className="font-medium">No results for &quot;{debounced}&quot;</p>
              <p className="text-sm text-muted-foreground">
                Try a different spelling or fewer words. Or pick a category above to browse.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {!isLoading && data && groups.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {data.total} result{data.total === 1 ? '' : 's'} for &quot;{data.q}&quot;
          </p>
          {groups.map(([type, items]) => {
            const meta = TYPE_META[type]
            if (!meta) return null
            const Icon = meta.icon
            return (
              <Card key={type}>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-md p-1.5 ${meta.color}`}>
                        <Icon className="size-4" />
                      </span>
                      <p className="font-medium">{meta.label}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
                  </div>
                  <ul className="divide-y">
                    {items.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => goTo(type, r.id)}
                          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{r.label}</p>
                            {r.subtitle && (
                              <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>
                            )}
                          </div>
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
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
