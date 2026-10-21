'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  BarChart, Bar, Cell, Area, AreaChart,
} from 'recharts'
import {
  Users, UserPlus, CalendarCheck, Wallet, ListChecks,
  CalendarDays, Megaphone, ArrowRight, Sparkles, TrendingUp,
  Church, CheckCircle2, Clock,
} from 'lucide-react'
import { formatCurrency, formatDateTime, relativeTime, titleCase } from '@/lib/format'
import { PageHeader, StatCard, SectionCard, EmptyState } from '@/components/churchos/ui'

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
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
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
      {/* Hero greeting card */}
      <Card className="border-border/60 overflow-hidden bg-brand-gradient">
        <CardContent className="p-6 lg:p-8 relative">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="size-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {titleCase(user?.role ?? '')} Dashboard
                </span>
              </div>
              <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">
                {greeting}, {firstName} 👋
              </h1>
              <p className="text-muted-foreground mt-1.5 text-sm lg:text-base">
                Here&apos;s what&apos;s happening at {organization?.name} today.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-card/70 backdrop-blur border border-border/60 px-4 py-3 shadow-premium shrink-0">
              <div className="size-10 rounded-lg bg-primary text-primary-foreground grid place-items-center">
                <Church className="size-5" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase font-medium">Today</p>
                <p className="text-sm font-semibold">
                  {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Members" value={data.metrics.totalMembers.toLocaleString()} sub={`${data.metrics.activeMembers} active`} onClick={() => setModule('members')} accent="primary" />
        <StatCard icon={UserPlus} label="Visitors" value={data.metrics.totalVisitors} sub={`${data.metrics.followUpCount} in follow-up`} accent="violet" onClick={() => setModule('visitors')} />
        <StatCard icon={CalendarCheck} label="Attendance" value={data.metrics.totalAttendance.toLocaleString()} sub={`${data.attendanceTrend.at(-1)?.count ?? 0} last service`} accent="teal" onClick={() => setModule('attendance')} />
        {showFinance ? (
          <StatCard icon={Wallet} label="Income (Month)" value={formatCurrency(data.financeSummary!.incomeThisMonth, organization?.currency)} sub={`${data.financeSummary!.pendingApprovals} approvals`} accent="emerald" onClick={() => setModule('finance')} />
        ) : (
          <StatCard icon={ListChecks} label="Open Tasks" value={data.metrics.pendingTasks} sub={`${data.metrics.pendingApprovals} approvals pending`} accent="amber" onClick={() => setModule('tasks')} />
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Attendance trend */}
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" /> Attendance Trend
              </CardTitle>
              <CardDescription className="mt-0.5">Recent service attendance counts</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setModule('attendance')} className="text-xs">
              View <ArrowRight className="size-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.attendanceTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={28} />
                <Tooltip
                  cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, boxShadow: '0 8px 24px -6px rgba(0,0,0,0.12)' }}
                />
                <Area type="monotone" dataKey="count" name="Attendance" stroke="#6366f1" strokeWidth={2.5} fill="url(#attGrad)" dot={{ r: 2.5, fill: '#6366f1', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#6366f1' }} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Department activity */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Department Activity</CardTitle>
            <CardDescription>Member distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[260px] overflow-y-auto scroll-thin pr-1">
              {data.departmentActivity.map((d) => (
                <button key={d.id} onClick={() => setModule('departments')} className="w-full text-left group">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="text-xs text-muted-foreground nums">{d.members}</span>
                  </div>
                  <Progress value={(d.members / maxDeptMembers) * 100} className="h-1.5" />
                </button>
              ))}
              {data.departmentActivity.length === 0 && (
                <EmptyState icon={Users} title="No departments yet" description="Create departments to organize your church." />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lower row: events + announcements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Upcoming Events</CardTitle>
              <CardDescription>Next on the calendar</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setModule('events')} className="text-xs">
              Calendar <ArrowRight className="size-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            {data.upcomingEvents.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No upcoming events" description="Scheduled events will appear here." />
            ) : (
              <div className="space-y-2">
                {data.upcomingEvents.map((e) => (
                  <button key={e.id} onClick={() => setModule('events')} className="w-full flex items-center gap-3 p-3 rounded-xl border border-border/60 hover:bg-accent/40 hover:border-border transition-all text-left group">
                    <div className="flex flex-col items-center justify-center size-12 rounded-lg bg-primary/8 text-primary shrink-0 ring-1 ring-inset ring-primary/10">
                      <span className="text-[10px] uppercase font-semibold">{new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(e.startDate))}</span>
                      <span className="text-lg font-bold leading-none nums">{new Date(e.startDate).getDate()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{e.title}</p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        <Clock className="size-3" />
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
        <Card className="border-border/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Megaphone className="size-4 text-muted-foreground" /> Announcements
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setModule('announcements')} className="text-xs h-7">All</Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[260px] overflow-y-auto scroll-thin pr-1">
              {data.announcements.map((a) => (
                <div key={a.id} className="rounded-xl border border-border/60 p-3.5 hover:shadow-premium transition-shadow">
                  <div className="flex items-center gap-2 mb-1.5">
                    {a.pinned && <Badge variant="secondary" className="text-[9px] h-4 px-1.5 gap-0.5">📌 PINNED</Badge>}
                    <p className="text-sm font-medium leading-tight">{a.title}</p>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3">{a.body}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-2">{relativeTime(a.publishedAt)}</p>
                </div>
              ))}
              {data.announcements.length === 0 && (
                <EmptyState icon={Megaphone} title="No announcements" description="Published announcements appear here." />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Finance summary — role gated */}
      {showFinance && (
        <Card className="border-border/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Wallet className="size-4 text-emerald-600" /> Finance Overview
              </CardTitle>
              <CardDescription>This month&apos;s summary by fund</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setModule('finance')} className="text-xs">
              Finance <ArrowRight className="size-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <div className="rounded-xl bg-emerald-500/8 border border-emerald-500/15 p-4">
                <p className="text-[10px] uppercase font-semibold text-emerald-600 tracking-wide">Income (Month)</p>
                <p className="text-xl font-bold mt-1 nums">{formatCurrency(data.financeSummary!.incomeThisMonth, organization?.currency)}</p>
              </div>
              <div className="rounded-xl bg-rose-500/8 border border-rose-500/15 p-4">
                <p className="text-[10px] uppercase font-semibold text-rose-600 tracking-wide">Expenses (Month)</p>
                <p className="text-xl font-bold mt-1 nums">{formatCurrency(data.financeSummary!.expensesThisMonth, organization?.currency)}</p>
              </div>
              <div className="rounded-xl bg-amber-500/8 border border-amber-500/15 p-4">
                <p className="text-[10px] uppercase font-semibold text-amber-600 tracking-wide">Pending Approvals</p>
                <p className="text-xl font-bold mt-1 nums">{data.financeSummary!.pendingApprovals}</p>
              </div>
              <div className="rounded-xl bg-primary/8 border border-primary/15 p-4">
                <p className="text-[10px] uppercase font-semibold text-primary tracking-wide">Net (Month)</p>
                <p className="text-xl font-bold mt-1 nums">{formatCurrency(data.financeSummary!.incomeThisMonth - data.financeSummary!.expensesThisMonth, organization?.currency)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {data.financeSummary!.funds.map((f) => (
                <div key={f.id} className="rounded-xl border border-border/60 p-3.5 hover:shadow-premium transition-shadow">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">{f.code ?? f.name}</p>
                  <p className="text-base font-bold mt-0.5 nums">{formatCurrency(f.balance, organization?.currency)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
