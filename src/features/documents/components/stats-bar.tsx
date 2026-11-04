"use client";

/**
 * Stats dashboard strip — totals, storage vs quota, uploads this month,
 * pending review, expiring soon + quarantine/trash chips for admins.
 */
import { StatCard } from "@/components/app/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fmtBytes, timeAgo } from "../utils";
import type { DocumentsStats } from "../types";
import {
  FileText, Database, UploadCloud, Clock3, CalendarClock, ShieldAlert, Trash2,
} from "lucide-react";

export function StatsBar({ stats, isAdmin }: { stats: DocumentsStats; isAdmin: boolean }) {
  const usedPct = stats.storageQuotaBytes
    ? Math.min(100, Math.round((stats.storageUsedBytes / stats.storageQuotaBytes) * 100))
    : 0;
  const quotaTone = usedPct >= 90 ? "warning" : usedPct >= 75 ? "violet" : "default";

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" role="list" aria-label="Document library statistics">
      <StatCard label="Documents" value={stats.total} icon={FileText} sub={`${stats.draftCount} draft${stats.draftCount === 1 ? "" : "s"}`} />
      <Card className={cn("overflow-hidden py-5", quotaTone === "warning" ? "border-warning/20 bg-warning-bg" : quotaTone === "violet" ? "border-violet/15 bg-violet-bg" : "border-info/15 bg-info-bg")}>
        <CardContent className="flex flex-col gap-2 px-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-secondary">Storage</span>
            <Database className="h-4 w-4 text-info" aria-hidden />
          </div>
          <div className="font-display text-lg font-bold tabular-nums leading-none text-ink">
            {fmtBytes(stats.storageUsedBytes)} <span className="text-xs font-medium text-ink-muted">/ {fmtBytes(stats.storageQuotaBytes)}</span>
          </div>
          <Progress value={usedPct} aria-label={`Storage ${usedPct}% of quota`} className="h-1.5" />
        </CardContent>
      </Card>
      <StatCard label="Uploaded this month" value={stats.uploadsThisMonth} icon={UploadCloud} tone="positive" />
      <StatCard label="Pending review" value={stats.pendingReview} icon={Clock3} tone={stats.pendingReview > 0 ? "warning" : "default"} />
      <StatCard label="Expiring soon" value={stats.expiringSoon} icon={CalendarClock} sub="within 30 days" tone={stats.expiringSoon > 0 ? "violet" : "default"} />
      {isAdmin && (stats.infectedCount > 0 || stats.trashCount > 0) ? (
        <>
          {stats.infectedCount > 0 ? (
            <StatCard label="Quarantined" value={stats.infectedCount} icon={ShieldAlert} tone="negative" sub="action required" />
          ) : null}
          {stats.trashCount > 0 ? (
            <StatCard label="In Trash" value={stats.trashCount} icon={Trash2} sub="recoverable" />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function OfflineBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-2.5 text-sm text-warning">
      You appear to be offline — showing the last loaded page. Reconnect to refresh.
    </div>
  );
}

export function SandboxNotice({ matrix }: { matrix: { label: string; description: string; count: number }[] }) {
  // dev/sandbox only — derived from the SAME access matrix the server enforces
  if (process.env.NODE_ENV === "production") return null;
  if (!matrix.length) return null;
  return (
    <details className="rounded-lg border border-info/20 bg-info-bg/60 px-4 py-2.5 text-xs text-ink-secondary open:pb-3">
      <summary className="cursor-pointer select-none font-medium text-info">Sandbox mode — who can see which access level?</summary>
      <ul className="mt-2 space-y-1">
        {matrix.map((m) => (
          <li key={m.label} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-ink">{m.label}</span>
            <span>— {m.description}</span>
            <span className="text-ink-muted">({m.count} visible to you now)</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-ink-muted">This panel only appears outside production; the server enforces these rules on every request.</p>
    </details>
  );
}

export function LastRefreshed({ at }: { at?: string }) {
  if (!at) return null;
  return <span className="text-xs text-ink-muted">Updated {timeAgo(at)}</span>;
}
