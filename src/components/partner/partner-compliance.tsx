"use client";

/**
 * PartnerCompliance: review queue for pending_verification tenants. Every
 * decision goes through ConfirmActionDialog with a reason. Identifiers arrive
 * masked from the server. Documents open via short-lived signed URLs. The
 * server re-checks every rule. This UI is never the gate.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShieldCheck, ShieldAlert, FileText, Check, X, RefreshCw, Globe, Users, Landmark,
  Scale, ExternalLink, History, Undo2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fmtDateShort, fmtDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApiQuery, ErrorBlock, LoadingBlock, EmptyState } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmActionDialog } from "@/components/partner/confirm-action-dialog";

interface ChecklistItem { key: string; label: string; done: boolean }

interface BypassInfo { at: string; by: string; reason: string; waived: string[] }

interface QueueRow {
  id: string; name: string; legalName: string | null; url: string; cacNumber: string | null;
  state: string | null; lga: string | null; trusteeCount: number; createdAt: string;
  checklist: ChecklistItem[]; readyForReview: boolean; bypassed: boolean; bypassInfo: BypassInfo | null;
}

interface QueueResponse { pending: QueueRow[]; recentlyVerified: QueueRow[]; bypassEnabled: boolean }

interface Detail {
  id: string; name: string; legalName: string | null; url: string; denomination: string | null;
  cac: { number: string | null; date: string | null; certificateFileId: string | null };
  tin: string | null; // masked by the server (e.g. "••••••4821")
  scumlNumber: string | null; // masked by the server
  registeredAddress: { line1: string | null; lga: string | null; state: string | null };
  worshipCampus: { address: string | null } | null;
  headPastor: { name: string | null; ninMasked: string | null }; // phone/email intentionally omitted server-side
  banking: { bankName: string | null; accountName: string | null; accountNumberMasked: string | null };
  ndpa: { acknowledgedAt: string | null; dpaVersion: string | null };
  owner: { name: string | null; email: string } | null;
  trustees: {
    id: string; fullName: string; role: string | null; idType: string | null;
    idNumberMasked: string | null; idDocumentFileId: string | null; residentialAddress: string | null;
  }[];
  checklist: ChecklistItem[];
  readyForReview: boolean;
  audit: { step: string; at: string }[];
}

type DecisionKind = "verify" | "bypass" | "request";

interface ChecklistHolder { name: string; checklist: ChecklistItem[] }

interface DecisionConfig {
  endpoint: string;
  tone: "default" | "warning";
  title: (n: string) => string;
  description: string;
  confirmLabel: string;
  impacts: (target: ChecklistHolder) => string[];
  reason?: { label: string; minLength: number; placeholder?: string };
  acknowledgement?: string;
  success: (n: string) => string;
}

const DECISIONS: Record<DecisionKind, DecisionConfig> = {
  verify: {
    endpoint: "verify",
    tone: "default",
    title: (n) => `Verify & activate ${n}`,
    description: "Confirm you checked the CAC certificate, trustee identities and registered address against source documents.",
    confirmLabel: "Verify & activate",
    impacts: () => [
      "The church becomes active immediately",
      "Online giving stays locked until a settlement bank account is on file",
      "Your verification is recorded on the audit trail",
    ],
    acknowledgement: "I personally reviewed these documents and the trustee identities.",
    success: (n) => `${n} verified and activated.`,
  },
  bypass: {
    endpoint: "bypass-verify",
    tone: "warning",
    title: (n) => `Bypass compliance for ${n}`,
    description: "Activates the church even though checks are unmet. Intended for small churches still gathering documents, and for demo tenants.",
    confirmLabel: "Bypass & activate",
    impacts: (target) => {
      const open = target.checklist.filter((c) => !c.done);
      return open.length
        ? open.map((c) => `Waived: ${c.label}`)
        : ["Every checklist item is complete. A bypass is not needed."];
    },
    reason: {
      label: "Reason for bypassing",
      minLength: 20,
      placeholder: "e.g. Demo tenant for the sales walkthrough. Real CAC documents do not exist.",
    },
    acknowledgement: "I understand this activates the church with the checks above unverified.",
    success: (n) => `${n} activated with compliance waived. Recorded on the audit trail.`,
  },
  request: {
    endpoint: "request-changes",
    tone: "default",
    title: (n) => `Request changes from ${n}`,
    description: "The church stays in the queue and receives your note.",
    confirmLabel: "Send request",
    impacts: () => ["Status stays pending verification", "The church owner is notified"],
    reason: { label: "What the church needs to fix", minLength: 10 },
    success: (n) => `Change request sent to ${n}.`,
  },
};

function CheckPill({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
      done ? "border-success/30 bg-success/10 text-success" : "border-warning/40 bg-warning-bg text-warning",
    )}>
      {done ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />} {label}
    </span>
  );
}

export function PartnerCompliance() {
  const qc = useQueryClient();
  const queue = useApiQuery<QueueResponse>(["partner", "compliance", "queue"], "/partner/compliance/queue");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ kind: DecisionKind; target: ChecklistHolder & { id: string } } | null>(null);
  const [busy, setBusy] = useState(false);

  // The detail query is disabled until an id is picked, so it never falls back
  // to the queue URL and never poisons `d` with stale data from another row.
  const detail = useApiQuery<Detail>(
    ["partner", "compliance", "detail", detailId ?? ""],
    `/partner/compliance/${detailId ?? ""}`,
    { enabled: !!detailId },
  );
  const d = detailId && detail.data?.id === detailId ? detail.data : null;

  // Narrowed local — keeps non-null assertions out of the JSX below.
  const certificateFileId = d?.cac.certificateFileId ?? null;

  // Server decides whether bypass exists (env-gated). The UI never assumes it.
  const bypassEnabled = queue.data?.bypassEnabled ?? false;

  function decide(kind: DecisionKind, target: ChecklistHolder & { id: string }) {
    setDecision({ kind, target });
  }

  async function runDecision(reason: string) {
    if (!decision) return;
    const target = decision.target;
    const cfg = DECISIONS[decision.kind];
    setBusy(true);
    try {
      await api.post(
        `/partner/compliance/${target.id}/${cfg.endpoint}`,
        cfg.reason ? { reason } : { attested: true },
      );
      toast.success(cfg.success(target.name));
      setDecision(null);
      setDetailId(null);
      await qc.invalidateQueries({ queryKey: ["partner"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(fileId: string) {
    try {
      const res = await api.get<{ url: string; expiresAt: string }>(`/partner/compliance/documents/${fileId}/url`);
      // NOTE: the "noopener,noreferrer" features would make window.open return
      // null even on SUCCESS (per the HTML spec), so a null check there would
      // false-positive every time. Open without the features and sever the
      // opener link manually — same reverse-tabnabbing protection, and a null
      // return then genuinely means the pop-up was blocked.
      const win = window.open(res.url, "_blank");
      if (win) {
        win.opener = null;
      } else {
        toast.error("Your browser blocked the document window. Allow pop-ups for this site.");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open the document.");
    }
  }

  if (queue.isLoading) return <LoadingBlock label="Loading compliance queue…" />;
  if (queue.error) return <ErrorBlock error={queue.error} />;

  const pending = queue.data?.pending ?? [];
  const verified = queue.data?.recentlyVerified ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Compliance review queue
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Self-signup churches stay pending until CAC details, trustees and documents are verified.
          Features other than online giving are already live.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Pending verification ({pending.length})</CardTitle>
            <CardDescription>Oldest first.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ["partner"] })}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Queue is clear" description="No churches are waiting for verification right now." />
          ) : pending.map((t) => (
            <div key={t.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {t.name}
                    {t.readyForReview
                      ? <Badge variant="outline" className="border-success/40 text-success">Ready for review</Badge>
                      : <Badge variant="outline" className="border-warning/50 text-warning">Incomplete</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t.legalName ?? "—"} · {t.cacNumber ?? "no CAC number"} · {t.state ?? "—"}{t.lga ? ` / ${t.lga}` : ""} ·{" "}
                    {t.trusteeCount} trustee(s) · submitted {fmtDateShort(t.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDetailId(t.id)}>
                    <FileText className="h-4 w-4" aria-hidden /> Review
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => decide("request", t)}>
                    <Undo2 className="h-4 w-4" aria-hidden /> Request changes
                  </Button>
                  {t.readyForReview ? (
                    <Button size="sm" onClick={() => decide("verify", t)}>
                      <ShieldCheck className="h-4 w-4" aria-hidden /> Verify &amp; activate
                    </Button>
                  ) : bypassEnabled ? (
                    <Button
                      variant="outline" size="sm"
                      className="border-warning/50 text-warning hover:bg-warning/10"
                      onClick={() => decide("bypass", t)}
                    >
                      <ShieldAlert className="h-4 w-4" aria-hidden /> Bypass
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.checklist.map((c) => <CheckPill key={c.key} done={c.done} label={c.label} />)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {verified.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently verified</CardTitle>
            <CardDescription>Self-signup churches activated by the compliance team.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {verified.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {t.name}
                    {t.bypassed ? <Badge variant="outline" className="border-warning/50 text-warning">bypass</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.url}
                    {t.bypassed && t.bypassInfo ? ` · waived: ${t.bypassInfo.waived.join(", ") || "none"} · by ${t.bypassInfo.by}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="border-success/40 text-success">active</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Review dialog — the decision confirm dialog renders as its sibling at
          the tree root below, so it always stacks on top, never nests inside. */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-2xl">
          {!d ? (
            detail.error ? <ErrorBlock error={detail.error} /> : <LoadingBlock label="Loading church dossier…" />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {d.name}
                  <Badge variant="outline" className="border-warning/50 text-warning">pending verification</Badge>
                </DialogTitle>
                <DialogDescription>
                  {d.legalName ?? "—"} · {d.denomination ?? "—"} · {d.url}
                </DialogDescription>
              </DialogHeader>

              <ScrollArea className="max-h-[62vh] pr-3">
                <div className="space-y-4 text-sm">
                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium">
                      <Scale className="h-4 w-4 text-primary" aria-hidden /> CAC and regulatory
                    </p>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border p-3 sm:grid-cols-2">
                      <dt className="text-muted-foreground">CAC number</dt>
                      <dd className="text-foreground">{d.cac.number ?? "—"}</dd>
                      <dt className="text-muted-foreground">Registration date</dt>
                      <dd className="text-foreground">{fmtDateShort(d.cac.date)}</dd>
                      <dt className="text-muted-foreground">TIN</dt>
                      <dd className="tabular-nums text-foreground">{d.tin ?? "—"}</dd>
                      <dt className="text-muted-foreground">SCUML</dt>
                      <dd className="text-foreground">{d.scumlNumber ?? "—"}</dd>
                      <dt className="text-muted-foreground">Certificate</dt>
                      <dd className="text-foreground">
                        {certificateFileId ? (
                          <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void openDocument(certificateFileId)}>
                            <ExternalLink className="h-3 w-3" aria-hidden /> Open document
                          </Button>
                        ) : "Not uploaded"}
                      </dd>
                    </dl>
                  </section>

                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium">
                      <Users className="h-4 w-4 text-primary" aria-hidden /> Trustees ({d.trustees.length})
                    </p>
                    {d.trustees.length === 0 ? (
                      <p className="rounded-lg border p-3 text-xs text-muted-foreground">No trustees on file.</p>
                    ) : (
                      <div className="space-y-2">
                        {d.trustees.map((t) => {
                          // Narrowed local — no non-null assertion in the JSX.
                          const idDocumentFileId = t.idDocumentFileId;
                          return (
                            <div key={t.id} className="rounded-lg border p-3">
                              <p className="font-medium">
                                {t.fullName} <span className="font-normal text-muted-foreground">· {t.role ?? "Trustee"}</span>
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {t.idType ? t.idType.replace(/_/g, " ") : "no ID type"} · {t.idNumberMasked ?? "no ID number"}
                                {idDocumentFileId ? (
                                  <Button variant="outline" size="sm" className="ml-2 h-6 gap-1 px-2 text-xs" onClick={() => void openDocument(idDocumentFileId)}>
                                    <ExternalLink className="h-3 w-3" aria-hidden /> ID document
                                  </Button>
                                ) : null}
                              </p>
                              {t.residentialAddress ? <p className="mt-1 text-xs text-muted-foreground">{t.residentialAddress}</p> : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium">
                      <Globe className="h-4 w-4 text-primary" aria-hidden /> Addresses and leadership
                    </p>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border p-3 sm:grid-cols-2">
                      <dt className="text-muted-foreground">Registered</dt>
                      <dd className="text-foreground">
                        {[d.registeredAddress.line1, d.registeredAddress.lga, d.registeredAddress.state].filter(Boolean).join(", ") || "—"}
                      </dd>
                      <dt className="text-muted-foreground">Worship site</dt>
                      <dd className="text-foreground">{d.worshipCampus?.address ?? "Same as registered"}</dd>
                      <dt className="text-muted-foreground">Head pastor</dt>
                      <dd className="text-foreground">
                        {d.headPastor.name ?? "—"}{d.headPastor.ninMasked ? ` · NIN ${d.headPastor.ninMasked}` : ""}
                      </dd>
                      <dt className="text-muted-foreground">Owner</dt>
                      <dd className="text-foreground">
                        {d.owner ? (d.owner.name ? `${d.owner.name} · ${d.owner.email}` : d.owner.email) : "—"}
                      </dd>
                    </dl>
                  </section>

                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium">
                      <Landmark className="h-4 w-4 text-primary" aria-hidden /> Banking and consent
                    </p>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border p-3 sm:grid-cols-2">
                      <dt className="text-muted-foreground">Bank</dt>
                      <dd className="text-foreground">{d.banking.bankName ?? "—"}</dd>
                      <dt className="text-muted-foreground">Account</dt>
                      <dd className="text-foreground">
                        {d.banking.accountName ?? "—"}{d.banking.accountNumberMasked ? ` · ${d.banking.accountNumberMasked}` : ""}
                      </dd>
                      <dt className="text-muted-foreground">Data processing</dt>
                      <dd className="text-foreground">
                        {d.ndpa.acknowledgedAt
                          ? `Accepted ${fmtDateShort(d.ndpa.acknowledgedAt)} (DPA ${d.ndpa.dpaVersion ?? "—"})`
                          : "Not accepted"}
                      </dd>
                    </dl>
                  </section>

                  <Separator />

                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium">
                      <History className="h-4 w-4 text-primary" aria-hidden /> Onboarding audit trail
                    </p>
                    {d.audit.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No onboarding events recorded yet.</p>
                    ) : (
                      <ol className="space-y-1.5">
                        {d.audit.map((a, i) => (
                          <li key={`${a.step}-${a.at}-${i}`} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary/60" aria-hidden />
                            <code className="rounded bg-muted px-1.5 py-0.5">{a.step.replace(/_/g, " ")}</code>
                            <span>{fmtDateTime(a.at)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </div>
              </ScrollArea>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Identifiers are masked. Every document view is logged.
                </p>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => decide("request", d)}>
                    <Undo2 className="h-4 w-4" aria-hidden /> Request changes
                  </Button>
                  {!d.readyForReview && bypassEnabled ? (
                    <Button
                      variant="outline" size="sm"
                      className="border-warning/50 text-warning hover:bg-warning/10"
                      onClick={() => decide("bypass", d)}
                    >
                      <ShieldAlert className="h-4 w-4" aria-hidden /> Bypass
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={!d.readyForReview} onClick={() => decide("verify", d)}>
                    <ShieldCheck className="h-4 w-4" aria-hidden /> Verify &amp; activate
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Single decision dialog for every action (verify / bypass / request).
          Rendered at the tree root — on top of the review dialog, never inside it. */}
      <ConfirmActionDialog
        open={!!decision}
        onOpenChange={(o) => { if (!o) setDecision(null); }}
        tone={decision ? DECISIONS[decision.kind].tone : "default"}
        title={decision ? DECISIONS[decision.kind].title(decision.target.name) : ""}
        description={decision ? DECISIONS[decision.kind].description : ""}
        impacts={decision ? DECISIONS[decision.kind].impacts(decision.target) : []}
        confirmLabel={decision ? DECISIONS[decision.kind].confirmLabel : ""}
        reason={decision ? DECISIONS[decision.kind].reason : undefined}
        acknowledgement={decision ? DECISIONS[decision.kind].acknowledgement : undefined}
        busy={busy}
        onConfirm={runDecision}
      />
    </div>
  );
}
