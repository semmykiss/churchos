"use client";

import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtMoney, fmtDateShort } from "@/lib/types";
import type { PartnerOverview } from "@/lib/types";
import { LoadingBlock, ErrorBlock, EmptyState, PageHeader, StatCard, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LicenseStatusBadge, DaysLeftBadge, PLAN_LABELS } from "@/components/partner/partner-shared";
import { Building2, KeyRound, CalendarClock, TrendingUp, Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function PartnerOverview({ onOpenLicense }: { onOpenLicense: (licenseId: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, isFetching, refetch } = useApiQuery<PartnerOverview>(["partner", "overview"], "/partner/overview");

  async function quickRenew(licenseId: string, months: number) {
    try {
      await api.patch(`/partner/licenses/${licenseId}`, { extendMonths: months });
      toast.success(`Renewed for ${months} month${months > 1 ? "s" : ""}.`);
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Renewal failed.");
    }
  }

  if (isLoading) return <LoadingBlock label="Loading partner overview…" />;
  if (error || !data) return <ErrorBlock error={error} />;

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
        <StatCard label="Church tenants" value={data.tenants.total} sub={`${data.tenants.active} active${data.tenants.pending ? ` · ${data.tenants.pending} pending review` : ""}${data.tenants.suspended ? ` · ${data.tenants.suspended} suspended` : ""}`} icon={Building2} />
        <StatCard label="Active licenses" value={data.licenses.active} sub={`${data.licenses.trial} trials · ${data.licenses.pastDue} past due`} icon={KeyRound} tone="positive" />
        <StatCard label="Est. MRR" value={fmtMoney(data.mrrCents)} sub="from active licenses" icon={TrendingUp} tone="positive" />
        <StatCard label="Expiring ≤14 days" value={data.expiringSoon.length} sub="renew or they lose access" icon={CalendarClock} tone={data.expiringSoon.length > 0 ? "warning" : "default"} />
        <StatCard label="Total people records" value={data.totalPeople} sub="across all tenants" icon={Users} />
        <StatCard label="User accounts" value={data.totalUsers} sub="across all tenants" icon={Users} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Licenses expiring soon</CardTitle>
          <CardDescription>Churches whose access stops when the clock runs out — renew before Sunday.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.expiringSoon.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing expiring in the next 14 days" description="All active licenses have runway." />
          ) : (
            <div className="space-y-2">
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
                    <Button size="sm" variant="outline" onClick={() => quickRenew(l.id, 12)}>
                      Renew 12m
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
    </div>
  );
}
