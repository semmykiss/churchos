"use client";

/**
 * Partner licenses list + manage-license dialog (security-audit upgrade, task 3-b):
 * - The dialog is keyed by licenseId, so every open mounts a FRESH editor —
 *   fixes the stale-edit bug where fields kept the previously opened license's
 *   values (the old `initializedFor` render-phase setState is gone).
 * - Saves use optimistic concurrency (`expectedUpdatedAt`); a 409 "stale_write"
 *   keeps the dialog open and reloads fresh data instead of overwriting.
 * - Destructive status changes (suspended / cancelled) require a typed reason
 *   via ConfirmActionDialog; cancelling additionally requires an acknowledgement.
 * - The license key is always displayed MASKED (the server masks list/detail
 *   responses). Revealing the full key goes through the audited
 *   `POST /partner/licenses/:id/reveal-key` endpoint and is copied straight to
 *   the clipboard — the full key is never rendered into the DOM.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { fmtMoney, fmtDateShort } from "@/lib/types";
import type { PartnerLicensePage } from "@/lib/types";
import { LoadingBlock, ErrorBlock, PageHeader, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  LicenseStatusBadge, DaysLeftBadge, PLAN_LABELS, LICENSE_STATUS_LABELS,
} from "@/components/partner/partner-shared";
import { ConfirmActionDialog } from "@/components/partner/confirm-action-dialog";

const SEATS_MAX = 10000;
const EXTEND_OPTIONS = [0, 1, 12, 24, 36];
/** Statuses that still allow church sign-in. */
const ACCESS_ALLOWED = new Set(["trial", "active"]);
/** Status changes that block every church user — always require a typed reason. */
const DESTRUCTIVE_STATUSES = new Set(["suspended", "cancelled"]);

