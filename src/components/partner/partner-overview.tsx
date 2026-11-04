"use client";

/**
 * Partner overview (security-audit upgrade, task 3-b):
 * - The one-click "Renew 12m" patch is gone — renewals now run through a dialog
 *   with a mandatory PO/invoice reference (fixes double-click double-renew and
 *   leaves a reason on the audit trail via `statusReason`).
 * - Loading renders shaped skeletons (6 stat tiles + 5 list rows) instead of a
 *   spinner-only block, so the layout doesn't jump when data arrives.
 * - The "expiring in 30d" stat uses the server-computed `expiringSoonTotal`,
 *   NOT the truncated list length.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtMoney, fmtDate, fmtDateShort } from "@/lib/types";
import type { PartnerOverview, PartnerPlan } from "@/lib/types";
import { ErrorBlock, EmptyState, PageHeader, StatCard, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LicenseStatusBadge, DaysLeftBadge, PLAN_LABELS } from "@/components/partner/partner-shared";
import {
  Ban, Building2, CalendarClock, Clock, Loader2, RefreshCw, ShieldCheck, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ExpiringLicense = PartnerOverview["expiringSoon"][number];
const TERM_OPTIONS = [1, 12, 24, 36];

export default function PartnerOverview({ onOpenLicense }: { onOpenLicense: (licenseId: string) => void }) {
  const { data, isLoading, error, isFetching, refetch } = useApiQuery<PartnerOverview>(["partner", "overview"], "/partner/overview");
  const [renewTarget, setRenewTarget] = useState<ExpiringLicense | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading partner overview">
        <PageHeader
          title="Partner overview"
          description="Your book of business — every church tenant, license health and recurring revenue, across all deployments."
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[116px] w-full" />
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Licenses expiring soon</CardTitle>
            <CardDescription>Churches whose access stops when the clock runs out — renew before Sunday.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }
  if (error || !data) return <ErrorBlock error={error} />;

  // The expiring list is truncated server-side — the stat card uses the true total.
  const expiringTotal = data.expiringSoonTotal ?? data.expiringSoon.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partner overview"
        description="Your book of business — every church tenant, license health and recurring revenue, across all deployments."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total tenants" value={data.tenants.total} sub="all deployments" icon={Building2} />
        <StatCard label="Active" value={data.tenants.active} sub="sign-in enabled" icon={ShieldCheck} tone="positive" />
        <StatCard label="Pending verification" value={data.tenants.pending} sub="awaiting review" icon={Clock} tone="warning" />
        <StatCard label="Suspended" value={data.tenants.suspended} sub="access blocked" icon={Ban} tone="negative" />
        <StatCard label="Est. MRR" value={fmtMoney(data.mrrCents)} sub="from active licenses" icon={TrendingUp} tone="positive" />
        <StatCard label="Expiring ≤30 days" value={expiringTotal} sub="renew or they lose access" icon={CalendarClock} tone="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Licenses expiring soon</CardTitle>
          <CardDescription>Churches whose access stops when the clock runs out — renew before Sunday.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.expiringSoon.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing expiring in the next 30 days." description="All active licenses have runway." />
          ) : (
            <div className="space-y-2">
              {expiringTotal > data.expiringSoon.length ? (
                <p className="text-xs text-muted-foreground">
                  Showing the {data.expiringSoon.length} most urgent of {expiringTotal} expiring licenses — open the Licenses tab for the full list.
                </p>
              ) : null}
              {data.expiringSoon.map((l) => (
                <div key={l.id} className="row-hover flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.orgName}</p>
                    <p className="text-xs text-muted-foreground">
                      {PLAN_LABELS[l.plan] ?? l.plan} plan · expires {fmtDateShort(l.expiresAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <LicenseStatusBadge status={l.status} />
                    <DaysLeftBadge daysLeft={l.daysLeft} />
                    <Button size="sm" variant="outline" onClick={() => setRenewTarget(l)}>
                      Renew…
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onOpenLicense(l.id)}>
                      Manage
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <RenewDialog license={renewTarget} onClosed={() => setRenewTarget(null)} />
    </div>
  );
}

/**
 * Renewal dialog — keyed by license id so every open starts with a clean form.
 * Requires a PO/invoice reference (≥3 chars) which is stored on the audit
 * trail, and shows the computed total + new expiry before confirming.
 */
function RenewDialog({ license, onClosed }: { license: ExpiringLicense | null; onClosed: () => void }) {
  return (
    <Dialog open={!!license} onOpenChange={(o) => { if (!o) onClosed(); }}>
      <DialogContent className="max-w-md">
        {license ? <RenewForm key={license.id} license={license} onClosed={onClosed} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RenewForm({ license, onClosed }: { license: ExpiringLicense; onClosed: () => void }) {
  const queryClient = useQueryClient();
  // Plan catalog — authoritative per-month pricing, never hardcoded in the UI.
  const { data: plansData } = useApiQuery<{ plans: PartnerPlan[] }>(["partner", "plans"], "/partner/plans");
  const [months, setMonths] = useState(12);
  const [poRef, setPoRef] = useState("");
  const [busy, setBusy] = useState(false);

  const plan = plansData?.plans.find((p) => p.key === license.plan);
  const monthly = plan?.monthlyPriceCents;
  const total = monthly != null ? monthly * months : null;
  const planLabel = plan?.label ?? PLAN_LABELS[license.plan] ?? license.plan;

  const ref = poRef.trim();
  const refValid = ref.length >= 3 && ref.length <= 100;
  const refInvalid = ref.length > 0 && !refValid;

  // New term starts from the later of "today" and the current expiry.
  const base = Math.max(new Date(license.expiresAt).getTime(), Date.now());
  const newExpiry = new Date(base + months * 30 * 86400000);

  async function renew() {
    setBusy(true);
    try {
      await api.patch(`/partner/licenses/${license.id}`, {
        extendMonths: months,
        statusReason: `Renewal — ref ${ref}`,
        // Optimistic concurrency: without the row's token the server rejects
        // every PATCH whose license carries an updatedAt (409 stale_write).
        expectedUpdatedAt: license.updatedAt ?? null,
      });
      toast.success(`Renewed ${license.orgName} by ${months} months.`);
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
      onClosed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Renewal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4" /> Renew license
        </DialogTitle>
        <DialogDescription>
          Extend <span className="font-medium">{license.orgName}</span> — the new term runs from the later of today and the current expiry.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="renew-term">Term</Label>
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger id="renew-term"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TERM_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} month{m > 1 ? "s" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {monthly != null
              ? `${fmtMoney(monthly)}/mo · ${months} month${months > 1 ? "s" : ""} = ${fmtMoney(total)}`
              : "Plan price unavailable — the renewal proceeds at the license's current rate."}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="renew-po-ref">PO or invoice reference *</Label>
          <Input
            id="renew-po-ref"
            value={poRef}
            onChange={(e) => setPoRef(e.target.value)}
            minLength={3}
            maxLength={100}
            placeholder="e.g. PO #2026-114"
            aria-invalid={refInvalid}
          />
          <p
            className={cn("text-xs", refInvalid ? "text-danger" : "text-muted-foreground")}
            role={refInvalid ? "alert" : undefined}
          >
            Required — recorded on the audit trail with the renewal.
          </p>
        </div>

        <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
          {license.orgName} · {planLabel} · extends to {fmtDate(newExpiry)} · total {fmtMoney(total)}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClosed} disabled={busy}>Cancel</Button>
        <Button onClick={renew} disabled={!refValid || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Confirm renewal
        </Button>
      </DialogFooter>
    </>
  );
}
