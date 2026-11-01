"use client";

/**
 * People CRM v2 — clickable insight tiles. Every count comes from the
 * permission-scoped /people/v2/insights endpoint; clicking a tile applies the
 * matching server-side filter. Scope caption keeps non-staff viewers honest
 * ("your groups & household" vs the whole church).
 */
import { Cake, Search, UserCheck, Users, UserX, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CrmInsights, FilterGroup } from "./crm-shared";

export interface InsightPreset {
  key: keyof CrmInsights["stats"];
  label: string;
  icon: React.ElementType;
  tone: "default" | "positive" | "warning" | "negative";
  /** Filter applied when the tile is clicked (null = clear filters). */
  filter: (now: Date) => FilterGroup | null;
}

const TONE_CLASS: Record<InsightPreset["tone"], string> = {
  default: "bg-primary/10 text-primary",
  positive: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  negative: "bg-danger/10 text-danger",
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function isoMonthStart(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString();
}

export const INSIGHT_PRESETS: InsightPreset[] = [
  { key: "totalActive", label: "Total active", icon: Users, tone: "default", filter: () => null },
  {
    key: "newThisMonth",
    label: "New this month",
    icon: UserCheck,
    tone: "positive",
    filter: () => ({ match: "all", conditions: [{ field: "created", op: "between", value: { from: isoMonthStart(), to: new Date().toISOString().slice(0, 10) } }] }),
  },
  {
    key: "notSeenIn4Weeks",
    label: "Not seen in 4+ weeks",
    icon: CalendarClock,
    tone: "warning",
    filter: () => ({
      match: "any",
      conditions: [
        { field: "lastAttended", op: "before", value: { to: isoDaysAgo(28).slice(0, 10) } },
        { field: "lastAttended", op: "isMissing" },
      ],
    }),
  },
  {
    key: "notInAnyGroup",
    label: "Not in any group",
    icon: UserX,
    tone: "negative",
    filter: () => ({ match: "all", conditions: [{ field: "group", op: "none" }] }),
  },
  {
    key: "birthdaysThisWeek",
    label: "Birthdays this week",
    icon: Cake,
    tone: "positive",
    filter: () => ({ match: "all", conditions: [{ field: "birthday", op: "upcoming", value: { days: 7 } }] }),
  },
];

function sameFilter(a: FilterGroup | null, b: FilterGroup | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function InsightsStrip({ insights, isLoading, activeFilters, onSelect, scopeLabel }: {
  insights: CrmInsights | undefined;
  isLoading: boolean;
  activeFilters: FilterGroup | null;
  onSelect: (preset: InsightPreset) => void;
  scopeLabel: string;
}) {
  if (isLoading || !insights) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-busy="true" aria-label="Loading insights">
        {INSIGHT_PRESETS.map((p) => (
          <Card key={p.key} className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                <span className="truncate">{p.label}</span>
                <Skeleton className="h-7 w-7 rounded-lg" />
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4"><Skeleton className="h-7 w-14" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {INSIGHT_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const value = insights.stats[preset.key];
          const isActive = sameFilter(activeFilters, preset.filter(new Date()));
          return (
            <Card
              key={preset.key}
              role="button"
              tabIndex={0}
              aria-label={`${preset.label}: ${value}. Show in list`}
              onClick={() => onSelect(preset)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(preset);
                }
              }}
              className={cn(
                "group cursor-pointer gap-3 py-4 transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                isActive && "ring-2 ring-primary"
              )}
            >
              <CardHeader className="px-4">
                <CardTitle className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  <span className="truncate">{preset.label}</span>
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors", TONE_CLASS[preset.tone])}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <div className="font-display text-2xl font-semibold tabular-nums text-ink">{value}</div>
                <div className="mt-1.5 flex items-center gap-1 text-xs leading-relaxed text-ink-muted">
                  <Search className="h-3 w-3 opacity-60" aria-hidden />
                  <span>{isActive ? "Showing in list" : "Click to show"}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Counts cover {scopeLabel}.</p>
    </div>
  );
}
