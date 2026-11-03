"use client";

/**
 * Dashboard — "This Week", the pastor's Monday-morning screen.
 * Single read: GET reports/this-week. No required input.
 */
import { toast } from "sonner";
import {
  ArrowRight, HandCoins, HeartHandshake, UserPlus, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, PersonAvatar, Section,
  StatCard, StatusBadge, useApiQuery, type ModuleProps,
} from "@/components/app/shared";
import { cn } from "@/lib/utils";
import { canDo, fmtDate, fmtDateTime, fmtMoney } from "@/lib/types";
import type { NeedsAttentionResp } from "@/components/app/pipeline/pipeline-shared";

// ── Contract shapes (docs/api-contract.md → Reports → this-week) ─────────────

const CASE_TYPE_LABELS: Record<string, string> = {
  hospital: "Hospital", bereavement: "Bereavement", counseling: "Counseling",
  food_assistance: "Food assistance", safeguarding: "Safeguarding",
  new_believer: "New believer", follow_up: "Follow-up", other: "Other",
};

interface FirstTimeGuest {
  id: string;
  name: string;
  date: string;
  followUpStatus: "pending" | "completed";
}

interface OpenCareCase {
  id: string;
  person: string;
  type: string;
  urgency: string;
  dueDate: string | null;
}

interface ThisWeekReport {
  attendanceThisWeek: number;
  attendanceLastWeek: number;
  attendanceSameWeekLastYear: number | null;
  firstTimeGuests: FirstTimeGuest[];
  followUpsPending: number;
  givingMtdCents: number;
  givingBudgetCents: number;
  givingLastMonthCents: number;
  openCareCases: OpenCareCase[];
  upcomingSunday: {
    volunteersConfirmed: number;
    volunteersNeeded: number;
    events: { name: string; startsAt: string }[];
  };
  newPeople30: { count: number; items: { id: string; name: string }[] };
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function UrgencyBadge({ urgency }: { urgency: string }) {
  const cls =
    urgency === "urgent"
      ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
      : urgency === "high"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium capitalize", cls)}>
      {urgency}
    </Badge>
  );
}

function AttendanceDeltaSub({ report }: { report: ThisWeekReport }) {
  const delta = report.attendanceThisWeek - report.attendanceLastWeek;
  const up = delta >= 0;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={cn("font-medium", up ? "text-teal-700 dark:text-teal-400" : "text-destructive")}>
        {up ? "▲" : "▼"} {Math.abs(delta)} vs last week
      </span>
      {report.attendanceSameWeekLastYear != null ? (
        <span className="text-muted-foreground/70">· {report.attendanceSameWeekLastYear} same week last year</span>
      ) : null}
    </span>
  );
}

// ── Needs attention (pipeline) ──────────────────────────────────────────────

/**
 * Pipeline "Needs Attention" widget — stalled people + overdue follow-up
 * tasks. Only rendered for viewers with pipeline.view (same data source as
 * the Pipeline module, so both share one cache entry). Click-through hops to
 * the Pipeline module (opens on the Board tab) via the app-wide navigate
 * event — the same mechanism the person dialog uses for "Give now".
 */
