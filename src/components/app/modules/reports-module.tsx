"use client";

/**
 * Reports — five dashboards plus the metric dictionary.
 * Every metric shown here has a published definition in the Definitions tab.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/types";
import { Check, CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, Section, StatCard, useApiQuery, type ModuleProps,
} from "@/components/app/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── local shapes (mirrors src/server/services/reports.ts) ───────────────────
interface AttendancePoint { weekStart: string; label: string; headcount: number; checkedIn: number; uniqueAdults: number; uniqueKids: number; }
interface AttendanceReport { series: AttendancePoint[]; byCampusByService: { name: string; avgHeadcount: number }[]; }
interface GivingReport {
  series: { month: string; label: string; totalCents: number; byFund: { fund: string; amountCents: number }[] }[];
  ytdCents: number; ytdLastYearCents: number; avgWeeklyCents: number;
  topFunds: { fund: string; totalCents: number }[];
  pledgeProgress: { campaign: string; pledgedCents: number; receivedCents: number; pct: number }[];
}
interface GroupsReport {
  groups: { id: string; name: string; leader: string | null; memberCount: number; capacity: number | null; fillRate: number | null; avgAttendance: number; absenteeCount: number }[];
  leaderless: string[]; joinRequestsPending: number;
}
interface VolunteersReport {
  fillRateNext4: number; noShowRate90: number;
  needsByRole: { role: string; confirmed: number; needed: number }[];
  health: { name: string; served90: number; declined: number; noShows: number; reliability: number }[];
}
interface NewPeopleReport {
  firstTime: { id: string; name: string; firstVisitAt: string; inGroup: boolean; followUpStatus: string }[];
  movedStages: { name: string; from: string | null; to: string; at: string }[];
  guestsToIntegrating: number;
}
interface MetricDefDTO { key: string; name: string; definition: string; formula: string; }

// ── helpers ──────────────────────────────────────────────────────────────────
const CHART_AXIS = { fontSize: 11, tickLine: false, axisLine: false } as const;

function kMoney(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${Math.round(dollars)}`;
}
function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function pctTone(v: number): "positive" | "warning" | "negative" {
  return v >= 90 ? "positive" : v >= 60 ? "warning" : "negative";
}
function ProgressTone({ value, tone }: { value: number; tone: "positive" | "warning" | "negative" }) {
  return (
    <Progress
      value={Math.max(0, Math.min(100, value))}
      aria-label={`${Math.round(value)} percent`}
      className={cn(
        tone === "positive" && "[&_[data-slot=progress-indicator]]:bg-teal-600",
        tone === "warning" && "[&_[data-slot=progress-indicator]]:bg-amber-500",
        tone === "negative" && "[&_[data-slot=progress-indicator]]:bg-red-500",
      )}
    />
  );
}
function Delta({ pct }: { pct: number | null }) {
  if (pct == null || !isFinite(pct)) return <span>vs previous period —</span>;
  const up = pct >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1", up ? "text-teal-700 dark:text-teal-400" : "text-red-700 dark:text-red-400")}>
      {up ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
      {up ? "+" : ""}{pct.toFixed(1)}% vs previous
    </span>
  );
}
function MoneyTooltip() {
  return <Tooltip formatter={(v) => fmtMoney(Number(v))} />;
}

// ── module ───────────────────────────────────────────────────────────────────
export default function ReportsModule({ user: _user }: ModuleProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Numbers your church can defend — each metric has a published definition."
      />
      <Tabs defaultValue="attendance">
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="giving">Giving</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="volunteers">Volunteers</TabsTrigger>
          <TabsTrigger value="new-people">New people</TabsTrigger>
          <TabsTrigger value="definitions">Definitions</TabsTrigger>
        </TabsList>
        <TabsContent value="attendance"><AttendanceTab /></TabsContent>
        <TabsContent value="giving"><GivingTab /></TabsContent>
        <TabsContent value="groups"><GroupsTab /></TabsContent>
        <TabsContent value="volunteers"><VolunteersTab /></TabsContent>
        <TabsContent value="new-people"><NewPeopleTab /></TabsContent>
        <TabsContent value="definitions"><DefinitionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Attendance ───────────────────────────────────────────────────────────────
function AttendanceTab() {
  const q = useApiQuery<AttendanceReport>(["reports", "attendance"], "/reports/attendance?weeks=12");
  if (q.isLoading) return <LoadingBlock label="Crunching attendance…" />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const series = q.data?.series ?? [];
  const byService = q.data?.byCampusByService ?? [];

  const half = Math.floor(series.length / 2);
  const recent = series.slice(half).map((s) => s.headcount);
  const prior = series.slice(0, half).map((s) => s.headcount);
  const avgRecent = avg(recent);
  const avgPrior = avg(prior);
  const delta = avgPrior ? ((avgRecent - avgPrior) / avgPrior) * 100 : null;
  const chartData = series.map((s) => ({ label: s.label, headcount: s.headcount, checkedIn: s.checkedIn }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Avg weekly headcount" value={Math.round(avgRecent).toLocaleString()} sub={<Delta pct={delta} />} tone="default" />
        <StatCard label="Avg checked-in" value={Math.round(avg(series.map((s) => s.checkedIn))).toLocaleString()} sub="kiosk check-ins per week" icon={CheckCircle2} />
        <StatCard label="Avg unique adults" value={Math.round(avg(series.map((s) => s.uniqueAdults))).toLocaleString()} sub="distinct adults per week" />
        <StatCard label="Avg unique kids" value={Math.round(avg(series.map((s) => s.uniqueKids))).toLocaleString()} sub="distinct kids per week" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Weekly headcount vs checked-in</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" {...CHART_AXIS} />
              <YAxis {...CHART_AXIS} width={32} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="headcount" name="Headcount" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="checkedIn" name="Checked in" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Section title="By service" description="Average headcount per recurring service over the period.">
        {byService.length ? (
          <div className="max-h-80 overflow-y-auto scroll-slim rounded-lg border" tabIndex={0}>
            <Table>
              <TableHeader><TableRow><TableHead>Service</TableHead><TableHead className="text-right">Avg headcount</TableHead></TableRow></TableHeader>
              <TableBody>
                {byService.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.avgHeadcount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <EmptyState title="No service attendance recorded" />}
      </Section>
    </div>
  );
}

// ── Giving ───────────────────────────────────────────────────────────────────
function GivingTab() {
  const q = useApiQuery<GivingReport>(["reports", "giving"], "/reports/giving?months=12");
  if (q.isLoading) return <LoadingBlock label="Totaling giving…" />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const ytdDelta = d.ytdLastYearCents ? ((d.ytdCents - d.ytdLastYearCents) / d.ytdLastYearCents) * 100 : null;
  const chartData = d.series.map((s) => ({ label: s.label, totalCents: s.totalCents }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Giving YTD" value={fmtMoney(d.ytdCents)} sub={ytdDelta == null ? "No last-year baseline" : <Delta pct={ytdDelta} />} tone="positive" />
        <StatCard label="Last year YTD" value={fmtMoney(d.ytdLastYearCents)} sub="same calendar period" />
        <StatCard label="Avg weekly" value={fmtMoney(d.avgWeeklyCents)} sub="week-normalized YTD pace" />
        <StatCard label="Top fund" value={d.topFunds[0]?.fund ?? "—"} sub={d.topFunds[0] ? fmtMoney(d.topFunds[0].totalCents) : "No funds yet"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Monthly giving</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" {...CHART_AXIS} />
              <YAxis {...CHART_AXIS} width={56} tickFormatter={(v) => kMoney(Number(v))} />
              <MoneyTooltip />
              <Area type="monotone" dataKey="totalCents" name="Given" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Top funds YTD</CardTitle></CardHeader>
          <CardContent>
            {d.topFunds.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.topFunds.map((f) => ({ fund: f.fund, totalCents: f.totalCents }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" {...CHART_AXIS} tickFormatter={(v) => kMoney(Number(v))} />
                  <YAxis type="category" dataKey="fund" {...CHART_AXIS} width={120} />
                  <MoneyTooltip />
                  <Bar dataKey="totalCents" name="Received" fill="var(--chart-3)" radius={[0, 3, 3, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No fund splits yet" />}
          </CardContent>
        </Card>

        <Section title="Pledge progress" description="Received vs pledged per campaign.">
          {d.pledgeProgress.length ? (
            <ul className="max-h-64 space-y-3 overflow-y-auto scroll-slim rounded-lg border p-3">
              {d.pledgeProgress.map((p) => {
                const tone = p.pct >= 100 ? "positive" : p.pct >= 60 ? "warning" : "negative";
                return (
                  <li key={p.campaign} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{p.campaign}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmtMoney(p.receivedCents)} / {fmtMoney(p.pledgedCents)} · {p.pct}%
                      </span>
                    </div>
                    <ProgressTone value={p.pct} tone={tone} />
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState title="No active pledge campaigns" />}
        </Section>
      </div>
    </div>
  );
}

// ── Groups ───────────────────────────────────────────────────────────────────
function GroupsTab() {
  const q = useApiQuery<GroupsReport>(["reports", "groups"], "/reports/groups");
  if (q.isLoading) return <LoadingBlock label="Loading group health…" />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const withCapacity = d.groups.filter((g) => g.capacity);
  const avgFill = withCapacity.length
    ? Math.round(withCapacity.reduce((a, g) => a + (g.fillRate ?? 0), 0) / withCapacity.length)
    : 0;
  const chartData = d.groups.slice(0, 10).map((g) => ({ name: g.name, avgAttendance: g.avgAttendance }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active groups" value={d.groups.length} sub={`${withCapacity.length} with capacity set`} />
        <StatCard label="Avg fill rate" value={`${avgFill}%`} tone={pctTone(avgFill)} />
        <StatCard label="Join requests pending" value={d.joinRequestsPending} tone={d.joinRequestsPending ? "warning" : "default"} />
        <StatCard label="Leaderless groups" value={d.leaderless.length} tone={d.leaderless.length ? "warning" : "positive"} />
      </div>

      {d.leaderless.length ? (
        <Alert className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTitle className="text-amber-900 dark:text-amber-200">Groups without a leader</AlertTitle>
          <AlertDescription className="text-amber-800 dark:text-amber-300">
            {d.leaderless.join(", ")} — every group needs an accountable leader for care and attendance.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">Avg attendance (last 6 meetings)</CardTitle></CardHeader>
        <CardContent>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" {...CHART_AXIS} interval={0} angle={-30} textAnchor="end" height={60} />
                <YAxis {...CHART_AXIS} width={32} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="avgAttendance" name="Avg attendance" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No groups yet" />}
        </CardContent>
      </Card>

      <Section title="All groups">
        {d.groups.length ? (
          <div className="max-h-80 overflow-y-auto scroll-slim rounded-lg border" tabIndex={0}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Leader</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead>Fill rate</TableHead>
                  <TableHead className="text-right">Avg attend.</TableHead>
                  <TableHead className="text-right">Absentees</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.groups.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="whitespace-nowrap">{g.leader ?? <span className="text-amber-700 dark:text-amber-400">No leader</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.memberCount}{g.capacity ? ` / ${g.capacity}` : ""}</TableCell>
                    <TableCell>
                      {g.fillRate != null ? (
                        <span className="flex min-w-28 items-center gap-2">
                          <ProgressTone value={g.fillRate} tone={pctTone(g.fillRate)} />
                          <span className="w-9 text-right text-xs tabular-nums">{g.fillRate}%</span>
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{g.avgAttendance}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", g.absenteeCount > 0 && "font-semibold text-amber-700 dark:text-amber-400")}>{g.absenteeCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <EmptyState title="No groups yet" />}
      </Section>
    </div>
  );
}

// ── Volunteers ───────────────────────────────────────────────────────────────
function VolunteersTab() {
  const q = useApiQuery<VolunteersReport>(["reports", "volunteers"], "/reports/volunteers");
  if (q.isLoading) return <LoadingBlock label="Loading volunteer stats…" />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const totalNeeded = d.needsByRole.reduce((a, r) => a + r.needed, 0);
  const totalConfirmed = d.needsByRole.reduce((a, r) => a + r.confirmed, 0);
  const chartData = d.needsByRole.map((r) => ({ role: r.role, Confirmed: r.confirmed, Needed: r.needed }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Fill rate next 4 weeks" value={`${d.fillRateNext4}%`} tone={pctTone(d.fillRateNext4)} />
        <StatCard label="No-show rate (90d)" value={`${d.noShowRate90}%`} tone={d.noShowRate90 > 5 ? "negative" : d.noShowRate90 > 0 ? "warning" : "positive"} />
        <StatCard label="Next Sunday" value={`${totalConfirmed} / ${totalNeeded}`} sub="confirmed / needed positions" tone={totalConfirmed >= totalNeeded ? "positive" : "warning"} />
        <StatCard label="Watchlist" value={d.health.filter((h) => h.reliability < 80).length} sub="volunteers under 80% reliability" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Next Sunday by role</CardTitle></CardHeader>
        <CardContent>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="role" {...CHART_AXIS} interval={0} angle={-30} textAnchor="end" height={70} />
                <YAxis {...CHART_AXIS} width={28} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Confirmed" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Needed" fill="var(--chart-4)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No assignments scheduled for next Sunday" />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Staffing needs by role" description="Confirmed vs needed for next Sunday.">
          {d.needsByRole.length ? (
            <ul className="max-h-80 space-y-3 overflow-y-auto scroll-slim rounded-lg border p-3">
              {d.needsByRole.map((r) => {
                const pct = r.needed ? Math.round((r.confirmed / r.needed) * 100) : 100;
                return (
                  <li key={r.role} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{r.role}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.confirmed}/{r.needed}</span>
                    </div>
                    <ProgressTone value={pct} tone={pctTone(pct)} />
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState title="Nothing needed yet" description="Add positions to next Sunday's plan." />}
        </Section>

        <Section title="Reliability watchlist" description="Lowest reliability first (served ÷ served + no-shows, 90 days).">
          {d.health.length ? (
            <ul className="max-h-80 space-y-2 overflow-y-auto scroll-slim rounded-lg border p-3">
              {d.health.map((h) => (
                <li key={h.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{h.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {h.served90} served · <span className={cn(h.noShows > 0 && "font-semibold text-red-700 dark:text-red-400")}>{h.noShows} no-shows</span> ·{" "}
                    <span className={cn(
                      "font-semibold",
                      h.reliability >= 90 && "text-teal-700 dark:text-teal-400",
                      h.reliability < 90 && h.reliability >= 60 && "text-amber-700 dark:text-amber-400",
                      h.reliability < 60 && "text-red-700 dark:text-red-400",
                    )}>{h.reliability}%</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No serving history" />}
        </Section>
      </div>
    </div>
  );
}

// ── New people ───────────────────────────────────────────────────────────────
function NewPeopleTab() {
  const q = useApiQuery<NewPeopleReport>(["reports", "new-people"], "/reports/new-people?days=30");
  if (q.isLoading) return <LoadingBlock label="Loading new people…" />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const inGroupPct = d.firstTime.length ? Math.round((d.firstTime.filter((f) => f.inGroup).length / d.firstTime.length) * 100) : 0;
  const followUpsPending = d.firstTime.filter((f) => f.followUpStatus !== "completed").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="First-time guests" value={d.firstTime.length} sub="last 30 days" />
        <StatCard label="Guests → integrating" value={d.guestsToIntegrating} sub="moved to attender or member" tone="positive" />
        <StatCard label="In a group" value={`${inGroupPct}%`} sub="of first-time guests" tone={inGroupPct >= 50 ? "positive" : "warning"} />
        <StatCard label="Follow-ups pending" value={followUpsPending} tone={followUpsPending ? "warning" : "positive"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="First-time guests" description="Newest first — connect them to a group quickly.">
          {d.firstTime.length ? (
            <ul className="max-h-80 space-y-2 overflow-y-auto scroll-slim rounded-lg border p-3">
              {d.firstTime.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(f.firstVisitAt)}</span>
                  {f.inGroup ? (
                    <Badge variant="outline" className="gap-1 border-transparent bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200">
                      <Check className="h-3 w-3" aria-hidden /> In group
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">No group</Badge>
                  )}
                  <Badge variant="outline" className={cn(
                    "capitalize",
                    f.followUpStatus === "completed" && "border-transparent bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
                    f.followUpStatus === "pending" && "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                  )}>
                    {f.followUpStatus.replace("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No first-time guests in the window" />}
        </Section>

        <Section title="Stage moves" description="Lifecycle changes in the last 30 days.">
          {d.movedStages.length ? (
            <ol className="max-h-80 space-y-2 overflow-y-auto scroll-slim rounded-lg border p-3">
              {d.movedStages.map((m, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground">: {m.from?.replace("_", " ") ?? "—"} → {m.to.replace("_", " ")}</span>
                  <span className="block text-xs text-muted-foreground">{fmtDateTime(m.at)}</span>
                </li>
              ))}
            </ol>
          ) : <EmptyState title="No stage moves in the window" />}
        </Section>
      </div>
    </div>
  );
}

// ── Definitions ──────────────────────────────────────────────────────────────
function DefinitionsTab() {
  const q = useApiQuery<{ items: MetricDefDTO[] }>(["reports", "dictionary"], "/reports/metric-dictionary");
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const items = q.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
        <CardHeader><CardTitle className="text-base text-amber-900 dark:text-amber-200">Why this page exists</CardTitle></CardHeader>
        <CardContent className="text-sm text-amber-900/90 dark:text-amber-200/90">
          Two churches of the same size can honestly report very different numbers — because words like
          “attender” mean different things to different teams. Rather than argue, we publish the definition
          next to every metric: the same formula computes every number in this product, and this dictionary
          is that formula, in plain language.
        </CardContent>
      </Card>

      {items.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Metric</TableHead>
                <TableHead>Definition</TableHead>
                <TableHead className="w-80">Formula</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((m) => (
                <TableRow key={m.key}>
                  <TableCell className="align-top font-medium">{m.name}</TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">{m.definition}</TableCell>
                  <TableCell className="align-top">
                    <code className="block rounded bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">{m.formula}</code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title="No metric definitions" />}
    </div>
  );
}
