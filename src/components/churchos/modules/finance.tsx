'use client'

// ChurchOS — Finance & Giving module (Module 7)
// BASIC CHURCH FINANCE TRACKING — not a complete accounting package.
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import {
  formatCurrency, formatDate, formatDateTime, titleCase,
} from '@/lib/format'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
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
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Wallet, TrendingUp, TrendingDown, Scale, CheckCircle2, Plus, Download,
  Search, Filter, MoreHorizontal, Eye, Pencil, Trash2, X, RefreshCw, AlertTriangle,
  Banknote, ArrowDownCircle, ArrowUpCircle, PiggyBank, ClipboardCheck, Info, FileSpreadsheet,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

// ---------- types ----------
interface FundRef { id: string; name: string; code?: string | null }
interface FundListItem extends FundRef { description?: string | null; balance: number; donationCount: number; expenseCount: number }
interface DonationItem {
  id: string; donorName?: string | null; memberId?: string | null
  member?: { id: string; name: string } | null
  fundId?: string | null; fund?: FundRef | null
  amount: number; currency: string; method: string; reference?: string | null
  status: string; donatedAt: string; createdAt: string
}
interface DonationListResponse {
  items: DonationItem[]; total: number; page: number; pageSize: number; sum: number
}
interface ExpenseItem {
  id: string; category: string; description: string; amount: number
  payee?: string | null; method: string; reference?: string | null
  status: string; approvedBy?: string | null
  fundId?: string | null; fund?: FundRef | null
  incurredAt: string; createdAt: string; needsApproval: boolean
}
interface ExpenseListResponse {
  items: ExpenseItem[]; total: number; page: number; pageSize: number
  sum: number; highValueThreshold: number
}
interface BudgetItem {
  id: string; fundId?: string | null; fund?: FundRef | null
  fiscalYear: number; period: string; amount: number
  actualIncome: number; actualExpense: number; utilization: number
  createdAt: string
}
interface Overview {
  role: string
  incomeThisMonth: number; incomeCountThisMonth: number
  expensesThisMonth: number; expenseCountThisMonth: number
  netThisMonth: number
  pendingApprovals: number
  funds: { id: string; name: string; code?: string | null; balance: number; description?: string | null }[]
  trend: { label: string; key: string; income: number; expense: number }[]
  recent: {
    id: string; kind: 'donation' | 'expense'; date: string
    description: string; fund: string; amount: number; status: string; method: string
  }[]
  topDonors: { name: string; total: number; count: number }[]
}

const METHOD_OPTIONS = [
  { value: '', label: 'All methods' },
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online' },
]

const DONATION_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
]

const EXPENSE_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
]

const EXPENSE_CATEGORIES = [
  'Utilities', 'Maintenance', 'Salaries', 'Outreach', 'Equipment',
  'Office Supplies', 'Rent', 'Travel', 'Welfare', 'Other',
]

