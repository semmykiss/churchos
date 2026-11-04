"use client";

/**
 * Shared primitives for the Partner Console (frontend only).
 * All status colors use semantic design tokens (success/warning/danger/muted)
 * so every theme — including dark mode — renders correctly. Unknown statuses
 * always fall back to a NEUTRAL badge, never a danger styling (audit fix #14).
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  multisite: "Multisite",
};

export const LICENSE_STATUS_LABELS: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Cancelled",
  none: "No license",
};

const NEUTRAL_BADGE = "bg-muted text-muted-foreground hover:bg-muted";
const SUCCESS_BADGE = "bg-success-bg text-success hover:bg-success-bg";
const WARNING_BADGE = "bg-warning-bg text-warning hover:bg-warning-bg";
const DANGER_BADGE = "bg-danger-bg text-danger hover:bg-danger-bg";

export function LicenseStatusBadge({ status, className }: { status: string; className?: string }) {
  const styles: Record<string, string> = {
    trial: WARNING_BADGE,
    active: SUCCESS_BADGE,
    past_due: WARNING_BADGE,
    suspended: DANGER_BADGE,
    cancelled: DANGER_BADGE,
    none: NEUTRAL_BADGE,
  };
  return (
    <Badge variant="secondary" className={cn(styles[status] ?? NEUTRAL_BADGE, className)}>
      {LICENSE_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export const TENANT_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  pending_verification: "Pending verification",
  suspended: "Suspended",
};

export function TenantStatusBadge({ status, className }: { status: string; className?: string }) {
  const styles: Record<string, string> = {
    active: SUCCESS_BADGE,
    // self-signup churches awaiting CAC/compliance review — not suspended, just unverified
    pending_verification: WARNING_BADGE,
    suspended: DANGER_BADGE,
  };
  return (
    <Badge variant="secondary" className={cn(styles[status] ?? NEUTRAL_BADGE, className)}>
      {TENANT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function DaysLeftBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (daysLeft < 0) return <Badge variant="secondary" className={DANGER_BADGE}>Expired</Badge>;
  if (daysLeft <= 14) {
    return <Badge variant="secondary" className={WARNING_BADGE}>{daysLeft}d left</Badge>;
  }
  return <span className="text-xs text-muted-foreground">{daysLeft}d left</span>;
}

/**
 * Mask a license key for display, keeping only the trailing group visible,
 * e.g. "GCHMS-7QK2-M4PD-XR9T" → "GCHMS-••••-••••-XR9T".
 * The full key is a credential: shown once at creation; any later reveal is
 * audited server-side (POST /partner/licenses/:id/reveal-key).
 */
export function maskLicenseKey(key: string): string {
  const parts = key.split("-");
  if (parts.length < 2) return "••••";
  return [parts[0], ...parts.slice(1, -1).map(() => "••••"), parts[parts.length - 1]].join("-");
}
