"use client";

/**
 * PartnerCompliance — the compliance review queue for pending_verification
 * tenants (tenant onboarding spec §8). Human review of CAC details, trustees,
 * and documents; "Verify & activate" flips the tenant to active (which also
 * unlocks online giving once banking is on file). Every action is audit-logged
 * server-side. Sensitive identifiers are shown masked only.
 */
import { useState } from "react";
import { useApiQuery, ErrorBlock, LoadingBlock, EmptyState } from "@/components/app/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, ShieldAlert, FileText, Check, X, RefreshCw, Globe, Users, Landmark,
  Scale, Loader2, ExternalLink, History,
} from "lucide-react";

interface QueueRow {
  id: string; name: string; legalName: string | null; subdomain: string; url: string;
  status: string; denomination: string | null; cacNumber: string | null;
  cacRegistrationDate: string | null; certificateUploaded: boolean; trusteeCount: number;
  state: string | null; lga: string | null; estimate: number | null; plan: string;
  licenseStatus: string; createdAt: string;
  checklist: { key: string; label: string; done: boolean }[];
  readyForReview: boolean;
}

interface Detail {
  id: string; name: string; legalName: string | null; subdomain: string; url: string; status: string;
  denomination: string | null; foundedOn: string | null;
  cac: { number: string | null; date: string | null; certificateFileId: string | null };
  tin: string | null; scumlNumber: string | null;
  registeredAddress: { line1: string | null; line2: string | null; state: string | null; lga: string | null; country: string };
  worshipCampus: { name: string; address: string | null; region: string | null } | null;
  headPastor: { name: string | null; phone: string | null; email: string | null; ninMasked: string | null };
  banking: { bankName: string | null; accountName: string | null; accountNumberMasked: string | null };
  ndpa: { acknowledgedAt: string | null; acknowledgedBy: string | null; dpaVersion: string | null };
  memberCountEstimate: number | null;
  license: { plan: string; status: string; expiresAt: string; seats: number } | null;
  owner: { name: string | null; email: string; lastLoginAt: string | null } | null;
  trustees: { id: string; fullName: string; role: string | null; phone: string | null; email: string | null; residentialAddress: string | null; idType: string | null; idNumberMasked: string | null; idDocumentFileId: string | null }[];
  checklist: { key: string; label: string; done: boolean }[];
  readyForReview: boolean;
  audit: { step: string; at: string; snapshot: unknown }[];
}

function CheckPill({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
      done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900",
    )}>
      {done ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {label}
    </span>
  );
}

