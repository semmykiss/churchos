'use client'

// ChurchOS — Reusable MemberPicker component.
// Used across modules for member selection (task assignee, event registration,
// pastoral case, finance donor, etc.).
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Users, Search } from 'lucide-react'

interface MemberLite {
  id: string
  firstName: string
  lastName: string
  memberId?: string | null
  photoUrl?: string | null
  preferredName?: string | null
}

interface MemberPickerProps {
  value?: string
  onChange: (memberId: string) => void
  placeholder?: string
  departmentId?: string // filter by department
  className?: string
  disabled?: boolean
}

export function MemberPicker({
  value,
  onChange,
  placeholder = 'Select member',
  departmentId,
  className,
  disabled,
}: MemberPickerProps) {
  const [search, setSearch] = useState('')

  const { data } = useQuery<{ items: MemberLite[] }>({
    queryKey: ['members', 'picker', departmentId ?? '', search],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (departmentId) params.set('departmentId', departmentId)
      if (search) params.set('q', search)
      const res = await fetch(`/api/members?${params}`)
      if (!res.ok) return { items: [] }
      const d = await res.json()
      return { items: (d.items ?? []).map((m: any) => ({
        id: m.id, firstName: m.firstName, lastName: m.lastName,
        memberId: m.memberId, photoUrl: m.photoUrl, preferredName: m.preferredName,
      })) }
    },
    staleTime: 30_000,
  })

  const members = data?.items ?? []
  const selected = members.find((m) => m.id === value)

  const initials = (fn?: string, ln?: string) =>
    `${(fn ?? '').charAt(0)}${(ln ?? '').charAt(0)}`.toUpperCase() || '?'

  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className ?? 'h-9 w-full'}>
        <SelectValue placeholder={placeholder}>
          {selected ? (
            <span className="flex items-center gap-2">
              <Avatar className="size-5">
                <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                  {initials(selected.firstName, selected.lastName)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">
                {selected.preferredName ?? `${selected.firstName} ${selected.lastName}`}
              </span>
              {selected.memberId && (
                <span className="text-[10px] text-muted-foreground">{selected.memberId}</span>
              )}
            </span>
          ) : placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members…"
              className="h-8 pl-8 text-sm"
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>
        <div className="max-h-[240px] overflow-y-auto scroll-thin">
          {members.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No members found</p>
          ) : (
            members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-2">
                  <Avatar className="size-5">
                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                      {initials(m.firstName, m.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <span>{m.preferredName ?? `${m.firstName} ${m.lastName}`}</span>
                  {m.memberId && <span className="text-[10px] text-muted-foreground">{m.memberId}</span>}
                </span>
              </SelectItem>
            ))
          )}
        </div>
      </SelectContent>
    </Select>
  )
}
