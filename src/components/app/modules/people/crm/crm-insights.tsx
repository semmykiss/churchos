"use client";

/**
 * People CRM v2 — clickable insight tiles. Every count comes from the
 * permission-scoped /people/v2/insights endpoint; clicking a tile applies the
 * matching server-side filter. Scope caption keeps non-staff viewers honest
 * ("your groups & household" vs the whole church).
 *
 * Space-friendly: the strip is collapsible (preference persisted locally) so
 * the directory below can claim the full viewport when working long lists.
 */
import { useEffect, useState } from "react";
import { Cake, ChevronDown, ChevronUp, Search, UserCheck, Users, UserX, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CrmInsights, FilterGroup } from "./crm-shared";

const HIDDEN_KEY = "peopleCrm.insightsHidden";

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
  // Collapsed state is a local preference; the guarded lazy initializer keeps
  // SSR/CSR in agreement (same pattern as the profile deep-link state).
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try { return localStorage.getItem(HIDDEN_KEY) !== "1"; } catch { return true; }
  });

  const toggle = () => {
    setOpen((v) => {
      try { localStorage.setItem(HIDDEN_KEY, v ? "1" : "0"); } catch { /* ignore */ }
      return !v;
    });
  };

  const headerRow = (
    <div className="flex items-center justify-between gap-2">
      <p className="truncate text-xs text-muted-foreground">
        Counts cover {scopeLabel}. Click a tile to filter the list.
      </p>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
        {open ? "Hide insights" : "Show insights"}
      </button>
    </div>
  );

  if (!open) {
    return <div>{headerRow}</div>;
  }

  if (isLoading || !insights) {
    return (
      <div>
        {headerRow}
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" aria-busy="true" aria-label="Loading insights">
          {INSIGHT_PRESETS.map((p) => (
            <Card key={p.key} className="gap-2 py-3">
              <CardHeader className="px-3">
                <CardTitle className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  <span className="truncate">{p.label}</span>
                  <Skeleton className="h-6 w-6 rounded-lg" />
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3"><Skeleton className="h-6 w-12" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {headerRow}
      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
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
                "group cursor-pointer gap-1.5 py-3 transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                isActive && "ring-2 ring-primary"
              )}
            >
              <CardHeader className="px-3">
                <CardTitle className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  <span className="truncate">{preset.label}</span>
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors", TONE_CLASS[preset.tone])}>
                    <Icon className="h-3 w-3" aria-hidden />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3">
                <div className="font-display text-xl font-semibold tabular-nums text-ink">{value}</div>
                {isActive ? (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-primary">
                    <Search className="h-3 w-3" aria-hidden />
                    <span>Showing in list</span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
