"use client";

/**
 * Shared UI primitives for Grace ChMS modules (frontend only).
 * Every module component should reuse these to stay consistent.
 * Restyled to the premium design system — prop signatures unchanged.
 */
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, STATUS_LABELS, initials } from "@/lib/types";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

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
    <div className="flex items-center justify-center gap-2 py-12 text-ink-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBlock({ error }: { error: unknown }) {
  const msg = error instanceof ApiError ? error.message : "Something went wrong.";
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-xl border border-danger/20 bg-danger-bg py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/12 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <p className="max-w-sm text-sm text-ink-secondary">{msg}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: {
  icon?: React.ElementType; title: string; description?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5.5 w-5.5" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="font-display text-base font-semibold text-ink">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-[-0.015em] text-ink">{title}</h1>
        {description ? <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-ink-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div> : null}
    </div>
  );
}

/**
 * KPI stat card — TaskFlow-style pastel tile: big centered value, label below,
 * optional icon chip floating top-right. The whole tile is tinted per tone.
 */
const STAT_TONES = {
  default: { card: "border-info/15 bg-info-bg", chip: "bg-surface text-info shadow-sm" },
  positive: { card: "border-success/15 bg-success-bg", chip: "bg-surface text-success shadow-sm" },
  warning: { card: "border-warning/20 bg-warning-bg", chip: "bg-surface text-warning shadow-sm" },
  negative: { card: "border-danger/15 bg-danger-bg", chip: "bg-surface text-danger shadow-sm" },
  violet: { card: "border-violet/15 bg-violet-bg", chip: "bg-surface text-violet shadow-sm" },
} as const;

export function StatCard({ label, value, sub, icon: Icon, tone = "default" }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ElementType;
  tone?: "default" | "positive" | "warning" | "negative" | "violet";
}) {
  const toneStyle = STAT_TONES[tone] ?? STAT_TONES.default;
  return (
    <Card
      className={cn(
        "group relative gap-0 overflow-hidden py-5 text-center transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-md",
        toneStyle.card
      )}
    >
      {Icon ? (
        <span className={cn("absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full", toneStyle.chip)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      ) : null}
      <CardContent className="flex flex-col items-center gap-1 px-4">
        <div className="font-display text-3xl font-bold tabular-nums leading-none text-ink">{value}</div>
        <div className="text-xs font-medium text-ink-secondary">{label}</div>
        {sub ? <div className="mt-1.5 text-xs leading-relaxed text-ink-muted">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export function Section({ title, description, actions, children, className, icon: Icon }: {
  title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <section className={cn("space-y-3", className)} aria-label={title}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          {Icon ? (
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-ink-muted">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
          ) : null}
          <div>
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Tinted pill + dot — bg = status color at low opacity, text = full color. */
function toneClass(bg: string, text: string) {
  return cn(bg, text);
}

const STAGE_TONES: Record<string, string> = {
  guest: toneClass("bg-warning-bg", "text-warning"),
  returning_guest: toneClass("bg-info-bg", "text-info"),
  attender: toneClass("bg-success-bg", "text-success"),
  member: toneClass("bg-secondary", "text-secondary-foreground"),
  leader: toneClass("bg-violet-500/15", "text-violet-700 dark:text-violet-300"),
  inactive: toneClass("bg-muted", "text-muted-foreground"),
  archived: toneClass("bg-muted", "text-muted-foreground/80"),
};

export function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent gap-1.5 font-medium", STAGE_TONES[stage] ?? STAGE_TONES.inactive)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {STAGE_LABELS[stage] ?? stage}
    </Badge>
  );
}

const STATUS_TONES: Record<string, string> = {
  // positive
  accepted: "success", confirmed: "success", posted: "success", delivered: "success",
  completed: "success", active: "success", sent: "success", paid: "success",
  // warning
  asked: "warning", pending: "warning", scheduled: "warning", open: "warning", processing: "warning",
  // danger
  declined: "danger", no_show: "danger", failed: "danger", bounced: "danger", reversed: "danger", overdue: "danger",
  // neutral strong
  served: "neutral", closed: "neutral",
  // muted
  cancelled: "muted", suppressed: "muted", paused: "muted", draft: "muted", queued: "muted", void: "muted",
};

const STATUS_TONE_CLASS: Record<string, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  neutral: "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  const toneKey = STATUS_TONES[status];
  const cls = toneKey ? STATUS_TONE_CLASS[toneKey] : "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("border-transparent gap-1.5 font-medium", cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/**
 * Deterministic 2-color gradient fallback for avatars (spec §3) — the pair is
 * picked from 8 curated gradient pairs using a hash of the person's name.
 */
const AVATAR_PAIRS: [string, string][] = [
  ["#f59e0b", "#ef4444"], // amber → red
  ["#14b8a6", "#84cc16"], // teal → lime
  ["#8b5cf6", "#ec4899"], // violet → pink
  ["#f97316", "#dc2626"], // orange → red
  ["#06b6d4", "#14b8a6"], // cyan → teal
  ["#a855f7", "#6366f1"], // purple → indigo
  ["#ec4899", "#f97316"], // pink → orange
  ["#22c55e", "#0d9488"], // green → teal
];

function avatarGradient(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PAIRS[h % AVATAR_PAIRS.length];
}

export function PersonAvatar({ name, className, child, src }: { name: string; className?: string; child?: boolean; src?: string | null }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        className={cn("h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-black/5 select-none dark:ring-white/10", className)}
      />
    );
  }
  const [from, to] = child ? ["#fbbf24", "#f97316"] : avatarGradient(name || "?");
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-1 ring-black/5 select-none dark:ring-white/10",
        className
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {initials(name)}
    </div>
  );
}

export function MetricDef({ definition }: { definition: string }) {
  return <p className="text-[11px] leading-snug text-ink-muted">{definition}</p>;
}