function NeedsAttentionWidget() {
  const needsQ = useApiQuery<NeedsAttentionResp>(["pipeline", "needs-attention"], "/pipeline/needs-attention");
  const d = needsQ.data;
  const caughtUp = !!d && d.stalledCount === 0 && d.overdueCount === 0;

  return (
    <Section
      title="Needs attention"
      description="People stalled in the pipeline and follow-up tasks past due."
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-11 gap-1.5 lg:h-8"
          onClick={() => window.dispatchEvent(new CustomEvent("chms:navigate", { detail: "pipeline" }))}
          aria-label="Open the Pipeline board"
        >
          Pipeline board <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      }
    >
      <Card>
        <CardContent className="space-y-4 px-4">
          {needsQ.isLoading ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : needsQ.isError ? (
            <p className="py-2 text-sm text-muted-foreground">Couldn't load pipeline attention items.</p>
          ) : d ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Stalled people</p>
                  <p
                    className={cn(
                      "mt-0.5 text-xl font-semibold tabular-nums",
                      d.stalledCount > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground",
                    )}
                  >
                    {d.stalledCount}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Overdue tasks</p>
                  <p
                    className={cn(
                      "mt-0.5 text-xl font-semibold tabular-nums",
                      d.overdueCount > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground",
                    )}
                  >
                    {d.overdueCount}
                  </p>
                </div>
              </div>

              {caughtUp ? (
                <p className="text-sm font-medium text-teal-700 dark:text-teal-400">
                  All caught up — everyone is moving and every task is done.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Stalled in a stage
                    </p>
                    {d.stalled.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nobody is stalled right now.</p>
                    ) : (
                      <ul className="divide-y">
                        {d.stalled.slice(0, 4).map((s) => (
                          <li key={s.personId} className="flex items-center justify-between gap-2 py-2 text-sm">
                            <span className="min-w-0 truncate font-medium">{s.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {s.stageName} · {s.daysInStage}d
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Overdue follow-up
                    </p>
                    {d.overdueTasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No overdue tasks.</p>
                    ) : (
                      <ul className="divide-y">
                        {d.overdueTasks.slice(0, 3).map((t) => (
                          <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                            <span className="min-w-0 truncate">
                              <span className="font-medium">{t.personName}</span>
                              <span className="text-muted-foreground"> · {t.title}</span>
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDate(t.dueDate)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </Section>
  );
}

// ── Module ───────────────────────────────────────────────────────────────────

export default function DashboardModule({ user }: ModuleProps) {
  const reportQ = useApiQuery<ThisWeekReport>(["reports", "this-week"], "/reports/this-week");
  const d = reportQ.data;
  const canPipeline = canDo(user, "pipeline.view");

  const urgentCareCount = (d?.openCareCases ?? []).filter(
    (c) => c.urgency === "urgent" || c.urgency === "high",
  ).length;

  const budgetPct =
    d && d.givingBudgetCents > 0
      ? Math.max(0, Math.min(100, Math.round((d.givingMtdCents / d.givingBudgetCents) * 100)))
      : 0;

  const sunday = d?.upcomingSunday;
  // Volunteer team staffing — commented out (Volunteers module disabled)
  // const volunteerPct =
  //   sunday && sunday.volunteersNeeded > 0
  //     ? Math.max(0, Math.min(100, Math.round((sunday.volunteersConfirmed / sunday.volunteersNeeded) * 100)))
  //     : 0;
  // const volunteersFullyStaffed = !!sunday && sunday.volunteersConfirmed >= sunday.volunteersNeeded;

  return (
    <div className="space-y-6">
      <PageHeader
        title="This Week"
        description={`Good to see you, ${user.name.split(" ")[0]} — the week at a glance.`}
      />

      {reportQ.isLoading ? (
        <LoadingBlock label="Pulling this week's numbers…" />
      ) : reportQ.error ? (
        <ErrorBlock error={reportQ.error} />
      ) : !d ? null : (
        <>
          {/* Stats row */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Attendance"
              value={d.attendanceThisWeek}
              icon={Users}
              tone={d.attendanceThisWeek >= d.attendanceLastWeek ? "positive" : "negative"}
              sub={<AttendanceDeltaSub report={d} />}
            />
            <StatCard
              label="Giving MTD"
              value={fmtMoney(d.givingMtdCents)}
              icon={HandCoins}
              sub={
                <div className="space-y-1.5">
                  <Progress value={budgetPct} aria-label={`${budgetPct}% of monthly budget received`} />
                  <span>
                    {budgetPct}% of {fmtMoney(d.givingBudgetCents)} budget
                  </span>
                </div>
              }
            />
            <StatCard
              label="First-time guests"
              value={d.firstTimeGuests.length}
              icon={UserPlus}
              tone={d.firstTimeGuests.length > 0 ? "warning" : "default"}
              sub={`${d.followUpsPending} follow-ups pending`}
            />
            <StatCard
              label="Open care cases"
              value={d.openCareCases.length}
              icon={HeartHandshake}
              tone={urgentCareCount > 0 ? "negative" : "default"}
              sub={urgentCareCount > 0 ? `${urgentCareCount} urgent` : "No urgent cases"}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => toast("See Reports → Metric dictionary")}
              className="underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
            >
              Definitions in Reports → Metric dictionary.
            </button>
          </p>

          {/* Sections */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* First-time guests to follow up */}
            <Section
              title="First-time guests to follow up"
              description="Guests from the last 7 days and where their follow-up stands."
              className="lg:col-span-1"
            >
              <Card>
                <CardContent className="px-4">
                  {d.firstTimeGuests.length === 0 ? (
                    <EmptyState
                      icon={UserPlus}
                      title="No guests waiting on follow-up"
                      description="Everyone who visited this week has been contacted."
                    />
                  ) : (
                    <ul className="divide-y">
                      {d.firstTimeGuests.map((g) => (
                        <li key={g.id} className="flex items-center gap-3 py-2.5">
                          <PersonAvatar name={g.name} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{g.name}</p>
                            <p className="text-xs text-muted-foreground">Visited {fmtDate(g.date)}</p>
                          </div>
                          <StatusBadge status={g.followUpStatus} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </Section>

            {/* This Sunday */}
            <Section
              title="This Sunday"
              description="What's coming up on the calendar."
              className="lg:col-span-1"
            >
              <Card>
                <CardContent className="space-y-4 px-4">
                  {/* Volunteer team — commented out (Volunteers module disabled) */}
                  {/* <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Volunteer team</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          volunteersFullyStaffed ? "text-teal-700 dark:text-teal-400" : "text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {sunday?.volunteersConfirmed ?? 0} of {sunday?.volunteersNeeded ?? 0} confirmed
                      </span>
                    </div>
                    <Progress
                      value={volunteerPct}
                      aria-label={`${sunday?.volunteersConfirmed ?? 0} of ${sunday?.volunteersNeeded ?? 0} volunteers confirmed`}
                    />
                    {!volunteersFullyStaffed ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Still short — check Volunteers to confirm the gap.
                      </p>
                    ) : null}
                  </div> */}

                  {sunday && sunday.events.length > 0 ? (
                    <ul className="divide-y border-t">
                      {sunday.events.map((e) => (
                        <li key={`${e.name}-${e.startsAt}`} className="flex items-center justify-between gap-3 py-2.5">
                          <span className="min-w-0 truncate text-sm font-medium">{e.name}</span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {fmtDateTime(e.startsAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">No events on the calendar yet.</p>
                  )}
                </CardContent>
              </Card>
            </Section>

            {/* Open care cases */}
            <Section
              title="Open care cases"
              description="Who needs a visit, call or prayer this week."
              className="lg:col-span-2"
            >
              <Card>
                <CardContent className="px-4">
                  {d.openCareCases.length === 0 ? (
                    <EmptyState
                      icon={HeartHandshake}
                      title="No open care cases"
                      description="Everyone on the care list is taken care of."
                    />
                  ) : (
                    <ul className="divide-y">
                      {d.openCareCases.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                          <PersonAvatar name={c.person} className="h-8 w-8 text-[11px]" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.person}</span>
                          <span className="text-xs text-muted-foreground">{CASE_TYPE_LABELS[c.type] ?? c.type}</span>
                          <UrgencyBadge urgency={c.urgency} />
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            Due {fmtDate(c.dueDate)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </Section>
          </div>

          {/* Pipeline needs-attention — pipeline.view viewers only */}
          {canPipeline ? <NeedsAttentionWidget /> : null}

          {/* New people last 30 days — quiet secondary strip */}
          {d.newPeople30.count > 0 ? (
            <Section
              title="New in the last 30 days"
              description={`${d.newPeople30.count} people connected with the church this month.`}
            >
              <Card>
                <CardContent className="flex flex-wrap gap-2 px-4 py-4">
                  {d.newPeople30.items.map((p) => (
                    <Badge key={p.id} variant="secondary" className="gap-1.5 py-1 pl-1 font-normal">
                      <PersonAvatar name={p.name} className="h-5 w-5 text-[9px]" />
                      {p.name}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}
