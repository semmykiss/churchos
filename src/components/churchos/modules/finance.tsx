'use client'

// ChurchOS — Finance & Giving module (Module 7)
// BASIC CHURCH FINANCE TRACKING — not a complete accounting package.
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Wallet, TrendingUp, TrendingDown, Scale, CheckCircle2, Plus, Download,
  Search, Filter, MoreHorizontal, Eye, Pencil, Trash2, X, RefreshCw, AlertTriangle,
  Banknote, ArrowDownCircle, ArrowUpCircle, PiggyBank, ClipboardCheck, Info, FileSpreadsheet, HandCoins,
  Coins, FileText, BookOpen, Landmark, BarChart3, User, Settings, ArrowRight, Calendar,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  PageHeader, StatCard, EmptyState, Toolbar, SectionCard, StatusPill,
  StatCardSkeleton, TableSkeleton,
} from '@/components/churchos/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useMemberSearch } from '@/components/churchos/member-picker'

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
interface TitheItem {
  id: string
  memberId: string
  member?: { id: string; firstName: string; lastName: string; memberId?: string | null } | null
  amount: number
  currency: string
  method: string
  reference?: string | null
  status: string
  titheMonth: string
  note?: string | null
  createdAt: string
}
interface TitheListResponse {
  items: TitheItem[]
  total: number
  page: number
  pageSize: number
  stats: { confirmed: number; pending: number; failed: number; total: number }
  canManageAny?: boolean
  selfMemberId?: string | null
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
  { value: 'rejected', label: 'Rejected' },
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

// Map finance statuses to StatusPill tones:
// pending=warning, confirmed/approved=success, paid=info(indigo), failed/rejected=danger, refunded=info
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  pending: 'warning',
  confirmed: 'success',
  approved: 'success',
  paid: 'info',
  failed: 'danger',
  rejected: 'danger',
  refunded: 'info',
}

