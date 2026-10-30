"use client";

/**
 * Shared primitives for the Partner Console (frontend only).
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

export function LicenseStatusBadge({ status, className }: { status: string; className?: string }) {
  const styles: Record<string, string> = {
    trial: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    active: "bg-teal-100 text-teal-800 hover:bg-teal-100",
    past_due: "bg-orange-100 text-orange-800 hover:bg-orange-100",
    suspended: "bg-red-100 text-red-800 hover:bg-red-100",
    cancelled: "bg-red-100 text-red-800 hover:bg-red-100",
    none: "bg-muted text-muted-foreground hover:bg-muted",
  };
  return (
    <Badge variant="secondary" className={cn(styles[status] ?? styles.none, className)}>
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
    active: "bg-teal-100 text-teal-800 hover:bg-teal-100",
    // self-signup churches awaiting CAC/compliance review — not suspended, just unverified
    pending_verification: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    suspended: "bg-red-100 text-red-800 hover:bg-red-100",
  };
  return (
    <Badge variant="secondary" className={cn(styles[status] ?? styles.suspended, className)}>
      {TENANT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function DaysLeftBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (daysLeft < 0) return <Badge variant="secondary" className="bg-red-100 text-red-800 hover:bg-red-100">Expired</Badge>;
  if (daysLeft <= 14) {
    return <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">{daysLeft}d left</Badge>;
  }
  return <span className="text-xs text-muted-foreground">{daysLeft}d left</span>;
}
