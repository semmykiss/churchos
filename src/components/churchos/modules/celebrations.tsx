'use client'

// ChurchOS — Celebrations module
// Tabs: Birthdays | Anniversaries | Calendar
// List/Grid view toggle, filters (month, branch, department), Send Greeting action.
import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { formatDate, initials } from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  Cake, Heart, CalendarDays, LayoutGrid, List as ListIcon, Send, Filter,
  Sparkles, ChevronRight,
} from 'lucide-react'
import { PageHeader, EmptyState, Toolbar, StatCard, StatCardSkeleton } from '@/components/churchos/ui'
import { cn } from '@/lib/utils'

// ---------- types ----------
interface CelebrationItem {
  id: string
  memberId?: string | null
  firstName: string
  lastName: string
  preferredName?: string | null
  name: string
  photoUrl?: string | null
  date: string
  month: number
  day: number
  nextOccurrence: string
  daysUntil: number
  years: number
  hasAccount: boolean
  branch?: { id: string; name: string } | null
  departments: { id: string; name: string; color?: string | null }[]
}
interface CelebrationsResponse {
  type: string
  items: CelebrationItem[]
  counts: { total: number; upcoming30: number; today: number }
  canGreet: boolean
}
interface BranchLite { id: string; name: string }
interface DeptLite { id: string; name: string; color?: string | null }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function CelebrationsModule() {
  const { organization } = useAuth()
  const [tab, setTab] = useState<'birthdays' | 'anniversaries' | 'calendar'>('birthdays')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [month, setMonth] = useState<string>('__all')
  const [branchId, setBranchId] = useState<string>('__all')
  const [departmentId, setDepartmentId] = useState<string>('__all')
  const [greetTarget, setGreetTarget] = useState<CelebrationItem | null>(null)

  // Branches + departments for filters
  const branchesQuery = useQuery<{ branches: BranchLite[] }>({
    queryKey: ['celebrations-branches'],
    queryFn: async () => {
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error('Failed to load settings')
      return res.json()
    },
  })
  const deptsQuery = useQuery<{ items: DeptLite[] }>({
    queryKey: ['celebrations-depts'],
    queryFn: async () => {
      const res = await fetch('/api/departments')
      if (!res.ok) throw new Error('Failed to load departments')
      return res.json()
    },
  })

  const type = tab === 'anniversaries' ? 'anniversaries' : 'birthdays'
  const itemsQuery = useQuery<CelebrationsResponse>({
    queryKey: ['celebrations', type, month, branchId, departmentId],
    queryFn: async () => {
      const sp = new URLSearchParams({ type })
      if (month && month !== '__all') sp.set('month', month)
      if (branchId && branchId !== '__all') sp.set('branchId', branchId)
      if (departmentId && departmentId !== '__all') sp.set('departmentId', departmentId)
      const res = await fetch(`/api/celebrations?${sp.toString()}`)
      if (!res.ok) throw new Error('Failed to load celebrations')
      return res.json()
    },
  })

  const items = itemsQuery.data?.items ?? []
  const counts = itemsQuery.data?.counts ?? { total: 0, upcoming30: 0, today: 0 }
  const branches = (branchesQuery.data as any)?.branches ?? []
  const departments = deptsQuery.data?.items ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Celebrations"
        eyebrow="Community"
        description="Never miss a birthday or wedding anniversary in your church family."
        icon={Cake}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="birthdays" className="gap-1.5"><Cake className="size-4" /> Birthdays</TabsTrigger>
            <TabsTrigger value="anniversaries" className="gap-1.5"><Heart className="size-4" /> Anniversaries</TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1.5"><CalendarDays className="size-4" /> Calendar</TabsTrigger>
          </TabsList>

