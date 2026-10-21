'use client'

// ChurchOS — Reports & Analytics module (Module 14)
// Permission-aware report cards with charts, summary tables, and CSV export.
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import {
  formatCurrency, formatDate, titleCase,
} from '@/lib/format'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  BarChart3, Users, CalendarCheck, Wallet, UserPlus, Network,
  Download, Filter, X, RefreshCw, AlertTriangle, FileSpreadsheet, Lock,
  TrendingUp, TrendingDown,
} from 'lucide-react'
import {
  Bar, BarChart, Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from 'recharts'
import {
  PageHeader, EmptyState, Toolbar, SectionCard, TableSkeleton,
} from '@/components/churchos/ui'

// ---------- types ----------
interface MembershipReport {
  type: 'membership'
  total: number
  byStatus: { status: string; count: number }[]
  byBranch: { branchId: string | null; branchName: string; count: number }[]
  byGender: { gender: string; count: number }[]
  newByMonth: { key: string; label: string; count: number }[]
  canViewMembers: boolean
}
interface AttendanceReport {
  type: 'attendance'
  totalSessions: number
  totalRecords: number
  avgPerSession: number
  byService: { serviceId: string; serviceName: string; sessions: number; records: number }[]
  trend: { key: string; label: string; count: number }[]
  topAttenders: { id: string; name: string; count: number }[]
  canViewMembers: boolean
}
interface FinanceReport {
  type: 'finance'
  totals: { income: number; incomeCount: number; expense: number; expenseCount: number; net: number }
  monthlyTrend: { key: string; label: string; income: number; expense: number; net: number }[]
  byFund: { fundId: string | null; fundName: string; fundCode: string | null; income: number; incomeCount: number; expense: number; expenseCount: number; net: number }[]
  byCategory: { category: string; amount: number }[]
  topDonors: { name: string; total: number; count: number }[]
  canViewDonorNames: boolean
}
interface DepartmentsReport {
  type: 'departments'
  total: number
  items: { id: string; name: string; head: string | null; members: number; tasks: number; events: number; units: number }[]
}
interface VisitorsReport {
  type: 'visitors'
  total: number
  converted: number
  conversionRate: number
  byReferral: { source: string; count: number }[]
  followUps: { status: string; count: number }[]
}
type AnyReport = MembershipReport | AttendanceReport | FinanceReport | DepartmentsReport | VisitorsReport

// ---------- main module ----------
export default function ReportsModule() {
  const { user } = useAuth()
  const role = user?.role ?? 'member'
  const canViewReports = can(role, 'reports', 'view')
  const canViewFinance = can(role, 'finance', 'view') && role !== 'member'
  const canExport = can(role, 'reports', 'export')

  const [openReport, setOpenReport] = useState<string | null>(null)

  if (!canViewReports) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Insights"
          title="Reports &amp; Analytics"
          description="Permission-aware — exports use the same access filters as the UI."
          icon={BarChart3}
        />
        <Card className="border-destructive/40">
          <CardContent className="p-8 text-center">
            <Lock className="size-10 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium">Reports are restricted.</p>
            <p className="text-xs text-muted-foreground mt-1">Your role does not have access to reports &amp; analytics.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const REPORTS = [
    { id: 'membership', title: 'Membership Report', icon: Users, desc: 'Member counts by status, branch, gender and growth over time.', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-indigo-500/15', available: can(role, 'members', 'view') },
    { id: 'attendance', title: 'Attendance Report', icon: CalendarCheck, desc: 'Per-service totals, trends and top attenders.', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/15', available: can(role, 'attendance', 'view') },
    { id: 'finance', title: 'Finance Report', icon: Wallet, desc: 'Income vs expense by month and fund, top donors.', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/15', available: canViewFinance },
    { id: 'visitors', title: 'Visitor Follow-up', icon: UserPlus, desc: 'Visitor counts, conversion rate and follow-up status.', color: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-violet-500/15', available: can(role, 'visitors', 'view') },
    { id: 'departments', title: 'Department Participation', icon: Network, desc: 'Members, tasks, events and units per department.', color: 'bg-primary/10 text-primary ring-primary/15', available: can(role, 'departments', 'view') },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="Reports &amp; Analytics"
        description="Permission-aware — exports use the same access filters as the UI."
        icon={BarChart3}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {REPORTS.map((r) => {
          const Icon = r.icon
          if (!r.available) {
            return (
              <Card key={r.id} className="border-border/60 opacity-60 rounded-xl">
                <CardContent className="p-5">
                  <div className={`size-10 rounded-lg grid place-items-center mb-3 ring-1 ring-inset ${r.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <p className="text-sm font-semibold mb-1">{r.title}</p>
                  <p className="text-xs text-muted-foreground mb-3">{r.desc}</p>
                  <Badge variant="outline" className="text-[10px] font-medium">
                    <Lock className="size-3 mr-1" /> Restricted
                  </Badge>
                </CardContent>
              </Card>
            )
          }
          return (
            <Card key={r.id} className="border-border/60 rounded-xl hover:shadow-premium-md hover:-translate-y-0.5 transition-all">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`size-10 rounded-lg grid place-items-center ring-1 ring-inset ${r.color}`}>
                    <Icon className="size-5" />
                  </div>
                  {canExport && (
                    <Badge variant="outline" className="text-[10px] font-medium">CSV export</Badge>
                  )}
                </div>
                <p className="text-sm font-semibold mb-1">{r.title}</p>
                <p className="text-xs text-muted-foreground mb-4">{r.desc}</p>
                <Button size="sm" variant="outline" onClick={() => setOpenReport(r.id)} className="w-full gap-2">
                  <BarChart3 className="size-3.5" /> Open report
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="border-border/60 bg-muted/20">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Permission-aware:</strong> Reports &amp; exports use the same access filters as the underlying modules. Finance data is only shown to roles with the <code className="px-1 py-0.5 bg-muted rounded">finance:view</code> permission.
          </p>
        </CardContent>
      </Card>

      {openReport && (
        <ReportDialog
          type={openReport as AnyReport['type']}
          open={!!openReport}
          onOpenChange={(o) => { if (!o) setOpenReport(null) }}
          canExport={canExport}
        />
      )}
    </div>
  )
}

// ---------- shared filters ----------
function ReportFilters({
  from, to, setFrom, setTo, onReset,
}: {
  from: string; to: string
  setFrom: (v: string) => void; setTo: (v: string) => void
  onReset: () => void
}) {
  return (
    <Toolbar className="mb-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="rep-from" className="text-xs text-muted-foreground">From</Label>
        <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 h-9" />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="rep-to" className="text-xs text-muted-foreground">To</Label>
        <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 h-9" />
      </div>
      <Button variant="ghost" size="sm" onClick={onReset} className="h-9 gap-2">
        <RefreshCw className="size-3.5" /> Reset
      </Button>
    </Toolbar>
  )
}

// ---------- report dialog container ----------
function ReportDialog({
  type, open, onOpenChange, canExport,
}: {
  type: AnyReport['type']
  open: boolean
  onOpenChange: (o: boolean) => void
  canExport: boolean
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const params = useMemo(() => {
    const p = new URLSearchParams({ type })
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    return p.toString()
  }, [type, from, to])

  const { data, isLoading, isError, refetch } = useQuery<AnyReport>({
    queryKey: ['reports', type, from, to],
    queryFn: async () => {
      const res = await fetch(`/api/reports?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load report')
      }
      return res.json()
    },
    enabled: open,
  })

  const titles: Record<string, string> = {
    membership: 'Membership Report',
    attendance: 'Attendance Report',
    finance: 'Finance Report',
    visitors: 'Visitor Follow-up Report',
    departments: 'Department Participation Report',
  }

  const exportCsv = () => {
    try {
      if (!data) return
      toast.loading('Generating CSV…', { id: 'rep-export' })
      let header: string[] = []
      let rows: (string | number)[][] = []
      let filename = type
      if (data.type === 'membership') {
        header = ['Status', 'Count']
        rows = data.byStatus.map((s) => [s.status, s.count])
        filename = `membership-by-status`
      } else if (data.type === 'attendance') {
        header = ['Service', 'Sessions']
        rows = data.byService.map((s) => [s.serviceName, s.sessions])
        filename = `attendance-by-service`
      } else if (data.type === 'finance') {
        header = ['Fund', 'Income', 'Expense', 'Net']
        rows = data.byFund.map((f) => [f.fundName, f.income, f.expense, f.net])
        filename = `finance-by-fund`
      } else if (data.type === 'departments') {
        header = ['Department', 'Head', 'Members', 'Tasks', 'Events', 'Units']
        rows = data.items.map((d) => [d.name, d.head ?? '', d.members, d.tasks, d.events, d.units])
        filename = `departments`
      } else if (data.type === 'visitors') {
        header = ['Source', 'Visitors']
        rows = data.byReferral.map((r) => [r.source, r.count])
        filename = `visitors-by-source`
      }
      const csv = [header, ...rows]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${rows.length} rows`, { id: 'rep-export' })
    } catch {
      toast.error('Export failed', { id: 'rep-export' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl lg:max-w-[1000px] max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>{titles[type] ?? 'Report'}</DialogTitle>
          <DialogDescription>Filtered by date range. CSV export uses the same access scope.</DialogDescription>
        </DialogHeader>

        <ReportFilters
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          onReset={() => { setFrom(''); setTo('') }}
        />

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertTriangle}
            title="Failed to load report"
            description="Please try again or adjust your filters."
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            }
          />
        ) : !data ? (
          <p className="text-sm text-muted-foreground text-center py-6">No data.</p>
        ) : data.type === 'membership' ? (
          <MembershipReportView data={data} />
        ) : data.type === 'attendance' ? (
          <AttendanceReportView data={data} />
        ) : data.type === 'finance' ? (
          <FinanceReportView data={data} />
        ) : data.type === 'visitors' ? (
          <VisitorsReportView data={data} />
        ) : data.type === 'departments' ? (
          <DepartmentsReportView data={data} />
        ) : null}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          {canExport && data && (
            <Button onClick={exportCsv} variant="outline" className="gap-2">
              <Download className="size-3.5" /> Export CSV
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- membership report ----------
function MembershipReportView({ data }: { data: MembershipReport }) {
  const STATUS_COLORS: Record<string, string> = {
    active: 'var(--chart-1)',
    visitor: 'var(--chart-2)',
    new_convert: 'var(--chart-3)',
    follow_up: 'var(--chart-4)',
    inactive: 'var(--muted-foreground)',
    transferred: 'var(--chart-5)',
    deceased: 'var(--destructive)',
  }
  const chartData = data.byStatus.map((s) => ({
    name: titleCase(s.status),
    count: s.count,
    fill: STATUS_COLORS[s.status] ?? 'var(--primary)',
  }))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Total members" value={data.total.toString()} />
        <StatBox label="Active" value={data.byStatus.find((s) => s.status === 'active')?.count.toString() ?? '0'} accent="text-emerald-600" />
        <StatBox label="Visitors" value={data.byStatus.find((s) => s.status === 'visitor')?.count.toString() ?? '0'} accent="text-indigo-600" />
        <StatBox label="Follow-up" value={data.byStatus.find((s) => s.status === 'follow_up')?.count.toString() ?? '0'} accent="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Members by status">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={90} />
              <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="New members — last 12 months">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.newByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={28} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="By branch">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Branch</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byBranch.map((b) => (
                <TableRow key={b.branchId ?? 'none'} className="hover:bg-muted/40 border-border/60">
                  <TableCell className="text-xs">{b.branchName}</TableCell>
                  <TableCell className="text-right text-xs font-semibold nums">{b.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
        <SectionCard title="By gender">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Gender</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byGender.map((g) => (
                <TableRow key={g.gender} className="hover:bg-muted/40 border-border/60">
                  <TableCell className="text-xs capitalize">{g.gender}</TableCell>
                  <TableCell className="text-right text-xs font-semibold nums">{g.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </div>
  )
}

// ---------- attendance report ----------
function AttendanceReportView({ data }: { data: AttendanceReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Total sessions" value={data.totalSessions.toString()} />
        <StatBox label="Total attendance" value={data.totalRecords.toLocaleString()} />
        <StatBox label="Avg / session" value={data.avgPerSession.toString()} accent="text-primary" />
        <StatBox label="Services tracked" value={data.byService.length.toString()} />
      </div>

      <SectionCard title="Attendance trend" description="Total attendance records per month.">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.trend}>
            <defs>
              <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={32} />
            <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="count" stroke="var(--chart-1)" strokeWidth={2} fill="url(#attGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="By service">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Service</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Sessions</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Records</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byService.map((s) => (
                <TableRow key={s.serviceId} className="hover:bg-muted/40 border-border/60">
                  <TableCell className="text-xs">{s.serviceName}</TableCell>
                  <TableCell className="text-right text-xs font-semibold nums">{s.sessions}</TableCell>
                  <TableCell className="text-right text-xs font-semibold nums">{s.records}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
        <SectionCard title="Top attenders" description={data.canViewMembers ? 'Based on confirmed check-ins.' : 'Member names hidden — requires members:view.'}>
          {!data.canViewMembers ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              <Lock className="size-4 mx-auto mb-2" /> No permission to view member names.
            </p>
          ) : data.topAttenders.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No attendance records.</p>
          ) : (
            <ol className="space-y-2">
              {data.topAttenders.map((a, i) => (
                <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="size-5 rounded bg-primary/10 text-primary text-[10px] font-bold grid place-items-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="truncate">{a.name}</span>
                  </div>
                  <span className="font-semibold text-xs nums">{a.count} sessions</span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

// ---------- finance report ----------
function FinanceReportView({ data }: { data: FinanceReport }) {
  const { organization } = useAuth()
  const currency = organization?.currency
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox
          label="Total income"
          value={formatCurrency(data.totals.income, currency)}
          sub={`${data.totals.incomeCount} donations`}
          accent="text-emerald-600"
          icon={TrendingUp}
        />
        <StatBox
          label="Total expenses"
          value={formatCurrency(data.totals.expense, currency)}
          sub={`${data.totals.expenseCount} expenses`}
          accent="text-rose-600"
          icon={TrendingDown}
        />
        <StatBox
          label="Net"
          value={formatCurrency(data.totals.net, currency)}
          sub={data.totals.net >= 0 ? 'Surplus' : 'Deficit'}
          accent={data.totals.net >= 0 ? 'text-primary' : 'text-amber-600'}
        />
        <StatBox label="Funds tracked" value={data.byFund.length.toString()} />
      </div>

      <SectionCard title="Income vs expense — monthly trend">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.monthlyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={48} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              formatter={(value: number, name: string) => [formatCurrency(value, currency), name === 'income' ? 'Income' : 'Expenses']}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="income" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="By fund">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Fund</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Income</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Expense</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byFund.map((f) => (
                <TableRow key={f.fundId ?? 'none'} className="hover:bg-muted/40 border-border/60">
                  <TableCell className="text-xs">
                    {f.fundName}
                    {f.fundCode && <span className="ml-1.5 text-[10px] text-muted-foreground">({f.fundCode})</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs nums text-emerald-600">{formatCurrency(f.income, currency)}</TableCell>
                  <TableCell className="text-right text-xs nums text-rose-600">{formatCurrency(f.expense, currency)}</TableCell>
                  <TableCell className={`text-right text-xs nums font-semibold ${f.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatCurrency(f.net, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard title="Top donors" description={data.canViewDonorNames ? 'Real donor names shown — finance access verified.' : 'Anonymized — no finance access.'}>
          {data.topDonors.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No donations in the selected period.</p>
          ) : (
            <ol className="space-y-2">
              {data.topDonors.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="size-5 rounded bg-primary/10 text-primary text-[10px] font-bold grid place-items-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="truncate">{data.canViewDonorNames ? d.name : 'Donor'}</span>
                  </div>
                  <span className="font-semibold nums">{formatCurrency(d.total, currency)}</span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Expenses by category">
        {data.byCategory.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No expenses in the selected period.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.byCategory.map((c) => (
              <div key={c.category} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground truncate">{c.category}</p>
                <p className="text-sm font-semibold nums text-rose-600">{formatCurrency(c.amount, currency)}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ---------- visitors report ----------
function VisitorsReportView({ data }: { data: VisitorsReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Total visitors" value={data.total.toString()} />
        <StatBox label="Converted" value={data.converted.toString()} accent="text-emerald-600" />
        <StatBox label="Conversion rate" value={`${data.conversionRate}%`} accent="text-primary" />
        <StatBox label="Referral sources" value={data.byReferral.length.toString()} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="By referral source">
          {data.byReferral.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No data.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Source</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Visitors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byReferral.map((r) => (
                  <TableRow key={r.source} className="hover:bg-muted/40 border-border/60">
                    <TableCell className="text-xs">{r.source}</TableCell>
                    <TableCell className="text-right text-xs font-semibold nums">{r.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
        <SectionCard title="Follow-up status">
          {data.followUps.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No follow-up tasks.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Tasks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.followUps.map((f) => (
                  <TableRow key={f.status} className="hover:bg-muted/40 border-border/60">
                    <TableCell className="text-xs">{titleCase(f.status)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold nums">{f.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

// ---------- departments report ----------
function DepartmentsReportView({ data }: { data: DepartmentsReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Departments" value={data.total.toString()} />
        <StatBox label="Total members" value={data.items.reduce((s, d) => s + d.members, 0).toString()} />
        <StatBox label="Total tasks" value={data.items.reduce((s, d) => s + d.tasks, 0).toString()} />
        <StatBox label="Total events" value={data.items.reduce((s, d) => s + d.events, 0).toString()} />
      </div>

      <Card className="border-border/60">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">Department</TableHead>
                <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Head</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Members</TableHead>
                <TableHead className="text-right hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Tasks</TableHead>
                <TableHead className="text-right hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Events</TableHead>
                <TableHead className="text-right pr-4 hidden lg:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Units</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((d) => (
                <TableRow key={d.id} className="hover:bg-muted/40 border-border/60">
                  <TableCell className="pl-4 text-xs font-medium">{d.name}</TableCell>
                  <TableCell className="hidden sm:table-cell text-xs">{d.head ?? '—'}</TableCell>
                  <TableCell className="text-right text-xs font-semibold nums">{d.members}</TableCell>
                  <TableCell className="text-right text-xs hidden md:table-cell nums">{d.tasks}</TableCell>
                  <TableCell className="text-right text-xs hidden md:table-cell nums">{d.events}</TableCell>
                  <TableCell className="text-right pr-4 text-xs hidden lg:table-cell nums">{d.units}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- shared stat ----------
function StatBox({
  label, value, sub, accent, icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
  icon?: typeof Users
}) {
  return (
    <Card className="border-border/60 rounded-xl">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
          {Icon && <Icon className={`size-3.5 ${accent ?? 'text-muted-foreground'}`} />}
        </div>
        <p className={`text-lg font-bold leading-tight mt-1 nums ${accent ?? ''}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}
