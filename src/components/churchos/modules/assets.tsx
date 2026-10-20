'use client'

// ChurchOS — Assets & Facilities module (Module 13)
// Inventory grid with summary stats + bookings (read-only) + CRUD dialogs.
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { formatCurrency, formatDate, relativeTime, titleCase } from '@/lib/format'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
  vehicle: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300',
  building: 'bg-primary/10 text-primary border-primary/20',
  it: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
}

const CONDITION_STYLES: Record<string, string> = {
  good: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  fair: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  damaged: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
  retired: 'bg-muted text-muted-foreground border-border',
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Package className="size-6 text-primary" />
            Assets & Facilities
          </h1>
          <p className="text-sm text-muted-foreground">
            Track church equipment, vehicles, instruments, and facility bookings.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="size-4" /> Add Asset
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="inventory" className="gap-2">
            <Package className="size-4" /> Inventory
          </TabsTrigger>
          <TabsTrigger value="bookings" className="gap-2">
            <CalendarRange className="size-4" /> Bookings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Total assets</p>
                      <p className="text-2xl font-semibold">{stats.total}</p>
                    </div>
                    <Package className="size-6 text-muted-foreground/60" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Total value</p>
                      <p className="text-2xl font-semibold">{formatCurrency(stats.totalValue, currency)}</p>
                    </div>
                    <Wallet className="size-6 text-muted-foreground/60" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">By condition</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {['good', 'fair', 'damaged', 'retired'].map((c) => (
                        <Badge key={c} variant="outline" className={`text-[10px] ${CONDITION_STYLES[c] ?? ''}`}>
                          {titleCase(c)}: {stats.byCondition[c] ?? 0}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">By category</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(stats.byCategory).slice(0, 6).map(([cat, count]) => (
                        <Badge key={cat} variant="outline" className={`text-[10px] ${CATEGORY_STYLES[cat] ?? ''}`}>
                          {titleCase(cat)}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:min-w-[260px]">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, tag, location, custodian…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[160px]">
                <Filter className="mr-2 size-3.5 text-muted-foreground" />
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
              <SelectTrigger className="w-[140px]">
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
              <Button variant="ghost" onClick={() => { setSearch(''); setCategory(''); setCondition('') }}>
                <XCircle className="mr-1 size-4" /> Reset
              </Button>
            )}
          </div>

          {isLoading && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
            </div>
          )}
          {isError && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <AlertTriangle className="size-8 text-rose-500" />
                <p className="text-sm text-muted-foreground">Failed to load assets.</p>
                <Button variant="outline" onClick={() => refetch()}>Retry</Button>
              </CardContent>
            </Card>
          )}

          {!isLoading && !isError && items.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <Package className="size-10 text-muted-foreground/60" />
                <div>
                  <p className="font-medium">No assets found</p>
                  <p className="text-sm text-muted-foreground">
                    {canCreate
                      ? 'Add your first asset to start tracking church equipment.'
                      : 'Try adjusting your filters.'}
                  </p>
                </div>
                {canCreate && (
                  <Button onClick={() => setAddOpen(true)} className="gap-2">
                    <Plus className="size-4" /> Add Asset
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {!isLoading && !isError && items.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => {
                const Icon = categoryIcon(a.category)
                return (
                  <Card key={a.id} className="group transition-shadow hover:shadow-md">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-muted p-2">
                            <Icon className="size-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium leading-tight">{a.name}</p>
                            {a.tag && (
                              <p className="text-xs text-muted-foreground">
                                <Tag className="mr-1 inline size-3" />{a.tag}
                              </p>
                            )}
                          </div>
                        </div>
                        {(canUpdate || canDelete) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100">
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
                        <Badge variant="outline" className={`text-[10px] ${CATEGORY_STYLES[a.category] ?? ''}`}>
                          {titleCase(a.category)}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] ${CONDITION_STYLES[a.condition] ?? ''}`}>
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
                        <div className="border-t pt-2 text-sm font-medium">
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
          <Card>
            <CardContent className="flex items-start gap-3 p-4">
              <CalendarRange className="size-5 shrink-0 text-sky-600" />
              <div className="text-sm">
                <p className="font-medium">Facility bookings</p>
                <p className="text-muted-foreground">
                  A read-only view of room and resource bookings. New bookings can be created by administrators via the Settings module.
                </p>
              </div>
            </CardContent>
          </Card>

          {bookingsLoading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : (bookingsData?.items?.length ?? 0) === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <CalendarRange className="size-10 text-muted-foreground/60" />
                <div>
                  <p className="font-medium">No bookings yet</p>
                  <p className="text-sm text-muted-foreground">
                    Resource reservations will appear here once they are created.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Resource</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Booked by</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookingsData!.items.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.resource}</TableCell>
                        <TableCell>{b.title}</TableCell>
                        <TableCell className="text-muted-foreground">{b.bookedBy ?? '—'}</TableCell>
                        <TableCell>{formatDate(b.startAt)}</TableCell>
                        <TableCell>{formatDate(b.endAt)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={b.status === 'pending' ? 'border-amber-500/30 text-amber-700' : ''}>
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
      <DialogContent className="sm:max-w-lg">
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
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value || '—'}</p>
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Asset' : 'Add Asset'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update asset details.' : 'Register a new church asset.'} ({currency})
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Yamaha PSR-S975 Keyboard" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tag">Tag / Asset ID</Label>
            <Input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. GCI-AST-1234" />
          </div>
          <div className="grid gap-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.filter((c) => c.value).map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="location">Location</Label>
            <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Main Hall" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="custodian">Custodian</Label>
            <Input id="custodian" value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="e.g. Media Dept" />
          </div>
          <div className="grid gap-2">
            <Label>Condition</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITION_OPTIONS.filter((c) => c.value).map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="acquiredAt">Acquired date</Label>
            <Input id="acquiredAt" type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="value">Value ({currency})</Label>
            <Input
              id="value"
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Optional — current value in organization currency"
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