export function PartnerCompliance() {
  const queue = useApiQuery<{ pending: QueueRow[]; recentlyVerified: QueueRow[] }>(["partner-compliance"], "/partner/compliance/queue");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const detail = useApiQuery<Detail>(["partner-compliance", detailId], detailId ? `/partner/compliance/${detailId}` : "/partner/compliance/queue", { enabled: !!detailId });

  async function verify(id: string) {
    setVerifying(true);
    try {
      await api.post(`/partner/compliance/${id}/verify`);
      toast.success("Church verified and activated — online giving unlocks once banking is on file.");
      setDetailId(null);
      await queue.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
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
          <ShieldCheck className="h-5 w-5 text-primary" /> Compliance review queue
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Self-signup churches start as <code>pending_verification</code> — verify CAC details, trustees and documents, then activate. CAC registry lookup is a human process.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Pending verification ({pending.length})</CardTitle>
            <CardDescription>Oldest first. Features except online giving are already live for these churches.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => queue.refetch()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Queue is clear" description="No churches are waiting for verification right now." />
          ) : pending.map((t) => (
            <div key={t.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {t.name}
                    {t.readyForReview
                      ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Ready for review</Badge>
                      : <Badge variant="outline" className="border-amber-300 text-amber-900">Incomplete</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t.legalName ?? "—"} · {t.cacNumber ?? "no CAC number"} · {t.state ?? "—"}{t.lga ? ` / ${t.lga}` : ""} · {t.trusteeCount} trustee(s) · submitted {new Date(t.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDetailId(t.id)}>
                    <FileText className="h-4 w-4" /> Review
                  </Button>
                  <Button size="sm" disabled={!t.readyForReview || verifying} onClick={() => verify(t.id)}>
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify &amp; activate
                  </Button>
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
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.url} · {t.cacNumber ?? "—"}</p>
                </div>
                <Badge variant="outline" className="border-emerald-300 text-emerald-800">active</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* review dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          {detail.isLoading || !detail.data || detail.data.id !== detailId ? (
            <div className="py-10"><LoadingBlock label="Loading church dossier…" /></div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.data.name}
                  <Badge variant="outline" className={detail.data.status === "pending_verification" ? "border-amber-300 text-amber-900" : "border-emerald-300 text-emerald-800"}>
                    {detail.data.status}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {detail.data.legalName} · {detail.data.denomination ?? "—"} · {detail.data.url}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[65vh] pr-3">
                <div className="space-y-4 text-sm">
                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium"><Scale className="h-4 w-4 text-primary" /> CAC &amp; regulatory</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3 text-muted-foreground">
                      <span>CAC number</span><span className="text-foreground">{detail.data.cac.number ?? "—"}</span>
                      <span>Registration date</span><span className="text-foreground">{detail.data.cac.date ? new Date(detail.data.cac.date).toLocaleDateString() : "—"}</span>
                      <span>TIN</span><span className="text-foreground">{detail.data.tin ?? "—"}</span>
                      <span>SCUML</span><span className="text-foreground">{detail.data.scumlNumber ?? "—"}</span>
                      <span>Certificate</span>
                      <span className="text-foreground">
                        {detail.data.cac.certificateFileId ? (
                          <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/v1/partner/compliance/documents/${detail.data.cac.certificateFileId}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3 w-3" /> Open document
                          </a>
                        ) : "Not uploaded"}
                      </span>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium"><Users className="h-4 w-4 text-primary" /> Trustees ({detail.data.trustees.length})</p>
                    <div className="space-y-2">
                      {detail.data.trustees.map((t) => (
                        <div key={t.id} className="rounded-lg border p-3">
                          <p className="font-medium">{t.fullName} <span className="font-normal text-muted-foreground">· {t.role ?? "Trustee"}</span></p>
                          <p className="text-xs text-muted-foreground">
                            {t.idType ? t.idType.replace("_", " ") : "no ID type"} · {t.idNumberMasked ?? "no ID number"}
                            {t.idDocumentFileId ? (
                              <> · <a className="text-primary hover:underline" href={`/api/v1/partner/compliance/documents/${t.idDocumentFileId}`} target="_blank" rel="noreferrer">ID document</a></>
                            ) : null}
                          </p>
                          {t.residentialAddress ? <p className="mt-1 text-xs text-muted-foreground">{t.residentialAddress}</p> : null}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium"><Globe className="h-4 w-4 text-primary" /> Addresses &amp; leadership</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3 text-muted-foreground">
                      <span>Registered</span>
                      <span className="text-foreground">{[detail.data.registeredAddress.line1, detail.data.registeredAddress.lga, detail.data.registeredAddress.state].filter(Boolean).join(", ") || "—"}</span>
                      <span>Worship</span><span className="text-foreground">{detail.data.worshipCampus?.address ?? "Same as registered / not set"}</span>
                      <span>Head pastor</span><span className="text-foreground">{detail.data.headPastor.name ?? "—"}{detail.data.headPastor.ninMasked ? ` · NIN ${detail.data.headPastor.ninMasked}` : ""}</span>
                      <span>Owner</span><span className="text-foreground">{detail.data.owner ? `${detail.data.owner.name ?? detail.data.owner.email}` : "—"}</span>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium"><Landmark className="h-4 w-4 text-primary" /> Banking &amp; consent</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3 text-muted-foreground">
                      <span>Bank</span><span className="text-foreground">{detail.data.banking.bankName ?? "—"}</span>
                      <span>Account</span><span className="text-foreground">{detail.data.banking.accountName ?? "—"}{detail.data.banking.accountNumberMasked ? ` · ${detail.data.banking.accountNumberMasked}` : ""}</span>
                      <span>NDPA</span>
                      <span className="text-foreground">{detail.data.ndpa.acknowledgedAt ? `Accepted ${new Date(detail.data.ndpa.acknowledgedAt).toLocaleDateString()} (DPA ${detail.data.ndpa.dpaVersion})` : "Not accepted"}</span>
                    </div>
                  </section>

                  <Separator />
                  <section className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium"><History className="h-4 w-4 text-primary" /> Onboarding audit trail</p>
                    <ol className="space-y-1">
                      {detail.data.audit.map((a, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                          <code className="rounded bg-muted px-1.5 py-0.5">{a.step}</code>
                          {new Date(a.at).toLocaleString()}
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
              </ScrollArea>
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldAlert className="h-3.5 w-3.5" /> Identifiers shown masked — raw values never leave the server.
                </p>
                <Button disabled={!detail.data.readyForReview || verifying} onClick={() => verify(detail.data.id)}>
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Verify &amp; activate
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