          {tab !== 'calendar' && (
            <div className="inline-flex items-center rounded-lg border border-border/60 bg-card p-0.5">
              <button
                onClick={() => setView('grid')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutGrid className="size-3.5" /> Grid
              </button>
              <button
                onClick={() => setView('list')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <ListIcon className="size-3.5" /> List
              </button>
            </div>
          )}
        </div>

        <TabsContent value="birthdays" className="space-y-5">
          <CelebrationsContent
            itemsQuery={itemsQuery}
            counts={counts}
            view={view}
            type="birthdays"
            month={month} setMonth={setMonth}
            branchId={branchId} setBranchId={setBranchId}
            departmentId={departmentId} setDepartmentId={setDepartmentId}
            branches={branches} departments={departments}
            onGreet={setGreetTarget}
          />
        </TabsContent>

        <TabsContent value="anniversaries" className="space-y-5">
          <CelebrationsContent
            itemsQuery={itemsQuery}
            counts={counts}
            view={view}
            type="anniversaries"
            month={month} setMonth={setMonth}
            branchId={branchId} setBranchId={setBranchId}
            departmentId={departmentId} setDepartmentId={setDepartmentId}
            branches={branches} departments={departments}
            onGreet={setGreetTarget}
          />
        </TabsContent>

        <TabsContent value="calendar" className="space-y-5">
          <CalendarView items={items} type={type} loading={itemsQuery.isLoading} />
        </TabsContent>
      </Tabs>

      <GreetDialog
        target={greetTarget}
        onClose={() => setGreetTarget(null)}
      />
    </div>
  )
}

// ---------- celebrations content (grid + list) ----------
function CelebrationsContent({
  itemsQuery, counts, view, type, month, setMonth, branchId, setBranchId,
  departmentId, setDepartmentId, branches, departments, onGreet,
}: {
  itemsQuery: ReturnType<typeof useQuery<CelebrationsResponse>>
  counts: { total: number; upcoming30: number; today: number }
  view: 'grid' | 'list'
  type: 'birthdays' | 'anniversaries'
  month: string; setMonth: (s: string) => void
  branchId: string; setBranchId: (s: string) => void
  departmentId: string; setDepartmentId: (s: string) => void
  branches: BranchLite[]
  departments: DeptLite[]
  onGreet: (i: CelebrationItem) => void
}) {
  const items = itemsQuery.data?.items ?? []
  const Icon = type === 'birthdays' ? Cake : Heart
  const accent = type === 'birthdays' ? 'amber' : 'rose'

  return (
    <>
      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {itemsQuery.isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={Icon} label="Total" value={counts.total} sub={type === 'birthdays' ? 'Birthdays' : 'Anniversaries'} accent="primary" />
            <StatCard icon={CalendarDays} label="Next 30 days" value={counts.upcoming30} accent={accent} />
            <StatCard icon={Sparkles} label="Today" value={counts.today} sub="🎉 Today" accent="emerald" />
            <StatCard icon={Icon} label="Filtered" value={items.length} sub="Visible after filters" accent="violet" />
          </>
        )}
      </div>

      {/* Filters */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <Toolbar>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mr-2">
              <Filter className="size-3.5" /> Filters
            </div>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-full sm:w-44 h-9"><SelectValue placeholder="All months" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All months</SelectItem>
                {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            {branches.length > 0 && (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-full sm:w-44 h-9"><SelectValue placeholder="All branches" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All branches</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {departments.length > 0 && (
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger className="w-full sm:w-44 h-9"><SelectValue placeholder="All departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {(month || branchId || departmentId) && (
              <Button variant="ghost" size="sm" onClick={() => { setMonth(''); setBranchId(''); setDepartmentId('') }} className="h-9 text-xs">
                Clear
              </Button>
            )}
          </Toolbar>
        </CardContent>
      </Card>

      {/* Items */}
      {itemsQuery.isLoading ? (
        view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        )
      ) : items.length === 0 ? (
        <EmptyState
          icon={Icon}
          title={`No ${type === 'birthdays' ? 'birthdays' : 'anniversaries'} found`}
          description="Try adjusting your filters or check back later."
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => (
            <CelebrationCard key={it.id} item={it} type={type} onGreet={() => onGreet(it)} />
          ))}
        </div>
      ) : (
        <Card className="border-border/60 overflow-hidden">
          <div className="divide-y divide-border/40">
            {items.map((it) => (
              <CelebrationRow key={it.id} item={it} type={type} onGreet={() => onGreet(it)} />
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

// ---------- card ----------
function CelebrationCard({ item, type, onGreet }: { item: CelebrationItem; type: 'birthdays' | 'anniversaries'; onGreet: () => void }) {
  const Icon = type === 'birthdays' ? Cake : Heart
  const accent = type === 'birthdays'
    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/15'
    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/15'
  const today = item.daysUntil === 0
  return (
    <Card className={cn('border-border/60 transition-all hover:shadow-premium-md hover:-translate-y-0.5', today && 'ring-1 ring-inset ring-primary/30')}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="relative">
            <Avatar className="size-12">
              <AvatarImage src={item.photoUrl ?? undefined} alt={item.firstName} />
              <AvatarFallback className="bg-primary/10 text-primary">
                {initials(item.firstName, item.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className={cn('absolute -bottom-1 -right-1 size-6 rounded-full grid place-items-center ring-2 ring-background', accent)}>
              <Icon className="size-3" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{item.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {item.branch?.name ?? 'No branch'}
              {item.departments[0] ? ` · ${item.departments[0].name}` : ''}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Badge variant="outline" className="text-[10px] font-medium nums">
                {item.day} {MONTHS[item.month - 1].slice(0, 3)}
              </Badge>
              {today ? (
                <Badge className="text-[10px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">Today 🎉</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] font-medium nums">
                  in {item.daysUntil}d
                </Badge>
              )}
              {type === 'birthdays' ? (
                <Badge variant="outline" className="text-[10px] font-medium">Turning {item.years}</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] font-medium">{item.years} yrs</Badge>
              )}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="default"
          className="w-full mt-4 gap-2"
          onClick={onGreet}
          disabled={!item.hasAccount}
        >
          <Send className="size-3.5" />
          {item.hasAccount ? 'Send greeting' : 'No account'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------- row ----------
function CelebrationRow({ item, type, onGreet }: { item: CelebrationItem; type: 'birthdays' | 'anniversaries'; onGreet: () => void }) {
  const Icon = type === 'birthdays' ? Cake : Heart
  const today = item.daysUntil === 0
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
      <Avatar className="size-9">
        <AvatarImage src={item.photoUrl ?? undefined} alt={item.firstName} />
        <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(item.firstName, item.lastName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{item.name}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {item.day} {MONTHS[item.month - 1]} · {type === 'birthdays' ? `Turning ${item.years}` : `${item.years} yrs`}
          {item.branch ? ` · ${item.branch.name}` : ''}
        </p>
      </div>
      <Badge variant="outline" className="text-[10px] font-medium nums shrink-0">
        {today ? '🎉 Today' : `in ${item.daysUntil}d`}
      </Badge>
      <Button size="sm" variant="ghost" onClick={onGreet} disabled={!item.hasAccount} className="gap-1.5 shrink-0">
        <Send className="size-3.5" /> {item.hasAccount ? 'Greet' : '—'}
      </Button>
    </div>
  )
}

// ---------- calendar view ----------
function CalendarView({ items, type, loading }: { items: CelebrationItem[]; type: string; loading: boolean }) {
  const today = new Date()
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [viewYear, setViewYear] = useState(today.getFullYear())

  // Build calendar days
  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay = new Date(viewYear, viewMonth + 1, 0)
  const startWeekday = (firstDay.getDay() + 6) % 7 // Monday-first
  const totalDays = lastDay.getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  // Index items by day-of-month for current view
  const byDay = new Map<number, CelebrationItem[]>()
  for (const it of items) {
    if (it.month === viewMonth + 1) {
      const list = byDay.get(it.day) ?? []
      list.push(it)
      byDay.set(it.day, list)
    }
  }

  const goPrev = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
    else setViewMonth(viewMonth - 1)
  }
  const goNext = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
    else setViewMonth(viewMonth + 1)
  }
  const goToday = () => { setViewMonth(today.getMonth()); setViewYear(today.getFullYear()) }

  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold">{MONTHS[viewMonth]} {viewYear}</p>
            <p className="text-[11px] text-muted-foreground">{items.length} {type} this view</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={goPrev} className="h-8">Prev</Button>
            <Button variant="ghost" size="sm" onClick={goToday} className="h-8">Today</Button>
            <Button variant="outline" size="sm" onClick={goNext} className="h-8">Next</Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="text-[10px] uppercase font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>
        {loading ? (
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-md" />)}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={i} className="aspect-square rounded-md bg-muted/20" />
              const dayItems = byDay.get(day) ?? []
              const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()
              return (
                <div
                  key={i}
                  className={cn(
                    'aspect-square rounded-md border border-border/40 p-1 flex flex-col items-center justify-start gap-0.5 relative',
                    isToday ? 'bg-primary/8 border-primary/40' : 'bg-card',
                    dayItems.length > 0 && 'hover:shadow-premium transition-shadow',
                  )}
                >
                  <span className={cn('text-[10px] font-semibold nums', isToday ? 'text-primary' : 'text-muted-foreground')}>{day}</span>
                  <div className="flex flex-wrap gap-0.5 justify-center">
                    {dayItems.slice(0, 4).map((it) => {
                      const isBirthday = type === 'birthdays'
                      return (
                        <span
                          key={it.id}
                          title={`${it.name} · ${isBirthday ? 'Birthday' : 'Anniversary'}`}
                          className={cn(
                            'inline-block size-1.5 rounded-full',
                            isBirthday ? 'bg-amber-500' : 'bg-rose-500',
                          )}
                        />
                      )
                    })}
                    {dayItems.length > 4 && (
                      <span className="text-[8px] text-muted-foreground nums">+{dayItems.length - 4}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="flex items-center gap-4 mt-4 text-[11px]">
          <span className="flex items-center gap-1.5"><Cake className="size-3 text-amber-500" /> Birthdays</span>
          <span className="flex items-center gap-1.5"><Heart className="size-3 text-rose-500" /> Anniversaries</span>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- greet dialog ----------
function GreetDialog({ target, onClose }: { target: CelebrationItem | null; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const greetMut = useMutation({
    mutationFn: async (vars: { memberId: string; type: string; message?: string }) => {
      const res = await fetch('/api/celebrations/greet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to send greeting')
      }
      return res.json()
    },
    onSuccess: (_data, vars) => {
      toast.success(`Greeting sent to ${target?.name ?? 'celebrant'}`)
      setMessage('')
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="size-4 text-rose-500" /> Send a greeting
          </DialogTitle>
          <DialogDescription>
            {target ? `Send a personal greeting to ${target.name}. They'll receive an in-app notification.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {target && (
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
              <Avatar className="size-10">
                <AvatarImage src={target.photoUrl ?? undefined} alt={target.firstName} />
                <AvatarFallback className="bg-primary/10 text-primary">{initials(target.firstName, target.lastName)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">{target.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {target.day} {MONTHS[target.month - 1]} · in {target.daysUntil}d
                </p>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="greet-msg" className="text-sm font-medium">Message (optional)</Label>
            <Textarea
              id="greet-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write a warm greeting…"
              rows={4}
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to send the default greeting.
            </p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button
            onClick={() => {
              if (!target) return
              greetMut.mutate({
                memberId: target.id,
                type: target.daysUntil === 0 ? 'birthday' : 'birthday', // type inferred from tab; default birthday here
                message: message.trim() || undefined,
              })
            }}
            disabled={greetMut.isPending}
            className="gap-2"
          >
            <Send className="size-4" /> Send greeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
