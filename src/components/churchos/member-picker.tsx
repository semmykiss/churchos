'use client'

// ChurchOS — shared people-picking primitive (single source of truth for all modules).
// `useMemberSearch` — debounced hook against GET /api/members (rate-limited 20 req/min/user).
// `MemberPicker` — Popover + Command combobox with avatars, status badges, login-account dots.
//
// BREAKING vs the previous version: the old MemberPicker took `value?: string` +
// `onChange: (memberId: string) => void` and had no other consumers (verified dead code).
// The new signature is object-style: `onChange: (member: MemberOption | null) => void`.

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Search, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemberOption {
  id: string
  firstName: string
  lastName: string
  preferredName?: string | null
  /** Business number, e.g. "GCI/1001". */
  memberId?: string | null
  photoUrl?: string | null
  status?: string
  /** Login account linked to this member; null when the member has no login. */
  account?: { id: string; name: string; role: string; active: boolean } | null
}

export interface MemberSearchOptions {
  /** Raw query text; the hook debounces internally (300ms). */
  q: string
  /** Default true. */
  enabled?: boolean
  departmentId?: string
  status?: string
  /** Default 25, max 100. */
  pageSize?: number
  /** Filtered out client-side. */
  excludeIds?: string[]
  /** Fetch the directory even when q is empty (pastoral-style dropdowns). Default false. */
  fetchOnEmpty?: boolean
}

// ---------------------------------------------------------------------------
// useMemberSearch
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300

function toMemberOption(raw: Record<string, unknown>): MemberOption {
  const acct = raw.account as Record<string, unknown> | null | undefined
  return {
    id: String(raw.id ?? ''),
    firstName: typeof raw.firstName === 'string' ? raw.firstName : '',
    lastName: typeof raw.lastName === 'string' ? raw.lastName : '',
    preferredName: typeof raw.preferredName === 'string' ? raw.preferredName : null,
    memberId: typeof raw.memberId === 'string' ? raw.memberId : null,
    photoUrl: typeof raw.photoUrl === 'string' ? raw.photoUrl : null,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    account:
      acct && typeof acct === 'object'
        ? {
            id: String(acct.id ?? ''),
            name: String(acct.name ?? ''),
            role: String(acct.role ?? ''),
            active: Boolean(acct.active),
          }
        : null,
  }
}

export function useMemberSearch(opts: MemberSearchOptions): {
  results: MemberOption[]
  isLoading: boolean
} {
  const { q, enabled = true, departmentId, status, pageSize: rawPageSize, excludeIds, fetchOnEmpty = false } = opts
  const pageSize = Math.min(rawPageSize ?? 25, 100)

  const [debouncedQ, setDebouncedQ] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q])

  const queryEnabled = enabled && (debouncedQ.length > 0 || fetchOnEmpty)

  const query = useQuery({
    queryKey: ['members', 'search', debouncedQ, departmentId ?? '', status ?? '', pageSize],
    queryFn: async (): Promise<MemberOption[]> => {
      const params = new URLSearchParams({ page: '1', pageSize: String(pageSize) })
      if (debouncedQ) params.set('q', debouncedQ)
      if (departmentId) params.set('departmentId', departmentId)
      if (status) params.set('status', status)
      const res = await fetch(`/api/members?${params.toString()}`)
      if (!res.ok) throw new Error(`Member search failed (${res.status})`)
      const json: unknown = await res.json()
      const items = Array.isArray((json as { items?: unknown[] })?.items)
        ? ((json as { items: unknown[] }).items as Record<string, unknown>[])
        : []
      return items.map(toMemberOption)
    },
    staleTime: 15_000,
    enabled: queryEnabled,
  })

  const results = useMemo(() => {
    const items = query.data ?? []
    if (!excludeIds?.length) return items
    const excluded = new Set(excludeIds)
    return items.filter((m) => !excluded.has(m.id))
  }, [query.data, excludeIds])

  const isLoading = queryEnabled && (q !== debouncedQ || query.isFetching)

  return { results, isLoading }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE_CLASS: Record<string, string> = {
  active: 'border-primary/30 bg-primary/5 text-primary',
  visitor: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  follow_up: 'border-teal-500/30 bg-teal-500/5 text-teal-700 dark:text-teal-400',
  new_convert: 'border-lime-500/30 bg-lime-500/5 text-lime-700 dark:text-lime-400',
  inactive: 'border-zinc-500/30 bg-zinc-500/5 text-zinc-700 dark:text-zinc-400',
  transferred: 'border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-400',
  deceased: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400',
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  visitor: 'Visitor',
  follow_up: 'Follow-up',
  new_convert: 'New convert',
  inactive: 'Inactive',
  transferred: 'Transferred',
  deceased: 'Deceased',
}

function statusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASS[status] ?? 'border-border/60 bg-muted/40 text-muted-foreground'
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 font-medium leading-4 text-[9px]',
        statusBadgeClass(status),
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function displayName(o: MemberOption): string {
  const full = `${o.firstName ?? ''} ${o.lastName ?? ''}`.trim()
  return o.preferredName?.trim() || full || 'Unnamed member'
}

