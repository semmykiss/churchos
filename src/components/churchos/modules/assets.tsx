'use client'

// ChurchOS — Assets & Facilities module (Module 13)
// Inventory grid with summary stats + bookings (read-only) + CRUD dialogs.
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { formatCurrency, formatDate, titleCase } from '@/lib/format'

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
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
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
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  Package, Plus, Search, Filter, MoreHorizontal, Eye, Pencil, Trash2,
  Building2, Car, Cpu, Music, Armchair, Wrench, AlertTriangle, RefreshCw,
  Wallet, Tag, MapPin, UserCircle, CheckCircle2, XCircle, CalendarRange,
} from 'lucide-react'
import {
  PageHeader, StatCard, EmptyState, Toolbar, StatCardSkeleton,
} from '@/components/churchos/ui'

// ---------- types ----------
interface AssetItem {
  id: string
  tag?: string | null
  name: string
  category: string
  location?: string | null
  custodian?: string | null
  condition: string
  acquiredAt?: string | null
  value?: number | null
  createdAt: string
}
interface AssetListResponse {
  items: AssetItem[]
  total: number
  page: number
  pageSize: number
  stats: {
    total: number
    totalValue: number
    byCategory: Record<string, number>
    byCondition: Record<string, number>
  }
}
interface BookingItem {
  id: string
  resource: string
  title: string
  bookedBy?: string | null
  startAt: string
  endAt: string
  status: string
  createdAt: string
}
interface BookingsResponse {
  items: BookingItem[]
  total: number
  page: number
  pageSize: number
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories', icon: Package },
  { value: 'equipment', label: 'Equipment', icon: Wrench },
  { value: 'instrument', label: 'Instruments', icon: Music },
  { value: 'furniture', label: 'Furniture', icon: Armchair },
  { value: 'vehicle', label: 'Vehicles', icon: Car },
  { value: 'building', label: 'Buildings', icon: Building2 },
  { value: 'it', label: 'IT', icon: Cpu },
]

const CONDITION_OPTIONS = [
  { value: '', label: 'All conditions' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'retired', label: 'Retired' },
]

const CATEGORY_STYLES: Record<string, string> = {
  equipment: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  instrument: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300',
  furniture: 'bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300',
  vehicle: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300',
  building: 'bg-primary/10 text-primary border-primary/20',
  it: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
}

const CONDITION_STYLES: Record<string, string> = {
  good: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  fair: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  damaged: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
  retired: 'bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300',
}

const CATEGORY_TILE_STYLES: Record<string, string> = {
  equipment: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/15',
  instrument: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/15',
  furniture: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-1 ring-inset ring-teal-500/15',
  vehicle: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-500/15',
  building: 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/15',
  it: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/15',
}

function categoryIcon(cat: string) {
  const opt = CATEGORY_OPTIONS.find((c) => c.value === cat)
  return opt?.icon ?? Package
}

