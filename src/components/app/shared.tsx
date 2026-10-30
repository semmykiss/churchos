"use client";

/**
 * Shared UI primitives for Grace ChMS modules (frontend only).
 * Every module component should reuse these to stay consistent.
 */
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, STATUS_LABELS, initials } from "@/lib/types";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ModuleProps = { user: import("@/lib/types").SessionUser };

/** TanStack Query wrapper over the api client. */
export function useApiQuery<T>(key: readonly unknown[], path: string, options?: Partial<UseQueryOptions<T, ApiError>>) {
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: () => api.get<T>(path),
    ...options,
  });
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBlock({ error }: { error: unknown }) {
  const msg = error instanceof ApiError ? error.message : "Something went wrong.";
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive/70" />
      <p className="text-sm text-muted-foreground max-w-sm">{msg}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description }: { icon?: React.ElementType; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="rounded-full bg-muted p-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {description ? <p className="text-sm text-muted-foreground max-w-sm">{description}</p> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone = "default" }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ElementType;
  tone?: "default" | "positive" | "warning" | "negative";
}) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-teal-700 dark:text-teal-400",
    warning: "text-amber-700 dark:text-amber-400",
    negative: "text-destructive",
  }[tone];
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
          {Icon ? <Icon className="h-4 w-4 text-muted-foreground/70" /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export function Section({ title, description, actions, children, className }: {
  title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)} aria-label={title}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

const STAGE_TONES: Record<string, string> = {
  guest: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  returning_guest: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  attender: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  member: "bg-stone-200 text-stone-900 dark:bg-stone-800 dark:text-stone-100",
  leader: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  inactive: "bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-400",
  archived: "bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-500",
};

export function StageBadge({ stage }: { stage: string }) {
  return <Badge variant="outline" className={cn("border-transparent font-medium", STAGE_TONES[stage] ?? STAGE_TONES.inactive)}>{STAGE_LABELS[stage] ?? stage}</Badge>;
}

const STATUS_TONES: Record<string, string> = {
  accepted: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  confirmed: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  served: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-100",
  asked: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  scheduled: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  declined: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  no_show: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  bounced: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  reversed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  posted: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  delivered: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  open: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  closed: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  completed: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  cancelled: "bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400",
  suppressed: "bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400",
  active: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn("border-transparent font-medium", STATUS_TONES[status] ?? "bg-muted text-muted-foreground")}>{STATUS_LABELS[status] ?? status}</Badge>;
}

export function PersonAvatar({ name, className, child }: { name: string; className?: string; child?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold select-none",
        child ? "bg-amber-200/70 text-amber-950" : "bg-secondary text-secondary-foreground",
        className
      )}
    >
      {initials(name)}
    </div>
  );
}

export function MetricDef({ definition }: { definition: string }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{definition}</p>;
}