function initialsOf(o: MemberOption): string {
  const a = (o.firstName ?? '').trim().charAt(0)
  const b = (o.lastName ?? '').trim().charAt(0)
  return `${a}${b}`.toUpperCase() || '?'
}

function MemberAvatar({ option, className }: { option: MemberOption; className?: string }) {
  return (
    <Avatar className={cn('shrink-0', className)}>
      {option.photoUrl ? <AvatarImage src={option.photoUrl} alt={displayName(option)} /> : null}
      <AvatarFallback className="bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
        <span className="font-semibold text-[10px]">{initialsOf(option)}</span>
      </AvatarFallback>
    </Avatar>
  )
}

// ---------------------------------------------------------------------------
// MemberPicker
// ---------------------------------------------------------------------------

export interface MemberPickerProps {
  /** Selected member id (business key kept by the caller). */
  value?: string | null
  /** Receives the full option (or null when cleared). */
  onChange: (member: MemberOption | null) => void
  /** Shown when value is set but the option hasn't been seen yet (edit-mode prefill). */
  valueLabel?: string
  placeholder?: string
  emptyText?: string
  className?: string
  triggerClassName?: string
  disabled?: boolean
  departmentId?: string
  status?: string
  excludeIds?: string[]
  /** Fetch the directory even with an empty query. Default false. */
  fetchOnEmpty?: boolean
  /** Show the status badge in rows. Default true. */
  showStatus?: boolean
  /** Show the "has login account" emerald dot. Default true. */
  showAccount?: boolean
}

export function MemberPicker({
  value,
  onChange,
  valueLabel,
  placeholder = 'Search members…',
  emptyText,
  className,
  triggerClassName,
  disabled,
  departmentId,
  status,
  excludeIds,
  fetchOnEmpty,
  showStatus = true,
  showAccount = true,
}: MemberPickerProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  // Fetch only while the popover is open — respects the 20 req/min/user rate limit.
  const { results, isLoading } = useMemberSearch({
    q,
    departmentId,
    status,
    excludeIds,
    fetchOnEmpty,
    enabled: open,
  })

  // Remember the last explicitly-picked option so the trigger keeps rendering the
  // chosen member even after the result list changes (search text, filters, close).
  // Values set programmatically that haven't been seen resolve to valueLabel ?? 'Linked member'.
  const [picked, setPicked] = useState<MemberOption | null>(null)
  const resultsById = useMemo(() => {
    const map = new Map<string, MemberOption>()
    for (const opt of results) map.set(opt.id, opt)
    return map
  }, [results])

  const hasValue = value != null && value !== ''
  const selected = hasValue
    ? resultsById.get(value) ?? (picked && picked.id === value ? picked : undefined)
    : undefined

  const handleClear = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(null)
  }

  const showHint = q.length === 0 && !fetchOnEmpty && !isLoading

  return (
    <div className={cn('relative w-full', className)}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setQ('')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn('h-9 w-full justify-start font-normal', hasValue && 'pr-8', triggerClassName)}
          >
            {selected ? (
              <>
                <MemberAvatar option={selected} className="size-6" />
                <span className="truncate">{displayName(selected)}</span>
                {selected.memberId ? (
                  <span className="shrink-0 rounded border border-border/60 bg-muted/50 px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
                    {selected.memberId}
                  </span>
                ) : null}
              </>
            ) : hasValue ? (
              <>
                <Users className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">{valueLabel ?? 'Linked member'}</span>
              </>
            ) : (
              <>
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">{placeholder}</span>
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px] rounded-xl border-border/60 p-0 shadow-lg">
          <Command shouldFilter={false} className="rounded-xl">
            <CommandInput placeholder={placeholder} value={q} onValueChange={setQ} />
            <CommandList className="max-h-64">
              {showHint ? (
                <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center text-muted-foreground">
                  <Search className="size-4 opacity-60" />
                  <span className="text-sm">Type to search members…</span>
                </div>
              ) : isLoading && results.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</div>
              ) : results.length === 0 ? (
                <CommandEmpty>{emptyText ?? 'No members found'}</CommandEmpty>
              ) : (
                <CommandGroup>
                  {results.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={m.id}
                      onSelect={() => {
                        setPicked(m)
                        onChange(m)
                        setOpen(false)
                      }}
                      className="gap-2.5 py-2"
                    >
                      <MemberAvatar option={m} className="size-7" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{displayName(m)}</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {m.memberId ? (
                            <span className="rounded bg-muted/60 px-1 text-[10px] leading-4 text-muted-foreground">
                              {m.memberId}
                            </span>
                          ) : null}
                          {showStatus && m.status ? <StatusBadge status={m.status} /> : null}
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        {showAccount && m.account ? (
                          <span
                            className="size-1.5 rounded-full bg-primary dark:bg-primary"
                            title="Has login account"
                          />
                        ) : null}
                        {value === m.id ? <Check className="size-4 text-primary" /> : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {hasValue && !disabled ? (
        <button
          type="button"
          aria-label="Clear selection"
          onClick={handleClear}
          className="absolute right-1.5 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