function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function AssetsModule() {
  const { user, organization } = useAuth()
  const role = user?.role ?? 'member'
  const canCreate = can(role, 'assets', 'create')
  const canUpdate = can(role, 'assets', 'update')
  const canDelete = can(role, 'assets', 'delete') || can(role, 'assets', 'manage')
  const currency = organization?.currency ?? 'NGN'

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [condition, setCondition] = useState('')
  const debouncedSearch = useDebouncedValue(search, 350)

  const [activeTab, setActiveTab] = useState<'inventory' | 'bookings'>('inventory')

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')

  const queryKey = useMemo(
    () => ['assets', 'list', debouncedSearch, category, condition] as const,
    [debouncedSearch, category, condition],
  )

  const { data, isLoading, isError, refetch } = useQuery<AssetListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '200' })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (category) params.set('category', category)
      if (condition) params.set('condition', condition)
      const res = await fetch(`/api/assets?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load assets')
      }
      return res.json()
    },
  })

  // Bookings list
  const { data: bookingsData, isLoading: bookingsLoading } = useQuery<BookingsResponse>({
    queryKey: ['assets', 'bookings'],
    queryFn: async () => {
      const res = await fetch('/api/assets?bookings=1')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load bookings')
      }
      return res.json()
    },
    enabled: activeTab === 'bookings',
  })

  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['assets'] })

  const stats = data?.stats
  const items = data?.items ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assets & Facilities"
        eyebrow="Resources"
        description="Track church equipment, vehicles, instruments, and facility bookings."
        icon={Package}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="size-4" /> Add Asset
            </Button>
          ) : undefined
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="inventory" className="gap-1.5">
            <Package className="size-4" /> Inventory
          </TabsTrigger>
          <TabsTrigger value="bookings" className="gap-1.5">
            <CalendarRange className="size-4" /> Bookings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4">
          {/* Stats */}
          {isLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard icon={Package} label="Total Assets" value={stats.total.toLocaleString()} accent="primary" />
              <StatCard icon={Wallet} label="Total Value" value={formatCurrency(stats.totalValue, currency)} accent="emerald" />
              {/* By condition */}
              <Card className="border-border/60">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">By Condition</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {['good', 'fair', 'damaged', 'retired'].map((c) => (
                          <Badge key={c} variant="outline" className={`text-[10px] font-medium ${CONDITION_STYLES[c] ?? ''}`}>
                            {titleCase(c)}: <span className="nums ml-0.5">{stats.byCondition[c] ?? 0}</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="size-9 shrink-0 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center ring-1 ring-inset ring-violet-500/15">
                      <CheckCircle2 className="size-4.5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              {/* By category */}
              <Card className="border-border/60">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">By Category</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.entries(stats.byCategory).slice(0, 6).map(([cat, count]) => (
                          <Badge key={cat} variant="outline" className={`text-[10px] font-medium ${CATEGORY_STYLES[cat] ?? ''}`}>
                            {titleCase(cat)}: <span className="nums ml-0.5">{count}</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="size-9 shrink-0 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 grid place-items-center ring-1 ring-inset ring-indigo-500/15">
                      <Tag className="size-4.5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* Filter row */}
          <Card className="border-border/60">
            <CardContent className="p-4">
              <Toolbar>
                <div className="relative flex-1 sm:min-w-[260px]">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search by name, tag, location, custodian…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9"
                    aria-label="Search assets"
                  />
                </div>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full md:w-44 h-9" aria-label="Filter by category">
                    <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c.value || '__all'} value={c.value || '__all'}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger className="w-full md:w-40 h-9" aria-label="Filter by condition">
                    <SelectValue placeholder="Condition" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_OPTIONS.map((c) => (
                      <SelectItem key={c.value || '__all'} value={c.value || '__all'}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(search || category || condition) && (
                  <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setCategory(''); setCondition('') }} className="gap-2">
                    <XCircle className="size-3.5" /> Reset
                  </Button>
                )}
              </Toolbar>
            </CardContent>
          </Card>

          {isLoading && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
            </div>
          )}
          {isError && (
            <Card className="border-border/60">
              <EmptyState
                icon={AlertTriangle}
                title="Failed to load assets"
                description="We couldn't fetch the asset inventory. Please try again."
                action={
                  <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                    <RefreshCw className="size-3.5" /> Retry
                  </Button>
                }
              />
            </Card>
          )}

          {!isLoading && !isError && items.length === 0 && (
            <Card className="border-border/60">
              <EmptyState
                icon={Package}
                title="No assets found"
                description={
                  canCreate
                    ? 'Add your first asset to start tracking church equipment.'
                    : 'Try adjusting your filters.'
                }
                action={canCreate && (
                  <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                    <Plus className="size-4" /> Add Asset
                  </Button>
                )}
              />
            </Card>
          )}

          {!isLoading && !isError && items.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => {
                const Icon = categoryIcon(a.category)
                return (
                  <Card key={a.id} className="group border-border/60 transition-all hover:shadow-premium-md hover:-translate-y-0.5">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`rounded-lg p-2 ${CATEGORY_TILE_STYLES[a.category] ?? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/15'}`}>
                            <Icon className="size-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium leading-tight truncate">{a.name}</p>
                            {a.tag && (
                              <p className="text-xs text-muted-foreground truncate">
                                <Tag className="mr-1 inline size-3" />{a.tag}
                              </p>
                            )}
                          </div>
                        </div>
                        {(canUpdate || canDelete) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 shrink-0">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setDetailId(a.id); setDetailOpen(true) }}>
                                <Eye className="mr-2 size-4" /> View
                              </DropdownMenuItem>
                              {canUpdate && (
                                <DropdownMenuItem onClick={() => { setEditId(a.id); setEditOpen(true) }}>
                                  <Pencil className="mr-2 size-4" /> Edit
                                </DropdownMenuItem>
                              )}
                              {canDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-rose-600"
                                    onClick={() => { setDeleteId(a.id); setDeleteName(a.name) }}
                                  >
                                    <Trash2 className="mr-2 size-4" /> Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] font-medium ${CATEGORY_STYLES[a.category] ?? ''}`}>
                          {titleCase(a.category)}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] font-medium ${CONDITION_STYLES[a.condition] ?? ''}`}>
                          {titleCase(a.condition)}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                        {a.location && (
                          <p className="flex items-center gap-1"><MapPin className="size-3" /> {a.location}</p>
                        )}
                        {a.custodian && (
                          <p className="flex items-center gap-1"><UserCircle className="size-3" /> {a.custodian}</p>
                        )}
                        {a.acquiredAt && (
                          <p className="flex items-center gap-1"><CalendarRange className="size-3" /> Acquired {formatDate(a.acquiredAt)}</p>
                        )}
                      </div>

                      {a.value != null && (
                        <div className="border-t border-border/60 pt-2 text-sm font-semibold nums">
                          {formatCurrency(a.value, currency)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="bookings" className="space-y-4">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="size-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/15">
                <CalendarRange className="size-4" />
              </div>
              <div className="text-sm">
                <p className="font-medium">Facility bookings</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  A read-only view of room and resource bookings. New bookings can be created by administrators via the Settings module.
                </p>
              </div>
            </CardContent>
          </Card>

          {bookingsLoading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : (bookingsData?.items?.length ?? 0) === 0 ? (
            <Card className="border-border/60">
              <EmptyState
                icon={CalendarRange}
                title="No bookings yet"
                description="Resource reservations will appear here once they are created."
              />
            </Card>
          ) : (
            <Card className="border-border/60">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                      <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Resource</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Title</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Booked by</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Start</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">End</TableHead>
                      <TableHead className="pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookingsData!.items.map((b) => (
                      <TableRow key={b.id} className="hover:bg-muted/40 border-border/60">
                        <TableCell className="pl-4 font-medium text-sm">{b.resource}</TableCell>
                        <TableCell className="text-sm">{b.title}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{b.bookedBy ?? '—'}</TableCell>
                        <TableCell className="text-sm nums">{formatDate(b.startAt)}</TableCell>
                        <TableCell className="text-sm nums">{formatDate(b.endAt)}</TableCell>
                        <TableCell className="pr-4">
                          <Badge variant="outline" className={`text-[10px] font-medium ${b.status === 'pending' ? 'border-amber-500/30 text-amber-700' : ''}`}>
                            {titleCase(b.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Detail dialog */}
      <AssetDetailDialog id={detailId} open={detailOpen} onOpenChange={setDetailOpen} />

      {/* Add/Edit form */}
      <AssetFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={invalidate}
        currency={currency}
      />
      <AssetFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editId={editId}
        onSaved={invalidate}
        currency={currency}
      />

      {/* Delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently delete &quot;{deleteName}&quot; from the asset register. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteId) return
                try {
                  const res = await fetch(`/api/assets/${deleteId}`, { method: 'DELETE' })
                  if (!res.ok) {
                    const e = await res.json().catch(() => ({}))
                    throw new Error(e.error || 'Delete failed')
                  }
                  toast.success('Asset deleted')
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

// ---------- Asset Detail Dialog ----------
function AssetDetailDialog({
  id,
  open,
  onOpenChange,
}: {
  id: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['asset', 'detail', id],
    queryFn: async () => {
      const res = await fetch(`/api/assets/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load asset')
      }
      return res.json()
    },
    enabled: !!id && open,
  })
  const { organization } = useAuth()
  const currency = organization?.currency ?? 'NGN'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Asset details</DialogTitle>
          <DialogDescription>
            {data ? data.name : 'Loading…'}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : data ? (
          <div className="grid grid-cols-2 gap-3 py-2 text-sm">
            <DetailRow label="Tag" value={data.tag} />
            <DetailRow label="Category" value={titleCase(data.category)} />
            <DetailRow label="Condition" value={titleCase(data.condition)} />
            <DetailRow label="Location" value={data.location} />
            <DetailRow label="Custodian" value={data.custodian} />
            <DetailRow label="Acquired" value={data.acquiredAt ? formatDate(data.acquiredAt) : null} />
            <DetailRow label="Value" value={data.value != null ? formatCurrency(data.value, currency) : null} />
            <DetailRow label="Created" value={formatDate(data.createdAt)} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium mt-0.5 nums">{value || '—'}</p>
    </div>
  )
}

// ---------- Asset Form Dialog (create / edit) ----------
function AssetFormDialog({
  open,
  onOpenChange,
  editId,
  onSaved,
  currency,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editId?: string | null
  onSaved: () => void
  currency: string
}) {
  const isEdit = !!editId
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [category, setCategory] = useState('equipment')
  const [location, setLocation] = useState('')
  const [custodian, setCustodian] = useState('')
  const [condition, setCondition] = useState('good')
  const [acquiredAt, setAcquiredAt] = useState('')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (open && editId) {
      fetch(`/api/assets/${editId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d && !d.error) {
            setName(d.name || '')
            setTag(d.tag || '')
            setCategory(d.category || 'equipment')
            setLocation(d.location || '')
            setCustodian(d.custodian || '')
            setCondition(d.condition || 'good')
            setAcquiredAt(d.acquiredAt ? d.acquiredAt.slice(0, 10) : '')
            setValue(d.value != null ? String(d.value) : '')
          }
        })
        .catch(() => {})
    } else if (open && !editId) {
      void Promise.resolve().then(() => {
        setName(''); setTag(''); setCategory('equipment'); setLocation('')
        setCustodian(''); setCondition('good'); setAcquiredAt(''); setValue('')
      })
    }
  }, [open, editId])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name,
        tag: tag.trim() || null,
        category,
        location: location.trim() || null,
        custodian: custodian.trim() || null,
        condition,
        acquiredAt: acquiredAt ? new Date(acquiredAt).toISOString() : null,
        value: value !== '' ? Number(value) : null,
      }
      const url = isEdit ? `/api/assets/${editId}` : '/api/assets'
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
      toast.success(isEdit ? 'Asset updated' : 'Asset added')
      onOpenChange(false)
      onSaved()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Asset' : 'Add Asset'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update asset details.' : 'Register a new church asset.'} ({currency})
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="name" className="text-sm font-medium">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Yamaha PSR-S975 Keyboard" className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tag" className="text-sm font-medium">Tag / Asset ID</Label>
            <Input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. GCI-AST-1234" className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.filter((c) => c.value).map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="location" className="text-sm font-medium">Location</Label>
            <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Main Hall" className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="custodian" className="text-sm font-medium">Custodian</Label>
            <Input id="custodian" value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="e.g. Media Dept" className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Condition</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITION_OPTIONS.filter((c) => c.value).map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="acquiredAt" className="text-sm font-medium">Acquired date</Label>
            <Input id="acquiredAt" type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="value" className="text-sm font-medium">Value ({currency})</Label>
            <Input
              id="value"
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Optional — current value in organization currency"
              className="h-9 nums"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !name.trim()} className="gap-2">
            {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add asset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