const DONATION_METHODS = ['cash', 'transfer', 'card', 'online'] as const

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  confirmed: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  approved: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  paid: 'bg-primary/10 text-primary border-primary/20',
  failed: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
  rejected: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
  refunded: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] || 'bg-muted text-muted-foreground border-border'
  return (
    <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${cls}`}>
      {titleCase(status)}
    </Badge>
  )
}

function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ---------- main module ----------
export default function FinanceModule() {
  const { user, organization } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'finance', 'create')
  const canUpdate = can(role, 'finance', 'update')
  const canDelete = can(role, 'finance', 'delete')
  const canExport = can(role, 'finance', 'export')
  const canApprove = can(role, 'finance', 'approve')
  const canManage = can(role, 'finance', 'manage')
  const isMemberRole = role === 'member'

  const [tab, setTab] = useState<'overview' | 'donations' | 'expenses' | 'budgets' | 'approvals'>('overview')

  // Export CSV (calls /api/finance/export)
  const exportCsv = async (kind: 'donations' | 'expenses') => {
    try {
      toast.loading('Preparing export…', { id: 'export' })
      const res = await fetch(`/api/finance/export?kind=${kind}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${kind}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${kind} CSV`, { id: 'export' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      toast.error(msg, { id: 'export' })
    }
  }

  if (isMemberRole) {
    return (
      <div className="space-y-6">
        <Header
          canExport={false}
          canCreate={false}
          onNewDonation={() => {}}
          onNewExpense={() => {}}
          onExport={() => {}}
        />
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 sm:p-8 text-center">
            <div className="size-12 rounded-full bg-amber-500/15 text-amber-700 grid place-items-center mx-auto mb-3">
              <Info className="size-6" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Your giving statement</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              For privacy and security, individual giving records are not displayed here.
              Please contact the finance office at{' '}
              <span className="text-foreground font-medium">
                {organization?.email ?? 'the church office'}
              </span>{' '}
              to request your personal giving statement.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header
        canExport={canExport}
        canCreate={canCreate}
        onNewDonation={() => setTab('donations')}
        onNewExpense={() => setTab('expenses')}
        onExport={() => exportCsv('donations')}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 max-w-2xl">
          <TabsTrigger value="overview"><Wallet className="size-3.5 mr-1.5" /> Overview</TabsTrigger>
          <TabsTrigger value="donations"><ArrowDownCircle className="size-3.5 mr-1.5" /> Donations</TabsTrigger>
          <TabsTrigger value="expenses"><ArrowUpCircle className="size-3.5 mr-1.5" /> Expenses</TabsTrigger>
          <TabsTrigger value="budgets"><PiggyBank className="size-3.5 mr-1.5" /> Budgets</TabsTrigger>
          <TabsTrigger value="approvals">
            <ClipboardCheck className="size-3.5 mr-1.5" /> Approvals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="donations" className="mt-4 space-y-4">
          <DonationsTab
            canCreate={canCreate}
            canUpdate={canUpdate}
            canDelete={canUpdate}
            canManage={canManage}
            onExport={() => exportCsv('donations')}
            canExport={canExport}
          />
        </TabsContent>

        <TabsContent value="expenses" className="mt-4 space-y-4">
          <ExpensesTab
            canCreate={canCreate}
            canUpdate={canUpdate}
            canDelete={canUpdate}
            canManage={canManage}
            canApprove={canApprove}
            onExport={() => exportCsv('expenses')}
            canExport={canExport}
          />
        </TabsContent>

        <TabsContent value="budgets" className="mt-4 space-y-4">
          <BudgetsTab canCreate={canCreate} />
        </TabsContent>

        <TabsContent value="approvals" className="mt-4 space-y-4">
          <ApprovalsTab canApprove={canApprove} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- header ----------
function Header({
  canExport, canCreate, onNewDonation, onNewExpense, onExport,
}: {
  canExport: boolean
  canCreate: boolean
  onNewDonation: () => void
  onNewExpense: () => void
  onExport: () => void
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <Wallet className="size-4" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Finance &amp; Giving</h1>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
            Basic Tracking (not full accounting)
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Basic church finance tracking — donations, expenses, funds and approvals. Not a complete accounting package.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-4 mr-1.5" /> Export CSV
          </Button>
        )}
        {canCreate && (
          <>
            <Button variant="outline" size="sm" onClick={onNewExpense}>
              <ArrowUpCircle className="size-4 mr-1.5" /> New Expense
            </Button>
            <Button size="sm" onClick={onNewDonation}>
              <Plus className="size-4 mr-1.5" /> New Donation
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- overview tab ----------
function OverviewTab() {
  const { organization } = useAuth()
  const currency = organization?.currency
  const { data, isLoading, isError, refetch } = useQuery<Overview>({
    queryKey: ['finance', 'overview'],
    queryFn: async () => {
      const res = await fetch('/api/finance')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load finance overview')
      }
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
        <Skeleton className="h-32" />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-8 text-center">
          <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
          <p className="text-sm font-medium">Failed to load finance overview</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Please try again.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-3.5 mr-1.5" /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={TrendingUp}
          label="Income (this month)"
          value={formatCurrency(data.incomeThisMonth, currency)}
          sub={`${data.incomeCountThisMonth} donations`}
          accent="bg-emerald-500/10 text-emerald-600"
        />
        <StatCard
          icon={TrendingDown}
          label="Expenses (this month)"
          value={formatCurrency(data.expensesThisMonth, currency)}
          sub={`${data.expenseCountThisMonth} expenses`}
          accent="bg-rose-500/10 text-rose-600"
        />
        <StatCard
          icon={Scale}
          label="Net this month"
          value={formatCurrency(data.netThisMonth, currency)}
          sub={data.netThisMonth >= 0 ? 'Surplus' : 'Deficit'}
          accent={data.netThisMonth >= 0 ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-600'}
        />
        <StatCard
          icon={ClipboardCheck}
          label="Pending approvals"
          value={data.pendingApprovals.toString()}
          sub="awaiting review"
          accent="bg-amber-500/10 text-amber-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend chart */}
        <Card className="border-border/60 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Income vs Expenses — last 6 months</CardTitle>
            <CardDescription className="text-xs">Confirmed donations and approved/paid expenses.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.trend}>
                <defs>
                  <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  width={48}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [
                    formatCurrency(value, currency),
                    name === 'income' ? 'Income' : 'Expenses',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="url(#incGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="expense"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  fill="url(#expGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top donors */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top donors (90 days)</CardTitle>
            <CardDescription className="text-xs">Confirmed giving only.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topDonors.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No donations in the last 90 days.</p>
            ) : (
              <ol className="space-y-2">
                {data.topDonors.map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="size-5 rounded bg-primary/10 text-primary text-[10px] font-bold grid place-items-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="truncate">{d.name}</span>
                    </div>
                    <span className="font-semibold tabular-nums">{formatCurrency(d.total, currency)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Fund balances */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fund balances</CardTitle>
          <CardDescription className="text-xs">Current balances tracked in this system.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {data.funds.map((f) => (
              <div key={f.id} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium truncate">{f.name}</p>
                  {f.code && (
                    <Badge variant="outline" className="text-[9px]">{f.code}</Badge>
                  )}
                </div>
                <p className="text-lg font-bold tabular-nums">{formatCurrency(f.balance, currency)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent transactions */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent transactions</CardTitle>
          <CardDescription className="text-xs">Last 10 donations and expenses combined.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No transactions yet.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {data.recent.map((r) => {
                const isDonation = r.kind === 'donation'
                return (
                  <div key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`size-8 rounded-full grid place-items-center shrink-0 ${
                          isDonation
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-rose-500/10 text-rose-600'
                        }`}
                      >
                        {isDonation ? <ArrowDownCircle className="size-4" /> : <ArrowUpCircle className="size-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{r.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(r.date)} · {r.fund} · {titleCase(r.method)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`text-sm font-semibold tabular-nums ${
                          isDonation ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {isDonation ? '+' : '−'}
                        {formatCurrency(Math.abs(r.amount), currency)}
                      </p>
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: typeof Wallet; label: string; value: string; sub?: string; accent: string
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 flex items-start gap-3">
        <div className={`size-9 rounded-lg grid place-items-center shrink-0 ${accent}`}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-xl font-bold leading-tight truncate">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- donations tab ----------
function DonationsTab({
  canCreate, canUpdate, canDelete, canManage, canExport, onExport,
}: {
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canManage: boolean
  canExport: boolean
  onExport: () => void
}) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [fundId, setFundId] = useState('')
  const [method, setMethod] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const debouncedSearch = useDebouncedValue(search, 350)

  // When filters change, reset page to 1 — handled inline in setters below.
  // Funds for filter dropdown
  const { data: fundsData } = useQuery<{ items: FundListItem[] }>({
    queryKey: ['finance', 'funds'],
    queryFn: async () => {
      const res = await fetch('/api/finance/funds')
      if (!res.ok) return { items: [] }
      return res.json()
    },
  })

  const queryKey = useMemo(
    () => ['finance', 'donations', debouncedSearch, fundId, method, status, from, to, page, pageSize] as const,
    [debouncedSearch, fundId, method, status, from, to, page],
  )
  const { data, isLoading, isError, refetch, isFetching } = useQuery<DonationListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (fundId) params.set('fundId', fundId)
      if (method) params.set('method', method)
      if (status) params.set('status', status)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await fetch(`/api/finance/donations?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load donations')
      }
      return res.json()
    },
  })

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')

  const openDetail = useCallback((id: string) => {
    setDetailId(id); setDetailOpen(true)
  }, [])
  const openEdit = useCallback((id: string) => {
    setEditId(id); setEditOpen(true)
  }, [])

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/finance/donations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Donation deleted')
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      setDeleteId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const resetFilters = () => {
    setSearch(''); setFundId(''); setMethod(''); setStatus(''); setFrom(''); setTo(''); setPage(1)
  }

  return (
    <>
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search donor name or reference…"
                className="pl-9"
                aria-label="Search donations"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Select value={fundId} onValueChange={(v) => { setFundId(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full lg:w-44" aria-label="Filter by fund">
                <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All funds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All funds</SelectItem>
                {fundsData?.items.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={method} onValueChange={(v) => { setMethod(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full lg:w-36" aria-label="Filter by method">
                <SelectValue placeholder="All methods" />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m.value || 'all'} value={m.value || 'all'}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full lg:w-36" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {DONATION_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value || 'all'} value={s.value || 'all'}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="from" className="text-xs text-muted-foreground">From</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1) }}
                className="w-40"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="to" className="text-xs text-muted-foreground">To</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1) }}
                className="w-40"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0">
              <RefreshCw className="size-3.5 mr-1.5" /> Reset
            </Button>
            {canExport && (
              <Button variant="outline" size="sm" onClick={onExport} className="sm:ml-auto">
                <FileSpreadsheet className="size-3.5 mr-1.5" /> Export CSV
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5 mr-1.5" /> New Donation
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-10 text-center">
              <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
              <p className="text-sm font-medium">Failed to load donations</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
                <RefreshCw className="size-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="p-12 text-center">
              <div className="size-12 rounded-full bg-muted grid place-items-center mx-auto mb-3">
                <Banknote className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No donations found</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                {search || fundId || method || status || from || to
                  ? 'Try changing your filters.'
                  : 'Record your first donation to get started.'}
              </p>
              {canCreate && (
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4 mr-1.5" /> New Donation
                </Button>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Donor</TableHead>
                    <TableHead className="hidden md:table-cell">Fund</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((d) => (
                    <TableRow key={d.id} className="cursor-pointer" onClick={() => openDetail(d.id)}>
                      <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(d.donatedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium truncate max-w-[180px]">
                          {d.member?.name ?? d.donorName ?? 'Anonymous'}
                        </div>
                        {d.reference && (
                          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{d.reference}</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">{d.fund?.name ?? '—'}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(d.amount, currency)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs">{titleCase(d.method)}</TableCell>
                      <TableCell><StatusBadge status={d.status} /></TableCell>
                      <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label="Donation actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(d.id)}>
                              <Eye className="size-3.5" /> View
                            </DropdownMenuItem>
                            {canUpdate && (
                              <DropdownMenuItem onClick={() => openEdit(d.id)}>
                                <Pencil className="size-3.5" /> Edit
                              </DropdownMenuItem>
                            )}
                            {canDelete && (d.status !== 'confirmed' || canManage) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => {
                                    setDeleteId(d.id)
                                    setDeleteName(d.member?.name ?? d.donorName ?? 'this donation')
                                  }}
                                >
                                  <Trash2 className="size-3.5" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-border/60">
                <p className="text-xs text-muted-foreground">
                  Showing <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}</span>
                  {'–'}
                  <span className="font-medium text-foreground">{Math.min(page * pageSize, data.total)}</span>
                  {' '}of <span className="font-medium text-foreground">{data.total}</span>
                  {' · '}Total: <span className="font-semibold text-foreground">{formatCurrency(data.sum, currency)}</span>
                  {isFetching && <span className="ml-2 text-primary">· updating…</span>}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >Previous</Button>
                  <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {detailOpen && detailId && (
        <DonationDetailDialog
          id={detailId}
          open={detailOpen}
          onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetailId(null) }}
          currency={currency}
          canEdit={canUpdate}
          onEdit={() => { setDetailOpen(false); if (detailId) openEdit(detailId) }}
        />
      )}

      {addOpen && (
        <DonationFormDialog
          mode="create"
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['finance'] })
          }}
        />
      )}
      {editOpen && editId && (
        <DonationFormDialog
          mode="edit"
          donationId={editId}
          open={editOpen}
          onOpenChange={(o) => { setEditOpen(o); if (!o) setEditId(null) }}
          onSaved={() => {
            setEditOpen(false)
            queryClient.invalidateQueries({ queryKey: ['finance'] })
            if (editId) queryClient.invalidateQueries({ queryKey: ['finance', 'donation', editId] })
          }}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete donation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the donation from <strong>{deleteName}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteId) deleteMutation.mutate(deleteId)
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DonationDetailDialog({
  id, open, onOpenChange, currency, canEdit, onEdit,
}: {
  id: string
  open: boolean
  onOpenChange: (o: boolean) => void
  currency?: string
  canEdit: boolean
  onEdit: () => void
}) {
  const { data, isLoading, isError } = useQuery<DonationItem>({
    queryKey: ['finance', 'donation', id],
    queryFn: async () => {
      const res = await fetch(`/api/finance/donations/${id}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load donation')
      }
      return res.json()
    },
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Donation details</DialogTitle>
          <DialogDescription>Recorded donation and reconciliation status.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7" />)}</div>
        ) : isError || !data ? (
          <p className="text-sm text-destructive">Failed to load donation.</p>
        ) : (
          <div className="space-y-3">
            <DetailRow label="Donor" value={data.member?.name ?? data.donorName ?? 'Anonymous'} />
            <DetailRow label="Fund" value={data.fund?.name ?? 'Unspecified'} />
            <DetailRow label="Amount" value={formatCurrency(data.amount, currency)} highlight />
            <DetailRow label="Method" value={titleCase(data.method)} />
            <DetailRow label="Reference" value={data.reference ?? '—'} />
            <DetailRow label="Status" value={<StatusBadge status={data.status} />} />
            <DetailRow label="Date" value={formatDateTime(data.donatedAt)} />
          </div>
        )}
        <DialogFooter>
          {canEdit && (
            <Button onClick={onEdit}><Pencil className="size-3.5 mr-1.5" /> Edit</Button>
          )}
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-base font-bold' : ''}`}>{value}</span>
    </div>
  )
}

