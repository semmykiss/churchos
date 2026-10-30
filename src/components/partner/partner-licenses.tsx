"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtMoney, fmtDateShort } from "@/lib/types";
import type { PartnerLicenseRow } from "@/lib/types";
import { LoadingBlock, ErrorBlock, PageHeader, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LicenseStatusBadge, DaysLeftBadge, PLAN_LABELS, LICENSE_STATUS_LABELS } from "@/components/partner/partner-shared";

export default function PartnerLicenses({ onManage }: { onManage: (licenseId: string) => void }) {
  const { data, isLoading, error } = useApiQuery<PartnerLicenseRow[]>(["partner", "licenses"], "/partner/licenses");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Licenses"
        description="Every license you have issued — renew, upgrade, or cut off access. Enforcement happens the moment a church user signs in."
      />

      {isLoading ? (
        <LoadingBlock label="Loading licenses…" />
      ) : error ? (
        <ErrorBlock error={error} />
      ) : (
        <div className="rounded-lg border">
          <div className="max-h-[62vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>License key</TableHead>
                  <TableHead>Church</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Price / mo</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.key}</TableCell>
                    <TableCell className="font-medium">{l.orgName}</TableCell>
                    <TableCell>{PLAN_LABELS[l.plan] ?? l.plan}</TableCell>
                    <TableCell><LicenseStatusBadge status={l.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{fmtDateShort(l.expiresAt)}</span>
                        <DaysLeftBadge daysLeft={l.daysLeft} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(l.monthlyPriceCents)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => onManage(l.id)}>
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No licenses yet — onboard a church from the Tenants tab.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Manage-license dialog — rendered once by the partner root; openable from the
 * Overview (expiring list), Tenants detail and the Licenses table.
 */
export function LicenseManageDialog({ licenseId, onClosed }: { licenseId: string | null; onClosed: () => void }) {
  const queryClient = useQueryClient();
  const { data: licenses } = useApiQuery<PartnerLicenseRow[]>(["partner", "licenses"], "/partner/licenses", {
    enabled: !!licenseId,
  });
  const license = licenses?.find((l) => l.id === licenseId) ?? null;

  const [plan, setPlan] = useState("");
  const [seats, setSeats] = useState("");
  const [status, setStatus] = useState("");
  const [extendMonths, setExtendMonths] = useState("0");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);

  if (license && initializedFor !== license.id) {
    setInitializedFor(license.id);
    setPlan(license.plan);
    setSeats(String(license.seats));
    setStatus(license.status);
    setNotes(license.notes ?? "");
    setExtendMonths("0");
  }

  async function save() {
    if (!license) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { plan, seats: Number(seats), status, notes };
      if (extendMonths !== "0") body.extendMonths = Number(extendMonths);
      await api.patch(`/partner/licenses/${license.id}`, body);
      toast.success("License updated.");
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
      onClosed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!licenseId} onOpenChange={(open) => { if (!open) onClosed(); }}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Manage license
          </DialogTitle>
          {license ? (
            <DialogDescription>
              <span className="font-mono text-xs">{license.key}</span> · {license.orgName}
            </DialogDescription>
          ) : (
            <DialogDescription>Loading license details…</DialogDescription>
          )}
        </DialogHeader>
        {license ? (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Plan</Label>
                  <Select value={plan} onValueChange={setPlan}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PLAN_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Seats</Label>
                  <Input type="number" min={1} max={10000} value={seats} onChange={(e) => setSeats(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(LICENSE_STATUS_LABELS)
                        .filter(([value]) => value !== "none")
                        .map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Extend from today</Label>
                  <Select value={extendMonths} onValueChange={setExtendMonths}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No extension</SelectItem>
                      <SelectItem value="1">1 month</SelectItem>
                      <SelectItem value="12">12 months</SelectItem>
                      <SelectItem value="24">24 months</SelectItem>
                      <SelectItem value="36">36 months</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. PO #2026-114, annual invoice sent" />
              </div>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Expires {fmtDateShort(license.expiresAt)} · {fmtMoney(license.monthlyPriceCents)}/mo ·{" "}
                {license.status === "active" || license.status === "trial"
                  ? "church sign-in currently allowed."
                  : "church sign-in currently BLOCKED until this license is active again."}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClosed} disabled={busy}>Cancel</Button>
              <Button onClick={save} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save changes
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="py-8"><LoadingBlock label="Loading license…" /></div>
        )}
      </DialogContent>
    </Dialog>
  );
}