export default function PartnerLicenses({ onManage }: { onManage: (licenseId: string) => void }) {
  const { data, isLoading, error } = useApiQuery<PartnerLicensePage>(["partner", "licenses"], "/partner/licenses");

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
                {(data?.rows ?? []).map((l) => (
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
                {(data?.rows ?? []).length === 0 ? (
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
 * Keyed by licenseId: closing unmounts the editor, so no state survives
 * between opens and there is no render-phase state sync.
 */
export function LicenseManageDialog({ licenseId, onClosed }: { licenseId: string | null; onClosed: () => void }) {
  return (
    <Dialog open={!!licenseId} onOpenChange={(o) => { if (!o) onClosed(); }}>
      <DialogContent className="max-w-lg">
        {licenseId ? <LicenseEditor key={licenseId} licenseId={licenseId} onClosed={onClosed} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Loads a single license by id and hands it to the editor fields. */
function LicenseEditor({ licenseId, onClosed }: { licenseId: string; onClosed: () => void }) {
  const { data: license, isLoading, error } = useApiQuery<PartnerLicenseRow>(
    ["partner", "license", licenseId],
    `/partner/licenses/${licenseId}`
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Manage license
        </DialogTitle>
        <DialogDescription>
          {license ? (
            <>
              <span className="font-mono text-xs">{license.key}</span> · {license.orgName}
            </>
          ) : (
            "Loading license details…"
          )}
        </DialogDescription>
      </DialogHeader>
      {isLoading ? (
        <div className="py-8"><LoadingBlock label="Loading license…" /></div>
      ) : error ? (
        <ErrorBlock error={error} />
      ) : license ? (
        // Keyed by id + updatedAt: after a 409 stale_write the invalidated
        // query returns a fresh snapshot with a new token, which remounts
        // LicenseFields with clean state — the form can never keep re-submitting
        // the stale pre-409 values (LicenseFields only initializes from props
        // once, so a plain re-render would loop 409s forever).
        <LicenseFields key={`${license.id}:${license.updatedAt ?? "init"}`} license={license} onClosed={onClosed} />
      ) : null}
    </>
  );
}

function LicenseFields({ license, onClosed }: { license: PartnerLicenseRow; onClosed: () => void }) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState(license.plan);
  const [seats, setSeats] = useState(String(license.seats));
  const [status, setStatus] = useState(license.status);
  const [extend, setExtend] = useState(0);
  const [notes, setNotes] = useState(license.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const seatsNum = Number(seats);
  const seatsValid = Number.isInteger(seatsNum) && seatsNum >= 1 && seatsNum <= SEATS_MAX;
  const dirty =
    plan !== license.plan ||
    seatsNum !== license.seats ||
    status !== license.status ||
    (notes.trim() || null) !== (license.notes ?? null) ||
    extend > 0;
  const needsConfirm = status !== license.status && DESTRUCTIVE_STATUSES.has(status);

  async function persist(statusReason?: string) {
    setBusy(true);
    try {
      await api.patch<PartnerLicenseRow>(`/partner/licenses/${license.id}`, {
        plan,
        seats: seatsNum,
        status,
        notes: notes.trim() || null,
        ...(extend > 0 ? { extendMonths: extend } : {}),
        ...(statusReason ? { statusReason } : {}),
        expectedUpdatedAt: license.updatedAt ?? null,
      });
      toast.success("License updated.");
      await queryClient.invalidateQueries({ queryKey: ["partner"] });
      await queryClient.invalidateQueries({ queryKey: ["partner", "license", license.id] });
      onClosed();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === "stale_write") {
        // Lost a race with another editor — reload fresh data and keep the dialog open.
        toast.error("This license changed elsewhere while you were editing. The dialog will reload.");
        void queryClient.invalidateQueries({ queryKey: ["partner", "license", license.id] });
      } else {
        toast.error(err instanceof Error ? err.message : "Update failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (needsConfirm) setConfirmOpen(true);
    else void persist();
  }

  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lic-plan">Plan</Label>
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger id="lic-plan"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PLAN_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="license-seats">Seats</Label>
            <Input
              id="license-seats"
              type="number"
              min={1}
              max={SEATS_MAX}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              aria-invalid={!seatsValid}
            />
            <p
              className={cn("text-xs", seatsValid ? "text-muted-foreground" : "text-danger")}
              role={seatsValid ? undefined : "alert"}
            >
              Enter a whole number from 1 to 10,000.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lic-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="lic-status"><SelectValue /></SelectTrigger>
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
            <Label htmlFor="lic-extend">Extend from today</Label>
            <Select value={String(extend)} onValueChange={(v) => setExtend(Number(v))}>
              <SelectTrigger id="lic-extend"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXTEND_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m === 0 ? "No extension" : `${m} month${m > 1 ? "s" : ""}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="license-notes">Internal notes</Label>
          <Textarea
            id="license-notes"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. PO #2026-114, annual invoice sent"
          />
        </div>
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Current term ends {fmtDateShort(license.expiresAt)} · {fmtMoney(license.monthlyPriceCents)}/mo ·{" "}
          {ACCESS_ALLOWED.has(license.status)
            ? "church sign-in is currently allowed."
            : "church sign-in is currently blocked until this license is active again."}
        </p>
      </div>

      <RevealKeyRow licenseId={license.id} maskedKey={license.key} />

      <DialogFooter>
        <Button variant="outline" onClick={onClosed} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={!dirty || !seatsValid || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save changes
        </Button>
      </DialogFooter>

      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="destructive"
        title={`Set license to ${LICENSE_STATUS_LABELS[status] ?? status}?`}
        description={
          <>
            <span className="font-medium">{license.orgName}</span> will be blocked at their next sign-in.
          </>
        }
        impacts={[
          "Every user at this church loses access until the license is reactivated",
          "The reason is stored on the partner and organization audit trails",
          ...(status === "cancelled"
            ? ["Cancellation is treated as final. Confirm this is intended."]
            : []),
        ]}
        confirmLabel="Apply status change"
        reason={{ label: "Reason", minLength: 10, placeholder: "e.g. Invoice unpaid after 60 days" }}
        acknowledgement={
          status === "cancelled"
            ? "I understand cancellation is final and sign-in is permanently blocked."
            : undefined
        }
        busy={busy}
        onConfirm={(reason) => persist(reason)}
      />
    </>
  );
}

/**
 * Masked key + audited reveal. The full key is fetched, written straight to the
 * clipboard and discarded — it is never stored in state nor rendered anywhere.
 */
function RevealKeyRow({ licenseId, maskedKey }: { licenseId: string; maskedKey: string }) {
  const [busy, setBusy] = useState(false);

  async function revealAndCopy() {
    setBusy(true);
    try {
      const { key } = await api.post<{ key: string }>(`/partner/licenses/${licenseId}/reveal-key`);
      try {
        await navigator.clipboard.writeText(key);
        toast.success("Full key copied — this reveal was recorded on the audit trail.");
      } catch {
        // Clipboard blocked: never fall back to rendering the key — keep it secret.
        toast.error("Clipboard unavailable — the reveal was recorded, but the key was not copied.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reveal the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">License key</p>
        <p className="truncate font-mono text-xs" title={maskedKey}>{maskedKey}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={revealAndCopy}
        disabled={busy}
        aria-label="Reveal and copy the full license key"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        Reveal &amp; copy
      </Button>
    </div>
  );
}