function DonationFormDialog({
  mode, donationId, open, onOpenChange, onSaved,
}: {
  mode: 'create' | 'edit'
  donationId?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const [donorName, setDonorName] = useState('')
  const [memberId, setMemberId] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [fundId, setFundId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [reference, setReference] = useState('')
  const [status, setStatus] = useState<string>('confirmed')
  const [donatedAt, setDonatedAt] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const { data: fundsData } = useQuery<{ items: FundListItem[] }>({
    queryKey: ['finance', 'funds'],
    queryFn: async () => {
      const res = await fetch('/api/finance/funds')
      if (!res.ok) return { items: [] }
      return res.json()
    },
  })

  // member search
  const debouncedMemberSearch = useDebouncedValue(memberSearch, 350)
  const { data: memberResults } = useQuery<{ items: { id: string; firstName: string; lastName: string; memberId?: string | null }[] }>({
    queryKey: ['members', 'lookup', debouncedMemberSearch],
    queryFn: async () => {
      if (!debouncedMemberSearch) return { items: [] }
      const params = new URLSearchParams({ q: debouncedMemberSearch, page: '1', pageSize: '10' })
      const res = await fetch(`/api/members?${params}`)
      if (!res.ok) return { items: [] }
      return res.json()
    },
    enabled: open && !!debouncedMemberSearch,
  })

  // Load existing donation for edit mode
  const { data: existing } = useQuery<DonationItem>({
    queryKey: ['finance', 'donation', donationId],
    queryFn: async () => {
      const res = await fetch(`/api/finance/donations/${donationId}`)
      if (!res.ok) throw new Error('Failed to load')
      return res.json()
    },
    enabled: open && mode === 'edit' && !!donationId,
  })

  useEffect(() => {
    if (mode === 'edit' && existing) {
      setDonorName(existing.donorName ?? '')
      setMemberId(existing.memberId ?? '')
      setFundId(existing.fundId ?? '')
      setAmount(String(existing.amount))
      setMethod(existing.method)
      setReference(existing.reference ?? '')
      setStatus(existing.status)
      setDonatedAt(new Date(existing.donatedAt).toISOString().slice(0, 10))
    } else if (mode === 'create') {
      setDonorName(''); setMemberId(''); setFundId(''); setAmount('')
      setMethod('cash'); setReference(''); setStatus('confirmed')
      setDonatedAt(new Date().toISOString().slice(0, 10))
    }
  }, [mode, existing])

  const submit = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error('Enter a valid amount'); return
    }
    if (!memberId && !donorName.trim()) {
      toast.error('Donor name or member is required'); return
    }
    setSaving(true)
    try {
      const payload: any = {
        donorName: donorName.trim() || null,
        memberId: memberId || null,
        fundId: fundId || null,
        amount: Number(amount),
        method,
        reference: reference.trim() || null,
        status,
        donatedAt,
      }
      const url = mode === 'create'
        ? '/api/finance/donations'
        : `/api/finance/donations/${donationId}`
      const method_ = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method: method_,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Save failed')
      }
      toast.success(mode === 'create' ? 'Donation recorded' : 'Donation updated')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Record a donation' : 'Edit donation'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Enter the details of this giving record.'
              : 'Update the donation details below.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {/* Donor — member search or manual name */}
          <div>
            <Label className="text-xs">Donor</Label>
            {memberId ? (
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <Badge variant="secondary" className="text-xs">
                  Linked: {memberResults?.items.find((m) => m.id === memberId)
                    ? `${memberResults.items.find((m) => m.id === memberId)?.firstName} ${memberResults.items.find((m) => m.id === memberId)?.lastName}`
                    : 'Member'}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => setMemberId('')}>Unlink</Button>
              </div>
            ) : (
              <div className="space-y-2 mt-1.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search member to link (optional)…"
                    className="pl-9"
                  />
                </div>
                {memberResults && memberResults.items.length > 0 && (
                  <div className="border border-border/60 rounded-md max-h-32 overflow-y-auto">
                    {memberResults.items.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMemberId(m.id)
                          setDonorName(`${m.firstName} ${m.lastName}`.trim())
                          setMemberSearch('')
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-accent border-b border-border/40 last:border-0"
                      >
                        {m.firstName} {m.lastName} <span className="text-muted-foreground">· {m.memberId}</span>
                      </button>
                    ))}
                  </div>
                )}
                <Input
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                  placeholder="…or enter donor name manually"
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Fund</Label>
              <Select value={fundId || 'none'} onValueChange={(v) => setFundId(v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select fund" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unspecified</SelectItem>
                  {fundsData?.items.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Amount ({currency ?? 'NGN'})</Label>
              <Input
                type="number"
                min="0"
                step="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DONATION_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={donatedAt} onChange={(e) => setDonatedAt(e.target.value)} className="mt-1.5" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Record donation' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- expenses tab ----------
function ExpensesTab({
  canCreate, canUpdate, canDelete, canManage, canApprove, canExport, onExport,
}: {
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canManage: boolean
  canApprove: boolean
  canExport: boolean
  onExport: () => void
}) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const debouncedSearch = useDebouncedValue(search, 350)

  const queryKey = useMemo(
    () => ['finance', 'expenses', debouncedSearch, status, category, from, to, page, pageSize] as const,
    [debouncedSearch, status, category, from, to, page],
  )
  const { data, isLoading, isError, refetch, isFetching } = useQuery<ExpenseListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (status) params.set('status', status)
      if (category) params.set('category', category)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await fetch(`/api/finance/expenses?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load expenses')
      }
      return res.json()
    },
  })

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  const [addOpen, setAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [approveExpense, setApproveExpense] = useState<ExpenseItem | null>(null)
  const [approveAction, setApproveAction] = useState<'approve' | 'reject' | null>(null)
  const [approveComment, setApproveComment] = useState('')

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/finance/expenses/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Expense deleted')
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      setDeleteId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const approveMutation = useMutation({
    mutationFn: async ({ id, action, comment }: { id: string; action: 'approve' | 'reject'; comment: string }) => {
      const res = await fetch(`/api/finance/expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: comment.trim() || undefined }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Action failed')
      }
      return res.json()
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.action === 'approve' ? 'Expense approved' : 'Expense rejected')
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      setApproveExpense(null)
      setApproveAction(null)
      setApproveComment('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const resetFilters = () => {
    setSearch(''); setStatus(''); setCategory(''); setFrom(''); setTo(''); setPage(1)
  }

  return (
    <>
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search description, payee, category…"
                className="pl-9"
                aria-label="Search expenses"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
                  aria-label="Clear search"
                ><X className="size-3.5" /></button>
              )}
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full lg:w-40" aria-label="Filter by status">
                <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value || 'all'} value={s.value || 'all'}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={(v) => { setCategory(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full lg:w-44" aria-label="Filter by category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="exp-from" className="text-xs text-muted-foreground">From</Label>
              <Input id="exp-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="w-40" />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="exp-to" className="text-xs text-muted-foreground">To</Label>
              <Input id="exp-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="w-40" />
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0">
              <RefreshCw className="size-3.5 mr-1.5" /> Reset
            </Button>
            {canExport && (
              <Button variant="outline" size="sm" onClick={onExport} className="sm:ml-auto">
                <FileSpreadsheet className="size-3.5 mr-1.5" /> Export CSV
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5 mr-1.5" /> New Expense
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-10 text-center">
              <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
              <p className="text-sm font-medium">Failed to load expenses</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
                <RefreshCw className="size-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="p-12 text-center">
              <div className="size-12 rounded-full bg-muted grid place-items-center mx-auto mb-3">
                <ArrowUpCircle className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No expenses found</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                {search || status || category || from || to
                  ? 'Try changing your filters.'
                  : 'Record your first expense to get started.'}
              </p>
              {canCreate && (
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4 mr-1.5" /> New Expense
                </Button>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden lg:table-cell">Payee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(e.incurredAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{e.category}</Badge>
                          {e.needsApproval && (
                            <Badge className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300" variant="outline">
                              <AlertTriangle className="size-3 mr-1" /> Needs approval
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        <span className="line-clamp-1">{e.description}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-rose-600">
                        −{formatCurrency(e.amount, currency)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">{e.payee ?? '—'}</TableCell>
                      <TableCell><StatusBadge status={e.status} /></TableCell>
                      <TableCell className="text-right pr-4">
                        <div className="flex items-center justify-end gap-1">
                          {canApprove && e.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="size-7 p-0 text-emerald-600 hover:text-emerald-700"
                                aria-label="Approve"
                                onClick={() => {
                                  setApproveExpense(e)
                                  setApproveAction('approve')
                                }}
                              >
                                <CheckCircle2 className="size-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="size-7 p-0 text-rose-600 hover:text-rose-700"
                                aria-label="Reject"
                                onClick={() => {
                                  setApproveExpense(e)
                                  setApproveAction('reject')
                                }}
                              >
                                <X className="size-3.5" />
                              </Button>
                            </>
                          )}
                          {canDelete && (e.status === 'pending' || canManage) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-8" aria-label="Expense actions">
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => {
                                    setDeleteId(e.id)
                                    setDeleteName(e.description)
                                  }}
                                >
                                  <Trash2 className="size-3.5" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-border/60">
                <p className="text-xs text-muted-foreground">
                  Showing <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}</span>
                  {'–'}
                  <span className="font-medium text-foreground">{Math.min(page * pageSize, data.total)}</span>
                  {' '}of <span className="font-medium text-foreground">{data.total}</span>
                  {' · '}Total: <span className="font-semibold text-rose-600">{formatCurrency(data.sum, currency)}</span>
                  {isFetching && <span className="ml-2 text-primary">· updating…</span>}
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                  <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {addOpen && (
        <ExpenseFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['finance'] })
          }}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteName}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteId) deleteMutation.mutate(deleteId)
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Approve/Reject dialog */}
      <Dialog
        open={!!approveExpense && !!approveAction}
        onOpenChange={(o) => {
          if (!o) {
            setApproveExpense(null); setApproveAction(null); setApproveComment('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{approveAction === 'approve' ? 'Approve expense?' : 'Reject expense?'}</DialogTitle>
            <DialogDescription>
              {approveExpense && (
                <span>
                  <strong>{approveExpense.description}</strong>{' '}
                  ({formatCurrency(approveExpense.amount, currency)})
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="approve-comment" className="text-xs">Comment (optional)</Label>
            <Textarea
              id="approve-comment"
              value={approveComment}
              onChange={(e) => setApproveComment(e.target.value)}
              placeholder="Add a note for the audit log…"
              className="mt-1.5"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApproveExpense(null); setApproveAction(null); setApproveComment('') }}>
              Cancel
            </Button>
            <Button
              className={approveAction === 'approve'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-destructive text-white hover:bg-destructive/90'}
              disabled={approveMutation.isPending}
              onClick={() => {
                if (approveExpense && approveAction) {
                  approveMutation.mutate({ id: approveExpense.id, action: approveAction, comment: approveComment })
                }
              }}
            >
              {approveMutation.isPending
                ? 'Processing…'
                : approveAction === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ExpenseFormDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const [category, setCategory] = useState('Utilities')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [payee, setPayee] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [reference, setReference] = useState('')
  const [fundId, setFundId] = useState('')
  const [incurredAt, setIncurredAt] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const { data: fundsData } = useQuery<{ items: FundListItem[] }>({
    queryKey: ['finance', 'funds'],
    queryFn: async () => {
      const res = await fetch('/api/finance/funds')
      if (!res.ok) return { items: [] }
      return res.json()
    },
  })

  const submit = async () => {
    if (!description.trim()) { toast.error('Description is required'); return }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error('Enter a valid amount'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/finance/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          description: description.trim(),
          amount: Number(amount),
          payee: payee.trim() || null,
          method,
          reference: reference.trim() || null,
          fundId: fundId || null,
          incurredAt,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Save failed')
      }
      toast.success('Expense recorded')
      onSaved()
      // reset
      setDescription(''); setAmount(''); setPayee(''); setReference(''); setFundId('')
      setIncurredAt(new Date().toISOString().slice(0, 10))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
          <DialogDescription>
            New expenses default to <span className="font-medium">pending</span> status. High-value expenses (&ge; {formatCurrency(100_000, currency)}) require approval before reconciliation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Amount ({currency ?? 'NGN'})</Label>
              <Input type="number" min="0" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1.5" placeholder="What was this expense for?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Payee</Label>
              <Input value={payee} onChange={(e) => setPayee(e.target.value)} className="mt-1.5" placeholder="Vendor / recipient" />
            </div>
            <div>
              <Label className="text-xs">Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1.5" placeholder="Receipt / invoice no." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DONATION_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Fund (optional)</Label>
            <Select value={fundId || 'none'} onValueChange={(v) => setFundId(v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select fund" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unspecified</SelectItem>
                {fundsData?.items.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Record expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- budgets tab ----------
function BudgetsTab({ canCreate }: { canCreate: boolean }) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery<{ items: BudgetItem[] }>({
    queryKey: ['finance', 'budgets'],
    queryFn: async () => {
      const res = await fetch('/api/finance/budgets')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load budgets')
      }
      return res.json()
    },
  })

  const currentYear = new Date().getFullYear()
  const totalAnnualBudget = (data?.items ?? [])
    .filter((b) => b.fiscalYear === currentYear && b.period === 'annual')
    .reduce((s, b) => s + b.amount, 0)

  return (
    <>
      <Card className="border-border/60">
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Budgets</CardTitle>
            <CardDescription className="text-xs">
              Annual budgets per fund · {currentYear} total: <span className="font-semibold">{formatCurrency(totalAnnualBudget, currency)}</span>
            </CardDescription>
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5 mr-1.5" /> New Budget
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : isError ? (
            <div className="p-8 text-center">
              <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
              <p className="text-sm font-medium">Failed to load budgets</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
                <RefreshCw className="size-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="p-12 text-center">
              <div className="size-12 rounded-full bg-muted grid place-items-center mx-auto mb-3">
                <PiggyBank className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No budgets yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Create a budget to track spending against goals.</p>
              {canCreate && (
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4 mr-1.5" /> New Budget
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {data.items.map((b) => (
                <div key={b.id} className="rounded-lg border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-sm font-medium">{b.fund?.name ?? 'General'}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        FY {b.fiscalYear} · {b.period}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {b.utilization}% used
                    </Badge>
                  </div>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Budget</span>
                    <span className="text-sm font-semibold tabular-nums">{formatCurrency(b.amount, currency)}</span>
                  </div>
                  <Progress value={b.utilization} className="h-2 mb-2" />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Spent: <span className="text-rose-600 font-medium">{formatCurrency(b.actualExpense, currency)}</span></span>
                    <span>Income: <span className="text-emerald-600 font-medium">{formatCurrency(b.actualIncome, currency)}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {addOpen && (
        <BudgetFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['finance'] })
          }}
        />
      )}
    </>
  )
}

function BudgetFormDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [fundId, setFundId] = useState('')
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear())
  const [period, setPeriod] = useState('annual')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: fundsData } = useQuery<{ items: FundListItem[] }>({
    queryKey: ['finance', 'funds'],
    queryFn: async () => {
      const res = await fetch('/api/finance/funds')
      if (!res.ok) return { items: [] }
      return res.json()
    },
  })

  const submit = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) < 0) {
      toast.error('Enter a valid amount'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/finance/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fundId: fundId || null,
          fiscalYear,
          period,
          amount: Number(amount),
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Save failed')
      }
      toast.success('Budget created')
      onSaved()
      setAmount(''); setFundId(''); setPeriod('annual')
      setFiscalYear(new Date().getFullYear())
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a budget</DialogTitle>
          <DialogDescription>Set an annual or quarterly budget for a fund.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Fund</Label>
            <Select value={fundId || 'none'} onValueChange={(v) => setFundId(v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select fund" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">General (no fund)</SelectItem>
                {fundsData?.items.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Fiscal year</Label>
              <Input
                type="number"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="q1">Q1</SelectItem>
                  <SelectItem value="q2">Q2</SelectItem>
                  <SelectItem value="q3">Q3</SelectItem>
                  <SelectItem value="q4">Q4</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Budget amount</Label>
            <Input
              type="number"
              min="0"
              step="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1.5"
              placeholder="e.g. 5,000,000"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Create budget'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- approvals tab ----------
function ApprovalsTab({ canApprove }: { canApprove: boolean }) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const pageSize = 20

  const { data, isLoading, isError, refetch } = useQuery<ExpenseListResponse>({
    queryKey: ['finance', 'expenses', 'pending', page],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: 'pending', page: String(page), pageSize: String(pageSize),
      })
      const res = await fetch(`/api/finance/expenses?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load pending approvals')
      }
      return res.json()
    },
  })

  const [actionTarget, setActionTarget] = useState<ExpenseItem | null>(null)
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null)
  const [comment, setComment] = useState('')

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, comment }: { id: string; action: 'approve' | 'reject'; comment: string }) => {
      const res = await fetch(`/api/finance/expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: comment.trim() || undefined }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Action failed')
      }
      return res.json()
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.action === 'approve' ? 'Expense approved' : 'Expense rejected')
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      setActionTarget(null); setActionType(null); setComment('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pending approvals</CardTitle>
          <CardDescription className="text-xs">
            Expenses awaiting approval. High-value (≥ {formatCurrency(100_000, currency)}) expenses require explicit approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : isError ? (
            <div className="p-8 text-center">
              <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
              <p className="text-sm font-medium">Failed to load pending approvals</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
                <RefreshCw className="size-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="p-12 text-center">
              <div className="size-12 rounded-full bg-emerald-500/10 text-emerald-600 grid place-items-center mx-auto mb-3">
                <CheckCircle2 className="size-6" />
              </div>
              <p className="text-sm font-medium">All caught up!</p>
              <p className="text-xs text-muted-foreground mt-1">No expenses awaiting approval.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {data.items.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[10px]">{e.category}</Badge>
                      {e.needsApproval && (
                        <Badge className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300" variant="outline">
                          <AlertTriangle className="size-3 mr-1" /> High value
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{e.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(e.incurredAt)} · {e.payee ?? '—'} · {e.fund?.name ?? 'General'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-rose-600 mb-1">
                      −{formatCurrency(e.amount, currency)}
                    </p>
                    {canApprove ? (
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                          onClick={() => { setActionTarget(e); setActionType('approve') }}
                        >
                          <CheckCircle2 className="size-3.5 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-rose-600 hover:text-rose-700"
                          onClick={() => { setActionTarget(e); setActionType('reject') }}
                        >
                          <X className="size-3.5 mr-1" /> Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">No approve permission</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!actionTarget && !!actionType}
        onOpenChange={(o) => {
          if (!o) { setActionTarget(null); setActionType(null); setComment('') }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionType === 'approve' ? 'Approve expense?' : 'Reject expense?'}</DialogTitle>
            <DialogDescription>
              {actionTarget && (
                <span>
                  <strong>{actionTarget.description}</strong> — {formatCurrency(actionTarget.amount, currency)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="apv-comment" className="text-xs">Comment (optional)</Label>
            <Textarea
              id="apv-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note for the audit log…"
              rows={3}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionTarget(null); setActionType(null); setComment('') }}>
              Cancel
            </Button>
            <Button
              className={actionType === 'approve'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-destructive text-white hover:bg-destructive/90'}
              disabled={actionMutation.isPending}
              onClick={() => {
                if (actionTarget && actionType) {
                  actionMutation.mutate({ id: actionTarget.id, action: actionType, comment })
                }
              }}
            >
              {actionMutation.isPending ? 'Processing…' : actionType === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