function StatusBadge({ status }: { status: string }) {
  return <StatusPill status={titleCase(status)} tone={STATUS_TONE[status] ?? 'default'} />
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
  const { user, organization, detailRef, clearDetail } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'finance', 'create')
  const canUpdate = can(role, 'finance', 'update')
  const canDelete = can(role, 'finance', 'delete')
  const canExport = can(role, 'finance', 'export')
  const canApprove = can(role, 'finance', 'approve')
  const canManage = can(role, 'finance', 'manage')
  const isMemberRole = role === 'member'

  const [tab, setTab] = useState<'overview' | 'donations' | 'expenses' | 'tithes' | 'budgets' | 'approvals' | 'collections' | 'expense_requests' | 'accounting' | 'bank' | 'reports' | 'member_giving' | 'settings'>('overview')
  const [titheDialogOpen, setTitheDialogOpen] = useState(false)
  // Highlight a specific tithe row (set when a finance notification is clicked).
  const [highlightTitheId, setHighlightTitheId] = useState<string | null>(null)

  // Switch to the Tithes tab + highlight the tithe row when a notification is clicked.
  useEffect(() => {
    if (!detailRef || detailRef.module !== 'finance') return
    const refId = detailRef.refId
    // Defer setState to avoid the synchronous-setState-in-effect lint rule.
    const t = setTimeout(() => {
      if (refId) {
        setTab('tithes')
        setHighlightTitheId(refId)
      }
      clearDetail()
    }, 0)
    return () => clearTimeout(t)
  }, [detailRef?.nonce, clearDetail])

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
        <PageHeader
          eyebrow="Finance"
          title="Finance &amp; Giving"
          description="Submit your tithe and view your giving history."
          icon={Wallet}
          actions={
            <>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
                Basic Tracking
              </Badge>
              {canCreate && (
                <Button size="sm" onClick={() => setTitheDialogOpen(true)} className="gap-2">
                  <HandCoins className="size-4" /> Record Tithe
                </Button>
              )}
            </>
          }
        />

        <MemberTithesView />

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-lg bg-amber-500/15 text-amber-700 grid place-items-center ring-1 ring-inset ring-amber-500/20 shrink-0">
                <Info className="size-4.5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold mb-0.5">Need your full giving statement?</h3>
                <p className="text-xs text-muted-foreground">
                  For privacy and security, full donation and expense records are not displayed here.
                  Please contact the finance office at{' '}
                  <span className="text-foreground font-medium">
                    {organization?.email ?? 'the church office'}
                  </span>{' '}
                  to request your personal giving statement.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {titheDialogOpen && (
          <RecordTitheDialog
            open={titheDialogOpen}
            onOpenChange={setTitheDialogOpen}
            onSaved={() => setTitheDialogOpen(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Finance &amp; Giving"
        description="Basic church finance tracking — donations, expenses, funds and approvals. Not a complete accounting package."
        icon={Wallet}
        actions={
          <>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
              Basic Tracking (not full accounting)
            </Badge>
            {canExport && (
              <Button variant="outline" size="sm" onClick={() => exportCsv('donations')} className="gap-2">
                <Download className="size-4" /> Export CSV
              </Button>
            )}
            {canCreate && (
              <>
                <Button variant="outline" size="sm" onClick={() => setTab('expenses')} className="gap-2">
                  <ArrowUpCircle className="size-4" /> New Expense
                </Button>
                <Button variant="outline" size="sm" onClick={() => setTitheDialogOpen(true)} className="gap-2">
                  <HandCoins className="size-4" /> Record Tithe
                </Button>
                <Button size="sm" onClick={() => setTab('donations')} className="gap-2">
                  <Plus className="size-4" /> New Donation
                </Button>
              </>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <ScrollArea className="w-full whitespace-nowrap">
          <TabsList className="inline-flex w-max grid grid-cols-7 gap-1">
            <TabsTrigger value="overview" className="gap-1.5"><Wallet className="size-3.5" /> Overview</TabsTrigger>
            <TabsTrigger value="donations" className="gap-1.5"><ArrowDownCircle className="size-3.5" /> Income</TabsTrigger>
            <TabsTrigger value="expenses" className="gap-1.5"><ArrowUpCircle className="size-3.5" /> Expenses</TabsTrigger>
            <TabsTrigger value="tithes" className="gap-1.5"><HandCoins className="size-3.5" /> Tithes</TabsTrigger>
            <TabsTrigger value="budgets" className="gap-1.5"><PiggyBank className="size-3.5" /> Budgets</TabsTrigger>
            <TabsTrigger value="approvals" className="gap-1.5"><ClipboardCheck className="size-3.5" /> Approvals</TabsTrigger>
            {canManage && <TabsTrigger value="collections" className="gap-1.5"><Coins className="size-3.5" /> Collections</TabsTrigger>}
            {canManage && <TabsTrigger value="expense_requests" className="gap-1.5"><FileText className="size-3.5" /> Expense Requests</TabsTrigger>}
            {canManage && <TabsTrigger value="accounting" className="gap-1.5"><BookOpen className="size-3.5" /> Accounting/GL</TabsTrigger>}
            {canManage && <TabsTrigger value="bank" className="gap-1.5"><Landmark className="size-3.5" /> Cash & Bank</TabsTrigger>}
            {canManage && <TabsTrigger value="reports" className="gap-1.5"><BarChart3 className="size-3.5" /> Reports</TabsTrigger>}
            {isMemberRole && <TabsTrigger value="member_giving" className="gap-1.5"><User className="size-3.5" /> My Giving</TabsTrigger>}
            {canManage && <TabsTrigger value="settings" className="gap-1.5"><Settings className="size-3.5" /> Settings</TabsTrigger>}
          </TabsList>
        </ScrollArea>

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

        <TabsContent value="tithes" className="mt-4 space-y-4">
          <TithesTab
            canCreate={canCreate}
            canManage={canManage}
            canApprove={canApprove}
            onRecordTithe={() => setTitheDialogOpen(true)}
            highlightId={highlightTitheId}
            onHighlightConsumed={() => setHighlightTitheId(null)}
          />
        </TabsContent>

        <TabsContent value="budgets" className="mt-4 space-y-4">
          <BudgetsTab canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} />
        </TabsContent>

        <TabsContent value="approvals" className="mt-4 space-y-4">
          <ApprovalsTab canApprove={canApprove} />
        </TabsContent>

        {canManage && (
          <TabsContent value="collections" className="mt-4 space-y-4">
            <CollectionsTab />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="expense_requests" className="mt-4 space-y-4">
            <ExpenseRequestsTab canApprove={canApprove} />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="accounting" className="mt-4 space-y-4">
            <AccountingTab />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="bank" className="mt-4 space-y-4">
            <BankTab />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="reports" className="mt-4 space-y-4">
            <ReportsTab />
          </TabsContent>
        )}
        {isMemberRole && (
          <TabsContent value="member_giving" className="mt-4 space-y-4">
            <MemberGivingTab />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="settings" className="mt-4 space-y-4">
            <FinanceSettingsTab />
          </TabsContent>
        )}
      </Tabs>

      {titheDialogOpen && (
        <RecordTitheDialog
          open={titheDialogOpen}
          onOpenChange={setTitheDialogOpen}
          onSaved={() => setTitheDialogOpen(false)}
        />
      )}
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-0">
          <EmptyState
            icon={AlertTriangle}
            title="Failed to load finance overview"
            description="Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            }
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={TrendingUp}
          label="Income (this month)"
          value={formatCurrency(data.incomeThisMonth, currency)}
          sub={`${data.incomeCountThisMonth} donations`}
          accent="emerald"
        />
        <StatCard
          icon={TrendingDown}
          label="Expenses (this month)"
          value={formatCurrency(data.expensesThisMonth, currency)}
          sub={`${data.expenseCountThisMonth} expenses`}
          accent="rose"
        />
        <StatCard
          icon={Scale}
          label="Net this month"
          value={formatCurrency(data.netThisMonth, currency)}
          sub={data.netThisMonth >= 0 ? 'Surplus' : 'Deficit'}
          accent={data.netThisMonth >= 0 ? 'primary' : 'amber'}
        />
        <StatCard
          icon={ClipboardCheck}
          label="Pending approvals"
          value={data.pendingApprovals.toString()}
          sub="awaiting review"
          accent="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend chart */}
        <SectionCard
          className="lg:col-span-2"
          title="Income vs Expenses — last 6 months"
          description="Confirmed donations and approved/paid expenses."
        >
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
                  borderRadius: 10,
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
        </SectionCard>

        {/* Top donors */}
        <SectionCard
          title="Top donors (90 days)"
          description="Confirmed giving only."
        >
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
                  <span className="font-semibold nums">{formatCurrency(d.total, currency)}</span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      {/* Fund balances */}
      <SectionCard
        title="Fund balances"
        description="Current balances tracked in this system."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data.funds.map((f) => (
            <div key={f.id} className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium truncate">{f.name}</p>
                {f.code && (
                  <Badge variant="outline" className="text-[9px]">{f.code}</Badge>
                )}
              </div>
              <p className="text-lg font-bold nums">{formatCurrency(f.balance, currency)}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Recent transactions */}
      <SectionCard
        title="Recent transactions"
        description="Last 10 donations and expenses combined."
      >
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
                      className={`size-8 rounded-full grid place-items-center shrink-0 ring-1 ring-inset ${
                        isDonation
                          ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/15'
                          : 'bg-rose-500/10 text-rose-600 ring-rose-500/15'
                      }`}
                    >
                      {isDonation ? <ArrowDownCircle className="size-4" /> : <ArrowUpCircle className="size-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.description}</p>
                      <p className="text-xs text-muted-foreground nums">
                        {formatDate(r.date)} · {r.fund} · {titleCase(r.method)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`text-sm font-semibold nums ${
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
      </SectionCard>
    </div>
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

  // When filters change, reset page to 1 — handled inline in the setters below.
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
          <Toolbar>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search donor name or reference…"
                className="pl-9 h-9"
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
              <SelectTrigger className="w-full lg:w-44 h-9" aria-label="Filter by fund">
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
              <SelectTrigger className="w-full lg:w-36 h-9" aria-label="Filter by method">
                <SelectValue placeholder="All methods" />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m.value || 'all'} value={m.value || 'all'}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full lg:w-36 h-9" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {DONATION_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value || 'all'} value={s.value || 'all'}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Toolbar>
          <Toolbar>
            <div className="flex items-center gap-2">
              <Label htmlFor="from" className="text-xs text-muted-foreground">From</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1) }}
                className="w-40 h-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="to" className="text-xs text-muted-foreground">To</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1) }}
                className="w-40 h-9"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0 gap-2">
              <RefreshCw className="size-3.5" /> Reset
            </Button>
            {canExport && (
              <Button variant="outline" size="sm" onClick={onExport} className="sm:ml-auto gap-2">
                <FileSpreadsheet className="size-3.5" /> Export CSV
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                <Plus className="size-3.5" /> New Donation
              </Button>
            )}
          </Toolbar>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load donations"
              description="Please try again or adjust your filters."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No donations found"
              description={search || fundId || method || status || from || to
                ? 'Try changing your filters.'
                : 'Record your first donation to get started.'}
              action={canCreate ? (
                <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                  <Plus className="size-4" /> New Donation
                </Button>
              ) : undefined}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                    <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Date</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Donor</TableHead>
                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Fund</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Amount</TableHead>
                    <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Method</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-right pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((d) => (
                    <TableRow key={d.id} className="cursor-pointer hover:bg-muted/40 border-border/60" onClick={() => openDetail(d.id)}>
                      <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap nums">
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
                      <TableCell className="text-right font-semibold nums">
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
                              <Eye className="size-3.5 mr-2" /> View
                            </DropdownMenuItem>
                            {canUpdate && (
                              <DropdownMenuItem onClick={() => openEdit(d.id)}>
                                <Pencil className="size-3.5 mr-2" /> Edit
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
                                  <Trash2 className="size-3.5 mr-2" /> Delete
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
                  Showing <span className="font-medium text-foreground nums">{(page - 1) * pageSize + 1}</span>
                  {'–'}
                  <span className="font-medium text-foreground nums">{Math.min(page * pageSize, data.total)}</span>
                  {' '}of <span className="font-medium text-foreground nums">{data.total}</span>
                  {' · '}Total: <span className="font-semibold text-foreground nums">{formatCurrency(data.sum, currency)}</span>
                  {isFetching && <span className="ml-2 text-primary">· updating…</span>}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >Previous</Button>
                  <span className="text-xs text-muted-foreground nums">Page {page} of {totalPages}</span>
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
      <DialogContent className="sm:max-w-[500px]">
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
            <Button onClick={onEdit} className="gap-2"><Pencil className="size-3.5" /> Edit</Button>
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
      <span className={`text-sm font-medium ${highlight ? 'text-base font-bold nums' : ''}`}>{value}</span>
    </div>
  )
}

// Tiny member status badge for member-picker result rows (matches member-picker.tsx palette).
const MEMBER_STATUS_BADGE_CLASS: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  visitor: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  follow_up: 'border-teal-500/30 bg-teal-500/5 text-teal-700 dark:text-teal-400',
  new_convert: 'border-lime-500/30 bg-lime-500/5 text-lime-700 dark:text-lime-400',
  inactive: 'border-zinc-500/30 bg-zinc-500/5 text-zinc-700 dark:text-zinc-400',
  transferred: 'border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-400',
  deceased: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400',
}
const MEMBER_STATUS_LABEL: Record<string, string> = {
  active: 'Active', visitor: 'Visitor', follow_up: 'Follow-up', new_convert: 'New convert',
  inactive: 'Inactive', transferred: 'Transferred', deceased: 'Deceased',
}

function MemberStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 font-medium leading-4 text-[9px] ${MEMBER_STATUS_BADGE_CLASS[status] ?? 'border-border/60 bg-muted/40 text-muted-foreground'}`}
    >
      {MEMBER_STATUS_LABEL[status] ?? status}
    </span>
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
  const [linkedName, setLinkedName] = useState<string | null>(null)
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

  // member search (shared picker hook — debounces internally, hits /api/members)
  const { results: memberResults } = useMemberSearch({ q: memberSearch, enabled: open })

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
      setLinkedName(existing.memberId ? (existing.donorName ?? null) : null)
      setFundId(existing.fundId ?? '')
      setAmount(String(existing.amount))
      setMethod(existing.method)
      setReference(existing.reference ?? '')
      setStatus(existing.status)
      setDonatedAt(new Date(existing.donatedAt).toISOString().slice(0, 10))
    } else if (mode === 'create') {
      setDonorName(''); setMemberId(''); setLinkedName(null); setFundId(''); setAmount('')
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
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Record a donation' : 'Edit donation'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Enter the details of this giving record.'
              : 'Update the donation details below.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto scroll-thin pr-1">
          {/* Donor — member search or manual name */}
          <div>
            <Label className="text-sm font-medium">Donor</Label>
            {memberId ? (
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <Badge variant="secondary" className="text-xs">
                  Linked: {linkedName ?? (donorName || 'Member')}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => { setMemberId(''); setLinkedName(null) }}>Unlink</Button>
              </div>
            ) : (
              <div className="space-y-2 mt-1.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search member to link (optional)…"
                    className="pl-9 h-9"
                  />
                </div>
                {memberResults.length > 0 && (
                  <div className="border border-border/60 rounded-md max-h-32 overflow-y-auto scroll-thin">
                    {memberResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMemberId(m.id)
                          setDonorName(`${m.firstName} ${m.lastName}`.trim())
                          setLinkedName(`${m.firstName} ${m.lastName}`.trim())
                          setMemberSearch('')
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-accent border-b border-border/40 last:border-0 flex items-center gap-2"
                      >
                        <Avatar className="size-5">
                          {m.photoUrl ? <AvatarImage src={m.photoUrl} alt={`${m.firstName} ${m.lastName}`} /> : null}
                          <AvatarFallback className="bg-primary/10 text-primary text-[8px] font-semibold">
                            {`${(m.firstName ?? '').charAt(0)}${(m.lastName ?? '').charAt(0)}`.toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate">
                          {m.firstName} {m.lastName}
                          {m.memberId ? <span className="text-muted-foreground"> · {m.memberId}</span> : null}
                        </span>
                        {m.status ? <MemberStatusBadge status={m.status} /> : null}
                      </button>
                    ))}
                  </div>
                )}
                <Input
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                  placeholder="…or enter donor name manually"
                  className="h-9"
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Fund</Label>
              <Select value={fundId || 'none'} onValueChange={(v) => setFundId(v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue placeholder="Select fund" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unspecified</SelectItem>
                  {fundsData?.items.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Amount ({currency ?? 'NGN'})</Label>
              <Input
                type="number"
                min="0"
                step="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1.5 h-9 nums"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DONATION_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
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
              <Label className="text-sm font-medium">Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1.5 h-9" />
            </div>
            <div>
              <Label className="text-sm font-medium">Date</Label>
              <Input type="date" value={donatedAt} onChange={(e) => setDonatedAt(e.target.value)} className="mt-1.5 h-9" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
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
          <Toolbar>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search description, payee, category…"
                className="pl-9 h-9"
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
              <SelectTrigger className="w-full lg:w-40 h-9" aria-label="Filter by status">
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
              <SelectTrigger className="w-full lg:w-44 h-9" aria-label="Filter by category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Toolbar>
          <Toolbar>
            <div className="flex items-center gap-2">
              <Label htmlFor="exp-from" className="text-xs text-muted-foreground">From</Label>
              <Input id="exp-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="w-40 h-9" />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="exp-to" className="text-xs text-muted-foreground">To</Label>
              <Input id="exp-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="w-40 h-9" />
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0 gap-2">
              <RefreshCw className="size-3.5" /> Reset
            </Button>
            {canExport && (
              <Button variant="outline" size="sm" onClick={onExport} className="sm:ml-auto gap-2">
                <FileSpreadsheet className="size-3.5" /> Export CSV
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                <Plus className="size-3.5" /> New Expense
              </Button>
            )}
          </Toolbar>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load expenses"
              description="Please try again or adjust your filters."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={ArrowUpCircle}
              title="No expenses found"
              description={search || status || category || from || to
                ? 'Try changing your filters.'
                : 'Record your first expense to get started.'}
              action={canCreate ? (
                <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                  <Plus className="size-4" /> New Expense
                </Button>
              ) : undefined}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                    <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Date</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Category</TableHead>
                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Description</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Amount</TableHead>
                    <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Payee</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-right pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((e) => (
                    <TableRow key={e.id} className="hover:bg-muted/40 border-border/60">
                      <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap nums">
                        {formatDate(e.incurredAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] font-medium">{e.category}</Badge>
                          {e.needsApproval && (
                            <Badge className="text-[10px] font-medium bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300" variant="outline">
                              <AlertTriangle className="size-3 mr-1" /> Needs approval
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        <span className="line-clamp-1">{e.description}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold nums text-rose-600">
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
                                variant="default"
                                className="size-7 p-0 bg-emerald-600 text-white hover:bg-emerald-700"
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
                                className="size-7 p-0 text-destructive hover:text-destructive"
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
                                  <Trash2 className="size-3.5 mr-2" /> Delete
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
                  Showing <span className="font-medium text-foreground nums">{(page - 1) * pageSize + 1}</span>
                  {'–'}
                  <span className="font-medium text-foreground nums">{Math.min(page * pageSize, data.total)}</span>
                  {' '}of <span className="font-medium text-foreground nums">{data.total}</span>
                  {' · '}Total: <span className="font-semibold text-rose-600 nums">{formatCurrency(data.sum, currency)}</span>
                  {isFetching && <span className="ml-2 text-primary">· updating…</span>}
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                  <span className="text-xs text-muted-foreground nums">Page {page} of {totalPages}</span>
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
        <DialogContent className="sm:max-w-[500px]">
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
            <Label htmlFor="approve-comment" className="text-sm font-medium">Comment (optional)</Label>
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
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
          <DialogDescription>
            New expenses default to <span className="font-medium">pending</span> status. High-value expenses (&ge; {formatCurrency(100_000, currency)}) require approval before reconciliation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto scroll-thin pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Amount ({currency ?? 'NGN'})</Label>
              <Input type="number" min="0" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5 h-9 nums" />
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1.5" placeholder="What was this expense for?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Payee</Label>
              <Input value={payee} onChange={(e) => setPayee(e.target.value)} className="mt-1.5 h-9" placeholder="Vendor / recipient" />
            </div>
            <div>
              <Label className="text-sm font-medium">Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1.5 h-9" placeholder="Receipt / invoice no." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DONATION_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Date</Label>
              <Input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} className="mt-1.5 h-9" />
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Fund (optional)</Label>
            <Select value={fundId || 'none'} onValueChange={(v) => setFundId(v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1.5 h-9"><SelectValue placeholder="Select fund" /></SelectTrigger>
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
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving ? 'Saving…' : 'Record expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- budgets tab ----------
function BudgetsTab({ canCreate, canUpdate, canManage }: { canCreate: boolean; canUpdate: boolean; canManage: boolean }) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BudgetItem | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BudgetItem | null>(null)

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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/finance/budgets/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Budget deleted')
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const currentYear = new Date().getFullYear()
  const totalAnnualBudget = (data?.items ?? [])
    .filter((b) => b.fiscalYear === currentYear && b.period === 'annual')
    .reduce((s, b) => s + b.amount, 0)

  const showRowActions = canUpdate || canManage

  return (
    <>
      <SectionCard
        title="Budgets"
        description={<>Annual budgets per fund · {currentYear} total: <span className="font-semibold nums">{formatCurrency(totalAnnualBudget, currency)}</span></>}
        action={canCreate ? (
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="size-3.5" /> New Budget
          </Button>
        ) : undefined}
      >
        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        ) : isError ? (
          <EmptyState
            icon={AlertTriangle}
            title="Failed to load budgets"
            description="Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            }
          />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="No budgets yet"
            description="Create a budget to track spending against goals."
            action={canCreate ? (
              <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                <Plus className="size-4" /> New Budget
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {data.items.map((b) => (
              <div key={b.id} className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.fund?.name ?? 'General'}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide nums">
                      FY {b.fiscalYear} · {b.period}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px] font-medium nums">
                      {b.utilization}% used
                    </Badge>
                    {showRowActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7" aria-label="Budget actions">
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canUpdate && (
                            <DropdownMenuItem onClick={() => { setEditTarget(b); setEditOpen(true) }}>
                              <Pencil className="size-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                          )}
                          {canManage && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteTarget(b)}
                              >
                                <Trash2 className="size-3.5 mr-2" /> Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Budget</span>
                  <span className="text-sm font-semibold nums">{formatCurrency(b.amount, currency)}</span>
                </div>
                <Progress value={b.utilization} className="h-2 mb-2" />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Spent: <span className="text-rose-600 font-medium nums">{formatCurrency(b.actualExpense, currency)}</span></span>
                  <span>Income: <span className="text-emerald-600 font-medium nums">{formatCurrency(b.actualIncome, currency)}</span></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

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

      {editOpen && editTarget && (
        <BudgetEditDialog
          open={editOpen}
          budget={editTarget}
          onOpenChange={(o) => { setEditOpen(o); if (!o) setEditTarget(null) }}
          onSaved={() => {
            setEditOpen(false)
            setEditTarget(null)
            queryClient.invalidateQueries({ queryKey: ['finance'] })
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete budget?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the budget for{' '}
              <strong>{deleteTarget?.fund?.name ?? 'General'}</strong> (FY {deleteTarget?.fiscalYear},{' '}
              {deleteTarget?.period}). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete budget'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create a budget</DialogTitle>
          <DialogDescription>Set an annual or quarterly budget for a fund.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Fund</Label>
            <Select value={fundId || 'none'} onValueChange={(v) => setFundId(v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1.5 h-9"><SelectValue placeholder="Select fund" /></SelectTrigger>
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
              <Label className="text-sm font-medium">Fiscal year</Label>
              <Input
                type="number"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
                className="mt-1.5 h-9 nums"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
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
            <Label className="text-sm font-medium">Budget amount</Label>
            <Input
              type="number"
              min="0"
              step="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1.5 h-9 nums"
              placeholder="e.g. 5,000,000"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
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
      <SectionCard
        title="Pending approvals"
        description={`Expenses awaiting approval. High-value (≥ ${formatCurrency(100_000, currency)}) expenses require explicit approval.`}
      >
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load pending approvals"
              description="Please try again."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All caught up!"
              description="No expenses awaiting approval."
            />
          ) : (
            <div className="divide-y divide-border/60">
              {data.items.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[10px] font-medium">{e.category}</Badge>
                      {e.needsApproval && (
                        <Badge className="text-[10px] font-medium bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300" variant="outline">
                          <AlertTriangle className="size-3 mr-1" /> High value
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{e.description}</p>
                    <p className="text-xs text-muted-foreground nums">
                      {formatDate(e.incurredAt)} · {e.payee ?? '—'} · {e.fund?.name ?? 'General'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold nums text-rose-600 mb-1">
                      −{formatCurrency(e.amount, currency)}
                    </p>
                    {canApprove ? (
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs bg-emerald-600 text-white hover:bg-emerald-700 gap-1"
                          onClick={() => { setActionTarget(e); setActionType('approve') }}
                        >
                          <CheckCircle2 className="size-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                          onClick={() => { setActionTarget(e); setActionType('reject') }}
                        >
                          <X className="size-3.5" /> Reject
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
      </SectionCard>

      <Dialog
        open={!!actionTarget && !!actionType}
        onOpenChange={(o) => {
          if (!o) { setActionTarget(null); setActionType(null); setComment('') }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
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
            <Label htmlFor="apv-comment" className="text-sm font-medium">Comment (optional)</Label>
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

      {/* Pending giving submissions (member-submitted tithes + donations) */}
      <PendingGivingSection canApprove={canApprove} />
    </>
  )
}

function PendingGivingSection({ canApprove }: { canApprove: boolean }) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const queryClient = useQueryClient()
  const [filterMonth, setFilterMonth] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const pendingQ = useQuery<{ donations: any[]; tithes: any[]; counts: { donations: number; tithes: number; total: number } }>({
    queryKey: ['finance', 'pending'],
    queryFn: async () => { const res = await fetch('/api/finance/pending?pageSize=100'); if (!res.ok) throw new Error('Failed'); return res.json() },
  })

  const confirmMutation = useMutation({
    mutationFn: async ({ id, kind, action, reason }: { id: string; kind: 'donation' | 'tithe'; action: 'confirmed' | 'rejected'; reason?: string }) => {
      const url = kind === 'donation' ? `/api/finance/donations/${id}` : `/api/finance/tithes/${id}`
      const payload: Record<string, unknown> = { status: action }
      if (action === 'rejected' && reason) payload.rejectionReason = reason
      const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Action failed')
      }
      return res.json()
    },
    onSuccess: (_d, vars) => { toast.success(vars.action === 'confirmed' ? 'Confirmed' : 'Rejected'); queryClient.invalidateQueries({ queryKey: ['finance'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  // Reject dialog state (for both tithes + donations in the Approvals tab)
  const [rejectTarget, setRejectTarget] = useState<{ id: string; kind: 'donation' | 'tithe'; name: string; amount: number } | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const matchesDateFilters = (dateStr: string) => {
    const d = new Date(dateStr); if (isNaN(d.getTime())) return true
    if (filterMonth) { const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; if (m !== filterMonth) return false }
    if (filterFrom) { const from = new Date(filterFrom + 'T00:00:00'); if (d < from) return false }
    if (filterTo) { const to = new Date(filterTo + 'T23:59:59'); if (d > to) return false }
    return true
  }

  const pendingDonations = (pendingQ.data?.donations ?? []).filter((d: any) => matchesDateFilters(d.date))
  const pendingTithes = (pendingQ.data?.tithes ?? []).filter((t: any) => matchesDateFilters(t.titheMonth))
  const hasFilters = !!(filterMonth || filterFrom || filterTo)
  const filteredTotal = pendingDonations.length + pendingTithes.length

  return (
    <>
    <SectionCard title="Pending giving submissions" description="Member-submitted tithes and donations awaiting verification."
      action={<div className="flex items-center gap-2">{hasFilters && <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-700 border-indigo-500/20">{filteredTotal} shown</Badge>}{pendingQ.data && <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20">{pendingQ.data.counts.total} pending</Badge>}</div>}>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-end gap-3 p-4 border-b border-border/60 bg-muted/20">
          <div><label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground block mb-1">By Month</label><Input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="h-9 w-[150px]" /></div>
          <div><label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground block mb-1">From Date</label><Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-9 w-[150px]" /></div>
          <div><label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground block mb-1">To Date</label><Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-9 w-[150px]" /></div>
          {hasFilters && <Button variant="outline" size="sm" onClick={() => { setFilterMonth(''); setFilterFrom(''); setFilterTo('') }} className="h-9 gap-1.5"><X className="size-3.5" /> Clear</Button>}
        </div>
        {pendingQ.isLoading ? <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
        : pendingTithes.length === 0 && pendingDonations.length === 0 ? <EmptyState icon={hasFilters ? Filter : CheckCircle2} title={hasFilters ? 'No submissions match' : 'No pending submissions'} description={hasFilters ? 'Try adjusting filters.' : 'All confirmed.'} />
        : <div className="divide-y divide-border/60">
          {pendingTithes.map((t: any) => <div key={`t-${t.id}`} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0 flex-1"><div className="flex items-center gap-2 mb-1"><Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-700 border-violet-500/20"><HandCoins className="size-3 mr-1" /> Tithe</Badge><span className="text-[10px] text-muted-foreground">{new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(t.titheMonth))}</span></div><p className="text-sm font-medium truncate">{t.member?.name ?? 'Unknown'}</p><p className="text-xs text-muted-foreground">{t.method}</p></div><div className="text-right shrink-0"><p className="text-sm font-semibold nums">{formatCurrency(t.amount, currency)}</p>{canApprove && <div className="flex gap-1.5 mt-1.5"><Button size="sm" className="h-7 text-xs bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => confirmMutation.mutate({ id: t.id, kind: 'tithe', action: 'confirmed' })} disabled={confirmMutation.isPending}>Confirm</Button><Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => { setRejectTarget({ id: t.id, kind: 'tithe', name: t.member?.name ?? 'Unknown', amount: t.amount }); setRejectReason('') }} disabled={confirmMutation.isPending}>Reject</Button></div>}</div></div>)}
          {pendingDonations.map((d: any) => <div key={`d-${d.id}`} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0 flex-1"><div className="flex items-center gap-2 mb-1"><Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/20">Donation</Badge></div><p className="text-sm font-medium truncate">{d.donorName ?? d.member?.name ?? 'Unknown'}</p><p className="text-xs text-muted-foreground">{d.method}</p></div><div className="text-right shrink-0"><p className="text-sm font-semibold nums">{formatCurrency(d.amount, currency)}</p>{canApprove && <div className="flex gap-1.5 mt-1.5"><Button size="sm" className="h-7 text-xs bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => confirmMutation.mutate({ id: d.id, kind: 'donation', action: 'confirmed' })} disabled={confirmMutation.isPending}>Confirm</Button><Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => { setRejectTarget({ id: d.id, kind: 'donation', name: d.donorName ?? d.member?.name ?? 'Unknown', amount: d.amount }); setRejectReason('') }} disabled={confirmMutation.isPending}>Reject</Button></div>}</div></div>)}
        </div>}
      </CardContent>
    </SectionCard>

    {/* Reject dialog with required reason */}
    <AlertDialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason('') } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject {rejectTarget?.kind}?</AlertDialogTitle>
          <AlertDialogDescription>
            {rejectTarget && (
              <span>
                <strong>{rejectTarget.name}</strong> — {formatCurrency(rejectTarget.amount, currency)}
              </span>
            )}
          </AlertDialogDescription>
          <div className="pt-3 space-y-2">
            <Label htmlFor="approvals-reject-reason" className="text-sm font-medium text-destructive">
              Reason for rejection <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="approvals-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Duplicate entry, incorrect amount, unverified source…"
              rows={3}
              className="resize-none"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              The member will be notified with this reason. Required — cannot reject without a reason.
            </p>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setRejectReason('')}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={confirmMutation.isPending || !rejectReason.trim()}
            onClick={() => {
              if (rejectTarget) {
                confirmMutation.mutate({ id: rejectTarget.id, kind: rejectTarget.kind, action: 'rejected', reason: rejectReason.trim() })
                setRejectTarget(null); setRejectReason('')
              }
            }}
          >
            {confirmMutation.isPending ? 'Processing…' : 'Reject'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

// ---------- tithes tab (staff view) ----------
function TithesTab({
  canCreate, canManage, canApprove, onRecordTithe, highlightId, onHighlightConsumed,
}: {
  canCreate: boolean
  canManage: boolean
  canApprove: boolean
  onRecordTithe: () => void
  highlightId?: string | null
  onHighlightConsumed?: () => void
}) {
  const { organization } = useAuth()
  const currency = organization?.currency
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [method, setMethod] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const debouncedSearch = useDebouncedValue(search, 350)

  const queryKey = useMemo(
    () => ['finance', 'tithes', debouncedSearch, method, status, from, to, page, pageSize] as const,
    [debouncedSearch, method, status, from, to, page],
  )
  const { data, isLoading, isError, refetch } = useQuery<TitheListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (method) params.set('method', method)
      if (status) params.set('status', status)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await fetch(`/api/finance/tithes?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load tithes')
      }
      return res.json()
    },
  })

  const [actionTarget, setActionTarget] = useState<TitheItem | null>(null)
  const [actionType, setActionType] = useState<'confirmed' | 'rejected' | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')

  const statusMutation = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: 'confirmed' | 'rejected'; reason?: string }) => {
      const payload: Record<string, unknown> = { status }
      if (status === 'rejected') payload.rejectionReason = reason
      const res = await fetch(`/api/finance/tithes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Action failed')
      }
      return res.json()
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.status === 'confirmed' ? 'Tithe confirmed' : 'Tithe rejected')
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      setActionTarget(null); setActionType(null); setRejectionReason('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))
  const resetFilters = () => {
    setSearch(''); setMethod(''); setStatus(''); setFrom(''); setTo(''); setPage(1)
  }
  const hasFilters = !!(search || method || status || from || to)

  // Scroll to + briefly flash the highlighted tithe row (notification click).
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => {
    if (!highlightId) return
    const el = highlightRowRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    // Clear the highlight after a short flash so the row doesn't stay highlighted forever.
    const t = setTimeout(() => onHighlightConsumed?.(), 4_000)
    return () => clearTimeout(t)
  }, [highlightId, data, onHighlightConsumed])

  return (
    <>
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <Toolbar>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search member or reference…"
                className="pl-9 h-9"
                aria-label="Search tithes"
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
            <Select value={method} onValueChange={(v) => { setMethod(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full lg:w-40 h-9" aria-label="Filter by method">
                <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All methods" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                {METHOD_OPTIONS.filter((m) => m.value).map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="mobile_money">Mobile Money</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-full lg:w-36 h-9" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </Toolbar>
          <Toolbar>
            <div className="flex items-center gap-2">
              <Label htmlFor="tithes-from" className="text-xs text-muted-foreground">From</Label>
              <Input id="tithes-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="w-40 h-9" />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="tithes-to" className="text-xs text-muted-foreground">To</Label>
              <Input id="tithes-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="w-40 h-9" />
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0 gap-2">
              <RefreshCw className="size-3.5" /> Reset
            </Button>
            {canCreate && (
              <Button size="sm" onClick={onRecordTithe} className="sm:ml-auto gap-2">
                <HandCoins className="size-3.5" /> Record Tithe
              </Button>
            )}
          </Toolbar>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load tithes"
              description="Please try again or adjust your filters."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="No tithes found"
              description={hasFilters ? 'Try changing your filters.' : 'Record the first tithe to get started.'}
              action={canCreate ? (
                <Button size="sm" onClick={onRecordTithe} className="gap-2">
                  <HandCoins className="size-4" /> Record Tithe
                </Button>
              ) : undefined}
            />
          ) : (
            <>
              <div className="max-h-[28rem] overflow-y-auto scroll-thin">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                      <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Member</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Month</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Amount</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Method</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                      <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Reference</TableHead>
                      <TableHead className="text-right pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((t) => {
                      const isHighlighted = !!highlightId && t.id === highlightId
                      return (
                        <TableRow
                          key={t.id}
                          ref={isHighlighted ? highlightRowRef : undefined}
                          className={`hover:bg-muted/40 border-border/60 ${isHighlighted ? 'bg-amber-500/15 ring-2 ring-inset ring-amber-500/40 animate-pulse' : ''}`}
                        >
                        <TableCell className="pl-4 text-xs font-medium">
                          {t.member ? `${t.member.firstName} ${t.member.lastName}`.trim() : 'Unknown'}
                          {t.member?.memberId && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">· {t.member.memberId}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(t.titheMonth))}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold nums">{formatCurrency(t.amount, currency)}</TableCell>
                        <TableCell className="text-xs">{titleCase(t.method)}</TableCell>
                        <TableCell><StatusBadge status={t.status} /></TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{t.reference ?? '—'}</TableCell>
                        <TableCell className="pr-4 text-right">
                          {canApprove && t.status === 'pending' ? (
                            <div className="flex gap-1.5 justify-end">
                              <Button
                                size="sm"
                                className="h-7 text-xs bg-emerald-600 text-white hover:bg-emerald-700 gap-1"
                                onClick={() => { setActionTarget(t); setActionType('confirmed') }}
                                disabled={statusMutation.isPending}
                              >
                                <CheckCircle2 className="size-3.5" /> Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-destructive border-destructive/30 gap-1"
                                onClick={() => { setActionTarget(t); setActionType('rejected') }}
                                disabled={statusMutation.isPending}
                              >
                                <X className="size-3.5" /> Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/60 text-xs text-muted-foreground">
                  <span>Page {page} of {totalPages} · {data.total} tithes</span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-7">Prev</Button>
                    <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-7">Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!actionTarget && !!actionType} onOpenChange={(o) => { if (!o) { setActionTarget(null); setActionType(null) } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{actionType === 'confirmed' ? 'Confirm tithe?' : 'Reject tithe?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {actionTarget && (
                <span>
                  <strong>{actionTarget.member ? `${actionTarget.member.firstName} ${actionTarget.member.lastName}`.trim() : 'Unknown'}</strong>{' '}
                  — {formatCurrency(actionTarget.amount, currency)} for{' '}
                  {new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(actionTarget.titheMonth))}.
                </span>
              )}
            </AlertDialogDescription>
            {actionType === 'rejected' && (
              <div className="pt-3 space-y-2">
                <Label htmlFor="tithe-reject-reason" className="text-sm font-medium text-destructive">
                  Reason for rejection <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="tithe-reject-reason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Duplicate entry, incorrect amount, unverified source…"
                  rows={3}
                  className="resize-none"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  The member will be notified with this reason. Required — cannot reject without a reason.
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRejectionReason('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={actionType === 'confirmed'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-destructive text-white hover:bg-destructive/90'}
              disabled={statusMutation.isPending || (actionType === 'rejected' && !rejectionReason.trim())}
              onClick={() => {
                if (actionTarget && actionType) {
                  statusMutation.mutate({ id: actionTarget.id, status: actionType, reason: rejectionReason.trim() })
                }
              }}
            >
              {statusMutation.isPending ? 'Processing…' : actionType === 'confirmed' ? 'Confirm' : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------- member tithes view (member-only finance page) ----------
function MemberTithesView() {
  const { organization } = useAuth()
  const currency = organization?.currency

  const { data, isLoading, isError, refetch } = useQuery<TitheListResponse>({
    queryKey: ['finance', 'tithes', 'member'],
    queryFn: async () => {
      const res = await fetch('/api/finance/tithes?pageSize=50')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load your tithes')
      }
      return res.json()
    },
  })

  const totalGiven = (data?.items ?? []).reduce((s, t) => s + (t.status === 'confirmed' ? t.amount : 0), 0)
  const pendingTotal = (data?.items ?? []).reduce((s, t) => s + (t.status === 'pending' ? t.amount : 0), 0)

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={HandCoins}
          label="Total confirmed tithes"
          value={formatCurrency(totalGiven, currency)}
          sub={`${(data?.items ?? []).filter((t) => t.status === 'confirmed').length} records`}
          accent="emerald"
        />
        <StatCard
          icon={ClipboardCheck}
          label="Pending verification"
          value={formatCurrency(pendingTotal, currency)}
          sub={`${(data?.items ?? []).filter((t) => t.status === 'pending').length} pending`}
          accent="amber"
        />
        <StatCard
          icon={Wallet}
          label="Total submissions"
          value={String(data?.items.length ?? 0)}
          sub="all-time"
          accent="primary"
        />
      </div>

      <Card className="border-border/60">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Your tithes</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Your tithe submissions and their verification status.</p>
            </div>
          </div>
          {isLoading ? (
            <div className="p-4"><TableSkeleton rows={5} /></div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load your tithes"
              description="Please try again."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="No tithes yet"
              description="Use the Record Tithe button above to submit your first tithe."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                    <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Month</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Amount</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Method</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="pr-4 hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((t) => (
                    <TableRow key={t.id} className="hover:bg-muted/40 border-border/60">
                      <TableCell className="pl-4 text-xs">
                        {new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(t.titheMonth))}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold nums">{formatCurrency(t.amount, currency)}</TableCell>
                      <TableCell className="text-xs">{titleCase(t.method)}</TableCell>
                      <TableCell><StatusBadge status={t.status} /></TableCell>
                      <TableCell className="pr-4 hidden md:table-cell text-xs text-muted-foreground">{t.reference ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

// ---------- record tithe dialog (member auto-fills own memberId; staff selects) ----------
function RecordTitheDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const { user, organization } = useAuth()
  const currency = organization?.currency
  const isMemberRole = user?.role === 'member'
  const selfMemberId = user?.memberId ?? ''

  const [memberId, setMemberId] = useState('')
  const [linkedName, setLinkedName] = useState<string | null>(null)
  const [memberSearch, setMemberSearch] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [titheMonth, setTitheMonth] = useState(new Date().toISOString().slice(0, 7))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<string>('confirmed')
  const [saving, setSaving] = useState(false)

  // member search (shared picker hook — debounces internally, hits /api/members)
  const { results: memberResults } = useMemberSearch({ q: memberSearch, enabled: open && !isMemberRole })

  useEffect(() => {
    if (open) {
      setMemberId(isMemberRole ? selfMemberId : '')
      setLinkedName(null)
      setMemberSearch('')
      setAmount('')
      setMethod('cash')
      setTitheMonth(new Date().toISOString().slice(0, 7))
      setReference('')
      setNote('')
      setStatus('confirmed')
    }
  }, [open, isMemberRole, selfMemberId])

  const submit = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error('Enter a valid amount'); return
    }
    if (!isMemberRole && !memberId) {
      toast.error('Select a member'); return
    }
    setSaving(true)
    try {
      const monthIso = titheMonth ? `${titheMonth}-01T00:00:00Z` : new Date().toISOString()
      const payload: Record<string, unknown> = {
        memberId: isMemberRole ? selfMemberId : memberId,
        amount: Number(amount),
        method,
        titheMonth: monthIso,
        reference: reference.trim() || null,
        note: note.trim() || null,
      }
      if (!isMemberRole) payload.status = status
      const res = await fetch('/api/finance/tithes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Save failed')
      }
      toast.success('Tithe recorded')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="size-4 text-primary" /> Record tithe
          </DialogTitle>
          <DialogDescription>
            {isMemberRole
              ? 'Submit your tithe. The finance office will verify and confirm receipt.'
              : 'Record a tithe for the selected member. Status defaults to confirmed.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto scroll-thin pr-1">
          <div>
            <Label className="text-sm font-medium">Member</Label>
            {isMemberRole ? (
              <div className="mt-1.5">
                <Badge variant="secondary" className="text-xs gap-1">
                  <HandCoins className="size-3" /> {user?.name ?? 'You'}
                </Badge>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Your tithe will be recorded against your member profile.
                </p>
              </div>
            ) : memberId ? (
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <Badge variant="secondary" className="text-xs">
                  Linked: {linkedName ?? 'Member'}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => { setMemberId(''); setLinkedName(null) }}>Unlink</Button>
              </div>
            ) : (
              <div className="space-y-2 mt-1.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search member to link…"
                    className="pl-9 h-9"
                  />
                </div>
                {memberResults.length > 0 && (
                  <div className="border border-border/60 rounded-md max-h-32 overflow-y-auto scroll-thin">
                    {memberResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMemberId(m.id)
                          setLinkedName(`${m.firstName} ${m.lastName}`.trim())
                          setMemberSearch('')
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-accent border-b border-border/40 last:border-0 flex items-center gap-2"
                      >
                        <Avatar className="size-5">
                          {m.photoUrl ? <AvatarImage src={m.photoUrl} alt={`${m.firstName} ${m.lastName}`} /> : null}
                          <AvatarFallback className="bg-primary/10 text-primary text-[8px] font-semibold">
                            {`${(m.firstName ?? '').charAt(0)}${(m.lastName ?? '').charAt(0)}`.toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate">
                          {m.firstName} {m.lastName}{' '}
                          <span className="text-muted-foreground">· {m.memberId ?? 'no member number'}</span>
                        </span>
                        {m.status ? <MemberStatusBadge status={m.status} /> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Amount ({currency ?? 'NGN'})</Label>
              <Input
                type="number"
                min="0"
                step="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1.5 h-9 nums"
                placeholder="e.g. 5000"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Tithe month</Label>
              <Input
                type="month"
                value={titheMonth}
                onChange={(e) => setTitheMonth(e.target.value)}
                className="mt-1.5 h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DONATION_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isMemberRole && (
              <div>
                <Label className="text-sm font-medium">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label className="text-sm font-medium">Reference (optional)</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="mt-1.5 h-9"
              placeholder="e.g. txn ref / cheque no."
            />
          </div>

          <div>
            <Label className="text-sm font-medium">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1.5"
              rows={3}
              placeholder="Add a note for the finance office…"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving ? 'Saving…' : 'Record tithe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- budget edit dialog ----------
function BudgetEditDialog({
  open, budget, onOpenChange, onSaved,
}: {
  open: boolean
  budget: BudgetItem
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [fundId, setFundId] = useState(budget.fundId ?? '')
  const [fiscalYear, setFiscalYear] = useState(budget.fiscalYear)
  const [period, setPeriod] = useState(budget.period)
  const [amount, setAmount] = useState(String(budget.amount))
  const [saving, setSaving] = useState(false)

  const { data: fundsData } = useQuery<{ items: FundListItem[] }>({
    queryKey: ['finance', 'funds'],
    queryFn: async () => {
      const res = await fetch('/api/finance/funds')
      if (!res.ok) return { items: [] }
      return res.json()
    },
  })

  useEffect(() => {
    if (open) {
      setFundId(budget.fundId ?? '')
      setFiscalYear(budget.fiscalYear)
      setPeriod(budget.period)
      setAmount(String(budget.amount))
    }
  }, [open, budget])

  const submit = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) < 0) {
      toast.error('Enter a valid amount'); return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/finance/budgets/${budget.id}`, {
        method: 'PATCH',
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
      toast.success('Budget updated')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="size-4 text-primary" /> Edit budget</DialogTitle>
          <DialogDescription>
            Update the budget details for <strong>{budget.fund?.name ?? 'General'}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Fund</Label>
            <Select value={fundId || 'none'} onValueChange={(v) => setFundId(v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1.5 h-9"><SelectValue placeholder="Select fund" /></SelectTrigger>
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
              <Label className="text-sm font-medium">Fiscal year</Label>
              <Input
                type="number"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
                className="mt-1.5 h-9 nums"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
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
            <Label className="text-sm font-medium">Budget amount</Label>
            <Input
              type="number"
              min="0"
              step="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1.5 h-9 nums"
              placeholder="e.g. 5,000,000"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ===========================================================================
// FINANCE MODULE UPGRADE — New tab components (collections, expense requests,
// accounting/GL, bank, reports, member giving, settings)
// ===========================================================================

const CURRENCY_FMT = (n: number, currency = 'NGN') =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0)

// ---------- Collections tab ----------
function CollectionsTab() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'collections'],
    queryFn: async () => {
      const res = await fetch('/api/finance/collection-sessions?limit=50')
      if (!res.ok) throw new Error('Failed to load collections')
      return res.json()
    },
  })
  const sessions = data?.sessions ?? []

  const transition = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const res = await fetch(`/api/finance/collection-sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Collection updated')
      queryClient.invalidateQueries({ queryKey: ['finance', 'collections'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <PageHeader
        title="Offering Collections"
        eyebrow="Finance"
        description="Track offering collection sessions: open → counted → verified → handed over → deposited → posted to GL."
        icon={Coins}
        action={can('church_admin', 'finance', 'create') ? <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="size-4" /> New Session</Button> : undefined}
      />
      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? <TableSkeleton /> : sessions.length === 0 ? (
            <EmptyState icon={Coins} title="No collection sessions" description="Create a new session to start tracking offerings." />
          ) : (
            <div className="divide-y divide-border/40">
              {sessions.map((s: any) => (
                <div key={s.id} className="p-4 hover:bg-accent/30 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{new Date(s.sessionDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      <StatusPill status={s.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {s.countSheets?.length ?? 0} count sheet(s) · Total: {CURRENCY_FMT(s.totalAmount, s.currency)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setSelectedSession(s.id)}>View</Button>
                    {s.status === 'open' || s.status === 'counted' ? (
                      <Button size="sm" onClick={() => transition.mutate({ id: s.id, action: 'verify' })} disabled={transition.isPending}>Verify</Button>
                    ) : null}
                    {s.status === 'verified' ? (
                      <Button size="sm" onClick={() => transition.mutate({ id: s.id, action: 'handover' })} disabled={transition.isPending}>Handover</Button>
                    ) : null}
                    {s.status === 'handed_over' ? (
                      <Button size="sm" onClick={() => transition.mutate({ id: s.id, action: 'deposit' })} disabled={transition.isPending}>Deposit</Button>
                    ) : null}
                    {s.status === 'deposited' ? (
                      <Button size="sm" className="gap-1.5" onClick={() => transition.mutate({ id: s.id, action: 'post' })} disabled={transition.isPending}><BookOpen className="size-3.5" /> Post to GL</Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {createOpen && <CreateCollectionDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {selectedSession && <CollectionDetailDialog id={selectedSession} open={!!selectedSession} onOpenChange={(o) => !o && setSelectedSession(null)} />}
    </>
  )
}

function CreateCollectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10))
  const [counters, setCounters] = useState('')
  const [notes, setNotes] = useState('')
  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/finance/collection-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionDate, counters: counters.split(',').map(s => s.trim()).filter(Boolean), notes }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed') }
      return res.json()
    },
    onSuccess: () => { toast.success('Collection session created'); queryClient.invalidateQueries({ queryKey: ['finance', 'collections'] }); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Collection Session</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Session Date</Label><Input type="date" value={sessionDate} onChange={e => setSessionDate(e.target.value)} /></div>
          <div><Label>Counters (comma-separated)</Label><Input value={counters} onChange={e => setCounters(e.target.value)} placeholder="John, Mary, Peter" /></div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CollectionDetailDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [counterName, setCounterName] = useState('')
  const [lines, setLines] = useState<Array<{ category: string; amount: number }>>([{ category: 'general_offering', amount: 0 }])
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'collection', id],
    queryFn: async () => { const res = await fetch(`/api/finance/collection-sessions/${id}`); if (!res.ok) throw new Error('Failed'); return res.json() },
    enabled: open,
  })
  const submitCount = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/finance/collection-sessions/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counterName, lines: lines.filter(l => l.amount > 0) }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed') }
      return res.json()
    },
    onSuccess: () => { toast.success('Count sheet submitted'); queryClient.invalidateQueries({ queryKey: ['finance', 'collection', id] }); setCounterName(''); setLines([{ category: 'general_offering', amount: 0 }]) },
    onError: (e: Error) => toast.error(e.message),
  })
  const session = data?.session
  const CATEGORIES = ['general_offering', 'tithe', 'thanksgiving', 'special', 'building_fund', 'missions', 'welfare']
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Collection Detail</DialogTitle></DialogHeader>
        {isLoading ? <Skeleton className="h-40" /> : session ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="size-4 text-muted-foreground" />
              <span>{new Date(session.sessionDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <StatusPill status={session.status} />
            </div>
            {session.countSheets?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Count Sheets ({session.countSheets.length})</p>
                {session.countSheets.map((cs: any) => (
                  <div key={cs.id} className="border rounded-lg p-2 text-xs">
                    <div className="flex justify-between"><span className="font-medium">{cs.counterName}</span><span>{CURRENCY_FMT(cs.totalAmount, session.currency)}</span></div>
                    {cs.lines?.map((l: any, i: number) => <div key={i} className="text-muted-foreground">{l.category}: {CURRENCY_FMT(l.amount, session.currency)}</div>)}
                  </div>
                ))}
              </div>
            )}
            {(session.status === 'open' || session.status === 'counted') && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Add Count Sheet</p>
                <Input placeholder="Counter name" value={counterName} onChange={e => setCounterName(e.target.value)} />
                {lines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <Select value={l.category} onValueChange={v => setLines(prev => prev.map((x, j) => j === i ? { ...x, category: v } : x))}>
                      <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" className="w-32" value={l.amount || ''} onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) || 0 } : x))} />
                    {lines.length > 1 && <Button variant="ghost" size="icon" onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}><X className="size-4" /></Button>}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLines(prev => [...prev, { category: 'general_offering', amount: 0 }])}><Plus className="size-3.5" /> Add Line</Button>
                <Button className="w-full" disabled={!counterName || lines.every(l => l.amount === 0)} onClick={() => submitCount.mutate()}>Submit Count Sheet</Button>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------- Expense Requests tab ----------
function ExpenseRequestsTab({ canApprove }: { canApprove: boolean }) {
  const [createOpen, setCreateOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'expense-requests'],
    queryFn: async () => { const res = await fetch('/api/finance/expense-requests?limit=50'); if (!res.ok) throw new Error('Failed'); return res.json() },
  })
  const requests = data?.requests ?? []
  return (
    <>
      <PageHeader
        title="Expense Requests"
        eyebrow="Finance"
        description="Full expense workflow: draft → submitted → approved → paid → reconciled. Segregation of duty enforced."
        icon={FileText}
        action={<Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="size-4" /> New Request</Button>}
      />
      <Card className="border-border/60"><CardContent className="p-0">
        {isLoading ? <TableSkeleton /> : requests.length === 0 ? (
          <EmptyState icon={FileText} title="No expense requests" description="Create a new request to start the approval workflow." />
        ) : (
          <div className="divide-y divide-border/40">
            {requests.map((r: any) => <ExpenseRequestRow key={r.id} request={r} canApprove={canApprove} />)}
          </div>
        )}
      </CardContent></Card>
      {createOpen && <CreateExpenseRequestDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  )
}

function ExpenseRequestRow({ request: r, canApprove }: { request: any; canApprove: boolean }) {
  const queryClient = useQueryClient()
  const transition = useMutation({
    mutationFn: async ({ action, body }: { action: string; body?: any }) => {
      const res = await fetch(`/api/finance/expense-requests/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed') }
      return res.json()
    },
    onSuccess: () => { toast.success('Updated'); queryClient.invalidateQueries({ queryKey: ['finance', 'expense-requests'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="p-4 hover:bg-accent/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-muted-foreground">{r.requestNumber}</code>
            <StatusPill status={r.status} />
          </div>
          <p className="font-medium text-sm mt-1">{r.purpose}</p>
          <p className="text-xs text-muted-foreground">{r.category} · {CURRENCY_FMT(r.amount, r.currency)} · by {r.requestedByName}</p>
          {r.payee && <p className="text-xs text-muted-foreground">Payee: {r.payee}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {r.status === 'draft' && <Button size="sm" onClick={() => transition.mutate({ action: 'submit' })}>Submit</Button>}
          {canApprove && (r.status === 'submitted' || r.status === 'pending_approval') && (
            <>
              <Button size="sm" onClick={() => transition.mutate({ action: 'approve' })}>Approve</Button>
              <Button size="sm" variant="outline" onClick={() => transition.mutate({ action: 'reject', body: { reason: 'Rejected' } })}>Reject</Button>
            </>
          )}
          {canApprove && r.status === 'approved' && (
            <Button size="sm" onClick={() => transition.mutate({ action: 'pay', body: { paymentMethod: 'transfer' } })}>Pay</Button>
          )}
          {canApprove && r.status === 'paid' && (
            <Button size="sm" variant="outline" onClick={() => transition.mutate({ action: 'reconcile' })}>Reconcile</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateExpenseRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ category: 'utilities', purpose: '', description: '', amount: 0, payee: '' })
  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/finance/expense-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed') }
      return res.json()
    },
    onSuccess: () => { toast.success('Expense request created'); queryClient.invalidateQueries({ queryKey: ['finance', 'expense-requests'] }); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  const CATEGORIES = ['utilities', 'maintenance', 'salaries', 'administration', 'evangelism', 'welfare', 'youth', 'media', 'events', 'capital', 'professional_services']
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Expense Request</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Purpose</Label><Input value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} /></div>
          <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Amount (₦)</Label><Input type="number" value={form.amount || ''} onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))} /></div>
            <div><Label>Payee</Label><Input value={form.payee} onChange={e => setForm(f => ({ ...f, payee: e.target.value }))} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.purpose || !form.amount}>Create Request</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Accounting / GL tab ----------
function AccountingTab() {
  const [postOpen, setPostOpen] = useState(false)
  const { data: coaData } = useQuery({
    queryKey: ['finance', 'chart-of-accounts'],
    queryFn: async () => { const res = await fetch('/api/finance/chart-of-accounts'); if (!res.ok) throw new Error('Failed'); return res.json() },
  })
  const { data: jeData } = useQuery({
    queryKey: ['finance', 'journal-entries'],
    queryFn: async () => { const res = await fetch('/api/finance/journal-entries?limit=30'); if (!res.ok) throw new Error('Failed'); return res.json() },
  })
  const accounts = coaData?.accounts ?? []
  const entries = jeData?.entries ?? []
  const grouped = accounts.reduce((acc: Record<string, any[]>, a: any) => {
    if (!acc[a.accountType]) acc[a.accountType] = []
    acc[a.accountType].push(a)
    return acc
  }, {})
  const TYPE_LABELS: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', fund_balance: 'Fund Balances', income: 'Income', expenditure: 'Expenditure' }
  return (
    <>
      <PageHeader
        title="Accounting & General Ledger"
        eyebrow="Finance"
        description="Double-entry accounting: chart of accounts, journal entries, trial balance. Balanced debits = credits enforced."
        icon={BookOpen}
        action={<Button onClick={() => setPostOpen(true)} className="gap-2"><Plus className="size-4" /> Post Journal</Button>}
      />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="border-border/60">
          <CardHeader><CardTitle className="text-base">Chart of Accounts ({accounts.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {Object.keys(grouped).length === 0 ? <p className="text-sm text-muted-foreground">No accounts. Use Settings to seed defaults.</p> : null}
            {Object.entries(grouped).map(([type, accs]) => (
              <div key={type}>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">{TYPE_LABELS[type] ?? type}</p>
                <div className="space-y-1">
                  {accs.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-accent/30">
                      <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                      <span className="flex-1 ml-2">{a.name}</span>
                      {!a.isPosting && <Badge variant="outline" className="text-[9px] ml-2">header</Badge>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader><CardTitle className="text-base">Recent Journal Entries ({entries.length})</CardTitle></CardHeader>
          <CardContent>
            {entries.length === 0 ? <p className="text-sm text-muted-foreground">No journal entries posted yet.</p> : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {entries.map((je: any) => (
                  <div key={je.id} className="border rounded-lg p-2 text-xs">
                    <div className="flex justify-between items-start">
                      <code className="font-mono text-muted-foreground">{je.reference}</code>
                      <Badge variant={je.status === 'reversed' ? 'destructive' : 'outline'} className="text-[9px]">{je.status}</Badge>
                    </div>
                    <p className="font-medium mt-1">{je.description}</p>
                    <p className="text-muted-foreground">{new Date(je.transactionDate).toLocaleDateString('en-GB')} · {je.source}</p>
                    <div className="mt-1 space-y-0.5">
                      {je.ledgerEntries?.map((le: any, i: number) => (
                        <div key={i} className="flex justify-between">
                          <span className="font-mono text-[10px]">{le.account.code} {le.account.name}</span>
                          <span className="font-mono">{le.debit > 0 ? `Dr ${CURRENCY_FMT(le.debit)}` : `Cr ${CURRENCY_FMT(le.credit)}`}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {postOpen && <PostJournalDialog open={postOpen} onOpenChange={setPostOpen} accounts={accounts} />}
    </>
  )
}

function PostJournalDialog({ open, onOpenChange, accounts }: { open: boolean; onOpenChange: (o: boolean) => void; accounts: any[] }) {
  const queryClient = useQueryClient()
  const [description, setDescription] = useState('')
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<Array<{ accountCode: string; debit: number; credit: number }>>([
    { accountCode: '1010', debit: 0, credit: 0 },
    { accountCode: '4000', debit: 0, credit: 0 },
  ])
  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0
  const post = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/finance/journal-entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, transactionDate, source: 'manual', lines }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed') }
      return res.json()
    },
    onSuccess: () => { toast.success('Journal entry posted'); queryClient.invalidateQueries({ queryKey: ['finance', 'journal-entries'] }); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Post Journal Entry</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Description</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Sunday collection deposit" /></div>
          <div><Label>Transaction Date</Label><Input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} /></div>
          <div className="space-y-2">
            <Label>Lines (debits must equal credits)</Label>
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Select value={l.accountCode} onValueChange={v => setLines(prev => prev.map((x, j) => j === i ? { ...x, accountCode: v } : x))}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{accounts.filter(a => a.isPosting).map(a => <SelectItem key={a.id} value={a.code}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="Debit" className="w-28" value={l.debit || ''} onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, debit: Number(e.target.value) || 0, credit: 0 } : x))} />
                <Input type="number" placeholder="Credit" className="w-28" value={l.credit || ''} onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, credit: Number(e.target.value) || 0, debit: 0 } : x))} />
                {lines.length > 2 && <Button variant="ghost" size="icon" onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}><X className="size-4" /></Button>}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines(prev => [...prev, { accountCode: '1010', debit: 0, credit: 0 }])}><Plus className="size-3.5" /> Add Line</Button>
          </div>
          <div className="flex items-center justify-between text-sm font-medium pt-2 border-t">
            <span>Total Debit: {CURRENCY_FMT(totalDebit)}</span>
            <span>Total Credit: {CURRENCY_FMT(totalCredit)}</span>
            <Badge variant={isBalanced ? 'default' : 'destructive'}>{isBalanced ? '✓ Balanced' : '✗ Not balanced'}</Badge>
          </div>
        </div>
        <DialogFooter><Button disabled={!isBalanced || !description} onClick={() => post.mutate()}>Post Entry</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Cash & Bank tab ----------
function BankTab() {
  const [createOpen, setCreateOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['finance', 'bank-accounts'],
    queryFn: async () => { const res = await fetch('/api/finance/bank-accounts'); if (!res.ok) throw new Error('Failed'); return res.json() },
  })
  const { data: reconData } = useQuery({
    queryKey: ['finance', 'bank-reconciliations'],
    queryFn: async () => { const res = await fetch('/api/finance/bank-reconciliations'); if (!res.ok) throw new Error('Failed'); return res.json() },
  })
  const accounts = data?.accounts ?? []
  const reconciliations = reconData?.reconciliations ?? []
  return (
    <>
      <PageHeader title="Cash & Bank Management" eyebrow="Finance" description="Bank accounts, cash accounts, and reconciliation tracking." icon={Landmark}
        action={<Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="size-4" /> Add Account</Button>} />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="border-border/60">
          <CardHeader><CardTitle className="text-base">Accounts ({accounts.length})</CardTitle></CardHeader>
          <CardContent>{accounts.length === 0 ? <p className="text-sm text-muted-foreground">No bank accounts yet.</p> : (
            <div className="space-y-2">
              {accounts.map((a: any) => (
                <div key={a.id} className="border rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div><p className="font-medium text-sm">{a.accountName}</p><p className="text-xs text-muted-foreground">{a.bankName} · {a.accountType}</p></div>
                    <Badge variant={a.status === 'active' ? 'default' : 'secondary'} className="text-[9px]">{a.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{a.accountNumber ?? '—'}</p>
                  <p className="text-sm font-semibold mt-1">{CURRENCY_FMT(a.currentBalance, a.currency)}</p>
                </div>
              ))}
            </div>
          )}</CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader><CardTitle className="text-base">Reconciliations ({reconciliations.length})</CardTitle></CardHeader>
          <CardContent>{reconciliations.length === 0 ? <p className="text-sm text-muted-foreground">No reconciliations yet.</p> : (
            <div className="space-y-2">
              {reconciliations.map((r: any) => (
                <div key={r.id} className="border rounded-lg p-3 text-xs">
                  <div className="flex justify-between"><span className="font-medium">{r.bankAccount?.accountName}</span><StatusPill status={r.status} /></div>
                  <p className="text-muted-foreground">{new Date(r.periodStart).toLocaleDateString()} → {new Date(r.periodEnd).toLocaleDateString()}</p>
                  <div className="flex justify-between mt-1">
                    <span>Statement: {CURRENCY_FMT(r.statementClosingBalance)}</span>
                    <span>Book: {CURRENCY_FMT(r.bookClosingBalance)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}</CardContent>
        </Card>
      </div>
      {createOpen && <CreateBankAccountDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  )
}

function CreateBankAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ accountName: '', bankName: '', accountNumber: '', accountType: 'operating', openingBalance: 0 })
  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/finance/bank-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed') }
      return res.json()
    },
    onSuccess: () => { toast.success('Bank account created'); queryClient.invalidateQueries({ queryKey: ['finance', 'bank-accounts'] }); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
      <DialogHeader><DialogTitle>Add Bank Account</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Account Name</Label><Input value={form.accountName} onChange={e => setForm(f => ({ ...f, accountName: e.target.value }))} /></div>
        <div><Label>Bank Name</Label><Input value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} /></div>
        <div><Label>Account Number</Label><Input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Type</Label>
            <Select value={form.accountType} onValueChange={v => setForm(f => ({ ...f, accountType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operating">Operating</SelectItem>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="payment_gateway_clearing">Gateway Clearing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Opening Balance (₦)</Label><Input type="number" value={form.openingBalance || ''} onChange={e => setForm(f => ({ ...f, openingBalance: Number(e.target.value) }))} /></div>
        </div>
      </div>
      <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.accountName}>Create</Button></DialogFooter>
    </DialogContent></Dialog>
  )
}

// ---------- Reports tab ----------
function ReportsTab() {
  const REPORTS = [
    { key: 'trial-balance', name: 'Trial Balance', icon: Scale, desc: 'All accounts with debit/credit balances. Must balance.' },
    { key: 'income-expenditure', name: 'Income & Expenditure', icon: TrendingUp, desc: 'Income statement for the period.' },
    { key: 'statement-of-position', name: 'Statement of Position', icon: BookOpen, desc: 'Balance sheet: assets = liabilities + funds.' },
    { key: 'fund-activity', name: 'Fund Activity', icon: PiggyBank, desc: 'Contributions + expenditure per fund.' },
    { key: 'budget-vs-actual', name: 'Budget vs Actual', icon: BarChart3, desc: 'Approved budget vs actual income/expenditure.' },
    { key: 'collection-summary', name: 'Collection Summary', icon: Coins, desc: 'Daily collection sessions summary.' },
    { key: 'expense-register', name: 'Expense Register', icon: FileText, desc: 'All expense requests with statuses.' },
    { key: 'member-giving-statement', name: 'Member Giving Statement', icon: User, desc: 'Individual member giving history.' },
  ]
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <>
      <PageHeader title="Financial Reports" eyebrow="Finance" description="Accounting reports generated from posted ledger entries." icon={BarChart3} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {REPORTS.map(r => (
          <Card key={r.key} className="border-border/60 hover:border-primary/40 cursor-pointer transition-colors" onClick={() => setSelected(r.key)}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-lg bg-primary/10 grid place-items-center shrink-0"><r.icon className="size-5 text-primary" /></div>
                <div className="min-w-0"><p className="font-medium text-sm">{r.name}</p><p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {selected && <ReportDialog reportKey={selected} open={!!selected} onOpenChange={(o) => !o && setSelected(null)} />}
    </>
  )
}

function ReportDialog({ reportKey, open, onOpenChange }: { reportKey: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10))
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'report', reportKey, fromDate, toDate],
    queryFn: async () => {
      const qs = reportKey === 'statement-of-position' ? `?asAt=${toDate}`
        : reportKey === 'budget-vs-actual' ? `?fiscalYear=${new Date(fromDate).getFullYear()}`
        : `?fromDate=${fromDate}&toDate=${toDate}`
      const res = await fetch(`/api/finance/reports/${reportKey}${qs}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: open,
  })
  const exportCsv = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${reportKey}-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported')
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">{reportKey.replace(/-/g, ' ')}</DialogTitle>
          <DialogDescription>Generated from posted ledger entries.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40" />
          <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-40" />
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5"><Download className="size-3.5" /> Export</Button>
        </div>
        {isLoading ? <Skeleton className="h-48" /> : data ? (
          <pre className="text-xs bg-muted/40 rounded-lg p-3 overflow-x-auto max-h-[400px]">{JSON.stringify(data, null, 2)}</pre>
        ) : <p className="text-sm text-muted-foreground">No data.</p>}
      </DialogContent>
    </Dialog>
  )
}

// ---------- Member Giving tab (member self-service) ----------
function MemberGivingTab() {
  const { user, memberId } = useAuth() as any
  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10))
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10))
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'my-giving', fromDate, toDate],
    queryFn: async () => {
      if (!memberId) return null
      const res = await fetch(`/api/finance/reports/member-giving-statement?memberId=${memberId}&fromDate=${fromDate}&toDate=${toDate}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!memberId,
  })
  if (!memberId) return <EmptyState icon={User} title="No member profile" description="Your account isn't linked to a member record. Contact your church administrator." />
  return (
    <>
      <PageHeader title="My Giving History" eyebrow="Finance" description="Your verified tithe + donation history. Private to you." icon={User} />
      <div className="flex items-center gap-2 mb-3">
        <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40" />
        <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-40" />
      </div>
      {isLoading ? <TableSkeleton /> : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total Tithes" value={CURRENCY_FMT(data.totalTithes)} icon={HandCoins} />
            <StatCard label="Total Donations" value={CURRENCY_FMT(data.totalDonations)} icon={ArrowDownCircle} />
            <StatCard label="Grand Total" value={CURRENCY_FMT(data.grandTotal)} icon={Wallet} />
          </div>
          <Card className="border-border/60">
            <CardHeader><CardTitle className="text-base">Tithes ({data.tithes.length})</CardTitle></CardHeader>
            <CardContent>{data.tithes.length === 0 ? <p className="text-sm text-muted-foreground">No tithes in this period.</p> : (
              <div className="space-y-1">{data.tithes.map((t: any) => (
                <div key={t.id} className="flex justify-between text-sm py-1 border-b border-border/40 last:border-0">
                  <span>{new Date(t.titheMonth).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} · {t.method}</span>
                  <span className="font-medium">{CURRENCY_FMT(t.amount, t.currency)} <StatusPill status={t.status} /></span>
                </div>
              ))}</div>
            )}</CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader><CardTitle className="text-base">Donations ({data.donations.length})</CardTitle></CardHeader>
            <CardContent>{data.donations.length === 0 ? <p className="text-sm text-muted-foreground">No donations in this period.</p> : (
              <div className="space-y-1">{data.donations.map((d: any) => (
                <div key={d.id} className="flex justify-between text-sm py-1 border-b border-border/40 last:border-0">
                  <span>{new Date(d.donatedAt).toLocaleDateString('en-GB')} · {d.fund?.name ?? 'General'}</span>
                  <span className="font-medium">{CURRENCY_FMT(d.amount, d.currency)} <StatusPill status={d.status} /></span>
                </div>
              ))}</div>
            )}</CardContent>
          </Card>
        </div>
      ) : null}
    </>
  )
}

// ---------- Finance Settings tab ----------
function FinanceSettingsTab() {
  const queryClient = useQueryClient()
  const seedCoa = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/finance/seed-coa', { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed') }
      return res.json()
    },
    onSuccess: (data) => { toast.success(`Chart of accounts seeded (${data.accountsCreated} accounts)`); queryClient.invalidateQueries({ queryKey: ['finance', 'chart-of-accounts'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <>
      <PageHeader title="Finance Settings" eyebrow="Finance" description="Configure the chart of accounts, bank accounts, and accounting periods." icon={Settings} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-lg bg-primary/10 grid place-items-center"><BookOpen className="size-5 text-primary" /></div>
              <div className="flex-1">
                <p className="font-medium text-sm">Chart of Accounts</p>
                <p className="text-xs text-muted-foreground mt-0.5">Seed the default Nigerian church chart of accounts (33 accounts: assets, liabilities, funds, income, expenditure).</p>
                <Button size="sm" className="mt-2 gap-1.5" onClick={() => seedCoa.mutate()} disabled={seedCoa.isPending}><Plus className="size-3.5" /> Seed Defaults</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-lg bg-primary/10 grid place-items-center"><Landmark className="size-5 text-primary" /></div>
              <div className="flex-1">
                <p className="font-medium text-sm">Bank Accounts</p>
                <p className="text-xs text-muted-foreground mt-0.5">Add operating, project, cash, and gateway-clearing accounts in the Cash & Bank tab.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
