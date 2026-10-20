'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  BarChart, Bar, Cell,
} from 'recharts'
import {
  Users, UserPlus, CalendarCheck, Wallet, ListChecks, ShieldAlert,
  TrendingUp, CalendarDays, Megaphone, ArrowRight, Church, Sparkles,
} from 'lucide-react'
import { formatCurrency, formatDateTime, initials, titleCase, relativeTime } from '@/lib/format'
import { NAV_ITEMS } from '@/lib/nav'

interface DashboardData {
  role: string
  metrics: {
    totalMembers: number; activeMembers: number; newVisitors: number; newConverts: number
    followUpCount: number; newMembersThisMonth: number; totalAttendance: number
    totalVisitors: number; pendingFollowUps: number; pendingTasks: number; pendingApprovals: number
  }
  attendanceTrend: { date: string; label: string; service: string; count: number }[]
  upcomingEvents: any[]
  departmentActivity: { id: string; name: string; color: string; members: number; tasks: number; events: number }[]
  financeSummary: { incomeThisMonth: number; expensesThisMonth: number; pendingApprovals: number; funds: { id: string; name: string; balance: number; code: string }[] } | null
  announcements: any[]
}

function StatCard({ icon: Icon, label, value, sub, accent, onClick }: {
  icon: typeof Users; label: string; value: string | number; sub?: string
  accent?: string; onClick?: () => void
}) {
  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold mt-1.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`size-10 rounded-lg grid place-items-center shrink-0 ${accent ?? 'bg-primary/10 text-primary'}`}>
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardModule() {
  const { user, organization, setModule } = useAuth()
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard')
      if (!res.ok) throw new Error('Failed to load dashboard')
      return res.json()
    },
  })

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name.split(' ')[0] ?? 'there'
  const showFinance = !!data.financeSummary
  const maxDeptMembers = Math.max(...data.departmentActivity.map((d) => d.members), 1)

  return (
    <div className="space-y-6">
      {/* Hero greeting */}
      <Card className="bg-church-gradient overflow-hidden">
        <CardContent className="p-6 lg:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="size-4 text-primary" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titleCase(user?.role ?? '')} Dashboard</span>
              </div>
              <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">
                {greeting}, {firstName} 👋
              </h2>
              <p className="text-muted-foreground mt-1">
                Here&apos;s what&apos;s happening at {organization?.name} today.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-card/60 backdrop-blur border border-border/60 px-4 py-3">
              <div className="size-10 rounded-lg bg-primary text-primary-foreground grid place-items-center">
                <Church className="size-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Today</p>
                <p className="text-sm font-semibold">
                  {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Members" value={data.metrics.totalMembers.toLocaleString()} sub={`${data.metrics.activeMembers} active`} onClick={() => setModule('members')} />
        <StatCard icon={UserPlus} label="Visitors" value={data.metrics.totalVisitors} sub={`${data.metrics.followUpCount} in follow-up`} accent="bg-chart-2/10 text-chart-2" onClick={() => setModule('visitors')} />
        <StatCard icon={CalendarCheck} label="Attendance (all-time)" value={data.metrics.totalAttendance.toLocaleString()} sub={`${data.attendanceTrend.at(-1)?.count ?? 0} last service`} accent="bg-emerald-500/10 text-emerald-600" onClick={() => setModule('attendance')} />
        {showFinance ? (
          <StatCard icon={Wallet} label="Income (Month)" value={formatCurrency(data.financeSummary!.incomeThisMonth, organization?.currency)} sub={`${data.financeSummary!.pendingApprovals} pending approvals`} accent="bg-amber-500/10 text-amber-600" onClick={() => setModule('finance')} />
        ) : (
          <StatCard icon={ListChecks} label="Open Tasks" value={data.metrics.pendingTasks} sub={`${data.metrics.pendingApprovals} approvals pending`} accent="bg-violet-500/10 text-violet-600" onClick={() => setModule('tasks')} />
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Attendance Trend</CardTitle>
              <CardDescription>Recent service attendance counts</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setModule('attendance')}>
              View <ArrowRight className="size-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.attendanceTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={28} />
                <Tooltip
                  cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
                  contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="count" name="Attendance" radius={[4, 4, 0, 0]}>
                  {data.attendanceTrend.map((entry, i) => (
                    <Cell key={i} fill={i % 2 === 0 ? '#0d9488' : '#14b8a6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Department Activity</CardTitle>
            <CardDescription>Member distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5 max-h-[260px] overflow-y-auto scroll-thin pr-1">
              {data.departmentActivity.map((d) => (
                <button key={d.id} onClick={() => setModule('departments')} className="w-full text-left group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{d.members}</span>
                  </div>
                  <Progress value={(d.members / maxDeptMembers) * 100} className="h-1.5" />
                </button>
              ))}
              {data.departmentActivity.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No departments yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lower row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Upcoming events */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Upcoming Events</CardTitle>
              <CardDescription>Next on the calendar</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setModule('events')}>
              Calendar <ArrowRight className="size-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            {data.upcomingEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No upcoming events</p>
            ) : (
              <div className="space-y-2">
                {data.upcomingEvents.map((e) => (
                  <button key={e.id} onClick={() => setModule('events')} className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:bg-accent/40 transition-colors text-left">
                    <div className="flex flex-col items-center justify-center size-12 rounded-lg bg-primary/8 text-primary shrink-0">
                      <span className="text-[10px] uppercase font-semibold">{new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(e.startDate))}</span>
                      <span className="text-lg font-bold leading-none">{new Date(e.startDate).getDate()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{e.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {formatDateTime(e.startDate)} {e.venue ? `· ${e.venue}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] capitalize shrink-0">{titleCase(e.eventType)}</Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Announcements */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Announcements</CardTitle>
            <Megaphone className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[260px] overflow-y-auto scroll-thin pr-1">
              {data.announcements.map((a) => (
                <div key={a.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {a.pinned && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">PINNED</Badge>}
                    <p className="text-sm font-medium leading-tight">{a.title}</p>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3">{a.body}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1.5">{relativeTime(a.publishedAt)}</p>
                </div>
              ))}
              {data.announcements.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No announcements</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Finance summary for finance roles */}
      {showFinance && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Finance Overview</CardTitle>
              <CardDescription>This month&apos;s summary by fund</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setModule('finance')}>
              Finance <ArrowRight className="size-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/15 p-3">
                <p className="text-[10px] uppercase font-semibold text-emerald-600">Income (Month)</p>
                <p className="text-lg font-bold mt-1">{formatCurrency(data.financeSummary!.incomeThisMonth, organization?.currency)}</p>
              </div>
              <div className="rounded-lg bg-chart-4/8 border border-chart-4/15 p-3">
                <p className="text-[10px] uppercase font-semibold text-chart-4">Expenses (Month)</p>
                <p className="text-lg font-bold mt-1">{formatCurrency(data.financeSummary!.expensesThisMonth, organization?.currency)}</p>
              </div>
              <div className="rounded-lg bg-amber-500/8 border border-amber-500/15 p-3">
                <p className="text-[10px] uppercase font-semibold text-amber-600">Pending Approvals</p>
                <p className="text-lg font-bold mt-1">{data.financeSummary!.pendingApprovals}</p>
              </div>
              <div className="rounded-lg bg-primary/8 border border-primary/15 p-3">
                <p className="text-[10px] uppercase font-semibold text-primary">Net (Month)</p>
                <p className="text-lg font-bold mt-1">{formatCurrency(data.financeSummary!.incomeThisMonth - data.financeSummary!.expensesThisMonth, organization?.currency)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {data.financeSummary!.funds.map((f) => (
                <div key={f.id} className="rounded-lg border border-border/60 p-3">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground">{f.code ?? f.name}</p>
                  <p className="text-base font-bold mt-0.5">{formatCurrency(f.balance, organization?.currency)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
