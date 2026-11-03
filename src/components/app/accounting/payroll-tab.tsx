/**
 * Payroll tab — staff payroll / pastoral stipends / visiting-minister honoraria.
 * Run flow: draft → pending_approval → approved → posted (or rejected back to drafter).
 * Sub-tabs: 1) Runs  2) Staff profiles (payee records that load into runs).
 * Money is integer kobo throughout (MoneyField/MoneyInput emit cents).
 */
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive, Banknote, CheckCircle2, Landmark, Pencil, Plus, RotateCcw, Send, Trash2, Undo2, Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fmtMoney, fmtDate, fmtDateTime, type SessionUser } from "@/lib/types";
import { EmptyState, ErrorBlock, LoadingBlock, Section, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BankAccountSelect, KpiRow, MoneyField, StatusPill,
  PAYROLL_KIND_LABELS, PAYROLL_RUN_STATUS_LABELS,
} from "./accounting-shared";

// ── types ─────────────────────────────────────────────────────────────────────

type PayrollRun = {
  id: string;
  periodMonth: string; // "2026-02"
  kind: string; // payroll | stipend | honoraria
  kindLabel?: string | null;
  description?: string | null;
  status: string; // draft | pending_approval | approved | posted | rejected
  grossCents: number;
  allowancesCents: number;
  bonusCents: number;
  payeCents: number;
  pensionCents: number;
  netCents: number;
  bankAccountId?: string | null;
  submittedByName?: string | null;
  submittedAt?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectionNote?: string | null;
  postedByName?: string | null;
  postedAt?: string | null;
  journalEntryId?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
  lineCount?: number;
};

type PayrollLine = {
  id: string;
  payeeName: string;
  roleLabel?: string | null;
  basicCents: number;
  allowancesCents: number;
  bonusCents: number;
  payeCents: number;
  pensionCents: number;
  netCents: number;
  bankName?: string | null;
  nuban?: string | null;
  paymentRef?: string | null;
  paidAt?: string | null;
};

type PayrollRunDetail = PayrollRun & { lines?: PayrollLine[] };

type StaffProfile = {
  id: string;
  payeeName: string;
  roleLabel?: string | null;
  personId?: string | null;
  category: string; // payroll | stipend | honoraria
  basicCents: number;
  allowancesCents: number;
  bonusCents: number;
  payeCents: number;
  pensionCents: number;
  bankName?: string | null;
  nuban?: string | null;
  isActive: boolean;
};

/** Line under construction in the create-run editor. */
type LineDraft = {
  key: string;
  profileId?: string; // set when loaded from a staff profile (checkbox sync)
  payeeName: string;
  roleLabel: string;
  basicCents: number | null;
  allowancesCents: number | null;
  bonusCents: number | null;
  payeCents: number | null;
  pensionCents: number | null;
  bankName: string;
  nuban: string;
};

// ── constants & helpers ───────────────────────────────────────────────────────

const NUBAN_RE = /^\d{10}$/;

const currentMonth = () => new Date().toISOString().slice(0, 7);

/** Treat null/NaN kobo as 0 (MoneyInput emits NaN when cleared). */
const n0 = (v: number | null | undefined): number => (v == null || Number.isNaN(v) ? 0 : v);

const kindLabel = (k: string) => PAYROLL_KIND_LABELS[k] ?? k;

const KIND_FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All" },
  { id: "payroll", label: PAYROLL_KIND_LABELS.payroll },
  { id: "stipend", label: PAYROLL_KIND_LABELS.stipend },
  { id: "honoraria", label: PAYROLL_KIND_LABELS.honoraria },
];

const KIND_TONES: Record<string, { label: string; tone: string }> = {
  payroll: { label: PAYROLL_KIND_LABELS.payroll, tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  stipend: { label: PAYROLL_KIND_LABELS.stipend, tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  honoraria: { label: PAYROLL_KIND_LABELS.honoraria, tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
};

const PROFILE_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  archived: { label: "Archived", tone: "bg-muted text-muted-foreground" },
};

/** Dr-side expense codes per run kind, for the post confirmation preview. */
const KIND_DR_CODES: Record<string, string> = {
  payroll: "5410/5420/5430",
  stipend: "5400",
  honoraria: "5300",
};

/** JE preview text shown before posting: "Dr … · Cr PAYE 2160 · Cr Pension 2165 · Cr Bank (net)". */
function jePreview(run?: Pick<PayrollRun, "kind" | "payeCents" | "pensionCents"> | null): string {
  if (!run) return "";
  const parts = [`Dr ${KIND_DR_CODES[run.kind] ?? "5410/5420/5430"}`];
  if (n0(run.payeCents) > 0) parts.push("Cr PAYE 2160");
  if (n0(run.pensionCents) > 0) parts.push("Cr Pension 2165");
  parts.push("Cr Bank (net)");
  return parts.join(" · ");
}

// ── tab shell ─────────────────────────────────────────────────────────────────

const SUB_TABS: { id: "runs" | "profiles"; label: string; icon: typeof Banknote }[] = [
  { id: "runs", label: "Runs", icon: Banknote },
  { id: "profiles", label: "Staff profiles", icon: Users },
];

export function PayrollTab({ user, canManage, canApprove }: { user: SessionUser; canManage: boolean; canApprove: boolean }) {
  const [sub, setSub] = useState<"runs" | "profiles">("runs");
  const [kind, setKind] = useState<string>("");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {SUB_TABS.map((t) => {
          const Icon = t.icon; const active = sub === t.id;
          return (
            <button key={t.id} onClick={() => setSub(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>
      {sub === "runs" && <RunsView user={user} canManage={canManage} canApprove={canApprove} kind={kind} onKindChange={setKind} />}
      {sub === "profiles" && <ProfilesView canManage={canManage} />}
    </div>
  );
}

// ── 1. Runs ───────────────────────────────────────────────────────────────────

function RunsView({ user, canManage, canApprove, kind, onKindChange }: { user: SessionUser; canManage: boolean; canApprove: boolean; kind: string; onKindChange: (k: string) => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useApiQuery<{ items: PayrollRun[] }>(
    ["payroll-runs", kind],
    kind ? `/payroll/runs?kind=${kind}` : "/payroll/runs"
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PayrollRun | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [posting, setPosting] = useState<PayrollRun | null>(null);
  const [postBankId, setPostBankId] = useState<string | undefined>();
  const [postRef, setPostRef] = useState("");

  const items = useMemo(() => data?.items ?? [], [data]);
  const month = currentMonth();
  const year = month.slice(0, 4);
  const netThisMonth = items.filter((r) => r.periodMonth === month).reduce((a, r) => a + n0(r.netCents), 0);
  const pendingCount = items.filter((r) => r.status === "pending_approval").length;
  const awaitingPost = items.filter((r) => r.status === "approved").length;
  const postedThisYear = items.filter((r) => r.status === "posted" && r.periodMonth.startsWith(year)).length;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["payroll-runs"] });
    qc.invalidateQueries({ queryKey: ["payroll-run"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["journal-entries"] });
  };

  async function submitForApproval(id: string) {
    try { await api.post(`/payroll/runs/${id}/submit`, {}); toast.success("Submitted for approval — approvers notified."); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to submit run."); }
  }
  async function approve(id: string) {
    try { await api.post(`/payroll/runs/${id}/approve`, {}); toast.success("Run approved — ready to post."); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to approve run."); }
  }
  async function doReject() {
    if (!rejecting || !rejectNote.trim()) return;
    try {
      await api.post(`/payroll/runs/${rejecting.id}/reject`, { note: rejectNote.trim() });
      toast.success("Run returned to the drafter with your note.");
      setRejecting(null); setRejectNote("");
      refresh();
    } catch (e) { toast.error((e as ApiError).message || "Failed to reject run."); }
  }
  async function doPost() {
    if (!posting) return;
    try {
      await api.post(`/payroll/runs/${posting.id}/post`, { bankAccountId: postBankId || undefined, paymentRef: postRef.trim() || undefined });
      toast.success("Payroll posted — journal entry created and disbursement recorded.");
      setPosting(null); setPostRef(""); setPostBankId(undefined);
      refresh();
    } catch (e) { toast.error((e as ApiError).message || "Failed to post payroll."); }
  }

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} />;

  return (
    <div className="space-y-4">
      <KpiRow items={[
        { label: `Net payable — ${month}`, value: fmtMoney(netThisMonth) },
        { label: "Pending approval", value: String(pendingCount), tone: "warning" },
        { label: "Approved — awaiting post", value: String(awaitingPost), tone: "violet" },
        { label: `Posted in ${year}`, value: String(postedThisYear), tone: "positive" },
      ]} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {KIND_FILTERS.map((f) => (
            <button key={f.id || "all"} onClick={() => onKindChange(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${kind === f.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <CreateRunDialog canManage={canManage} />
      </div>

      <Section title="Payroll runs" icon={Banknote} description="Staff payroll, pastoral stipends and visiting-minister honoraria — draft → approve → post to the GL.">
        {items.length === 0 ? (
          <EmptyState icon={Banknote} title="No payroll runs" description="Create a monthly run, load payees from staff profiles, then submit it for approval." />
        ) : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Allow.</TableHead>
              <TableHead className="text-right">Bonus</TableHead>
              <TableHead className="text-right">Deductions</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>{items.map((r) => {
              const ded = n0(r.payeCents) + n0(r.pensionCents);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.periodMonth}</TableCell>
                  <TableCell><StatusPill status={r.kind} map={KIND_TONES} /></TableCell>
                  <TableCell className="max-w-[14rem] truncate text-xs">{r.description ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.grossCents)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.allowancesCents ? fmtMoney(r.allowancesCents) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.bonusCents ? fmtMoney(r.bonusCents) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{ded ? fmtMoney(ded) : "—"}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{fmtMoney(r.netCents)}</TableCell>
                  <TableCell><StatusPill status={r.status} map={PAYROLL_RUN_STATUS_LABELS} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.submittedByName || r.approvedByName || r.postedByName ? (
                      <div className="space-y-0.5">
                        {r.submittedByName ? <div>Sent <span className="font-medium text-foreground">{r.submittedByName}</span> · {fmtDate(r.submittedAt)}</div> : null}
                        {r.approvedByName ? <div>Appr. <span className="font-medium text-foreground">{r.approvedByName}</span> · {fmtDate(r.approvedAt)}</div> : null}
                        {r.postedByName ? <div>Posted <span className="font-medium text-foreground">{r.postedByName}</span> · {fmtDate(r.postedAt)}</div> : null}
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDetailId(r.id)}>View</Button>
                      {canManage && r.status === "draft" && <Button size="sm" onClick={() => submitForApproval(r.id)}><Send className="h-3.5 w-3.5 mr-1" />Submit</Button>}
                      {canApprove && r.status === "pending_approval" && <>
                        <Button size="sm" onClick={() => approve(r.id)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve</Button>
                        <Button size="sm" variant="outline" title="Return with note" onClick={() => { setRejecting(r); setRejectNote(""); }}><Undo2 className="h-3.5 w-3.5" /></Button>
                      </>}
                      {canManage && r.status === "approved" && <Button size="sm" onClick={() => { setPosting(r); setPostBankId(r.bankAccountId ?? undefined); setPostRef(""); }}>Post & pay</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table></div>
        )}
      </Section>

      <RunDetailDialog runId={detailId} onClose={() => setDetailId(null)} user={user} canManage={canManage} canApprove={canApprove}
        onSubmit={submitForApproval} onApprove={approve}
        onReject={(r) => { setRejecting(r); setRejectNote(""); }}
        onPost={(r) => { setPosting(r); setPostBankId(r.bankAccountId ?? undefined); setPostRef(""); }} />

      {/* Return (reject) dialog — note is mandatory */}
      <AlertDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return run {rejecting?.periodMonth} for correction</AlertDialogTitle>
            <AlertDialogDescription>The run goes back to the drafter with your note so it can be fixed and resubmitted. A note is required.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={3} placeholder="e.g. Pension line for the organist doesn't match the schedule." />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!rejectNote.trim()} onClick={doReject}>Return run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Post & disburse dialog */}
      <Dialog open={!!posting} onOpenChange={(o) => !o && setPosting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post & disburse — {posting ? `${posting.periodMonth} ${kindLabel(posting.kind)}` : ""}</DialogTitle>
            <DialogDescription>Posts the payroll journal to the GL and records the disbursement.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>Pay from bank account</Label><BankAccountSelect value={postBankId} onValueChange={setPostBankId} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pr-ref">Payment ref (NIBSS / schedule no.)</Label><Input id="pr-ref" value={postRef} onChange={(e) => setPostRef(e.target.value)} /></div>
            <div className="space-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <div className="font-mono text-xs">{jePreview(posting)}</div>
              <div>Net payable <span className="font-mono font-semibold">{fmtMoney(posting?.netCents ?? 0)}</span> · {posting?.lineCount ?? 0} payees</div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPosting(null)}>Cancel</Button><Button onClick={doPost}>Post & disburse</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 1a. Run detail dialog ─────────────────────────────────────────────────────

function RunDetailDialog({ runId, onClose, user, canManage, canApprove, onSubmit, onApprove, onReject, onPost }: {
  runId: string | null;
  onClose: () => void;
  user: SessionUser;
  canManage: boolean;
  canApprove: boolean;
  onSubmit: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (run: PayrollRun) => void;
  onPost: (run: PayrollRun) => void;
}) {
  const { data, isLoading, error } = useApiQuery<PayrollRunDetail>(
    ["payroll-run", runId ?? ""],
    `/payroll/runs/${runId}`,
    { enabled: !!runId }
  );
  const run = runId ? data : undefined;

  return (
    <Dialog open={!!runId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{run ? `${kindLabel(run.kind)} — ${run.periodMonth}` : "Payroll run"}</DialogTitle>
          <DialogDescription>{run?.description || "Payroll run lines, totals and approval trail."}</DialogDescription>
        </DialogHeader>
        {isLoading && <LoadingBlock label="Loading run…" />}
        {error && <ErrorBlock error={error} />}
        {run && <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={run.status} map={PAYROLL_RUN_STATUS_LABELS} />
            {run.journalEntryId ? <Badge variant="outline" className="font-mono text-xs">JE {run.journalEntryId}</Badge> : null}
          </div>

          {run.status === "rejected" && run.rejectionNote ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-900/25 dark:text-rose-200">
              <span className="font-medium">Returned with note:</span> {run.rejectionNote}
            </div>
          ) : null}

          {run.status === "pending_approval" && canApprove && run.submittedByName === user.name ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">You submitted this run — separation of duties requires a different approver to approve it.</p>
          ) : null}

          <div className="max-h-72 overflow-y-auto rounded-md border"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Payee</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Basic</TableHead>
                <TableHead className="text-right">Allow.</TableHead>
                <TableHead className="text-right">Bonus</TableHead>
                <TableHead className="text-right">PAYE</TableHead>
                <TableHead className="text-right">Pension</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Bank</TableHead>
              </TableRow></TableHeader>
              <TableBody>{(run.lines ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.payeeName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.roleLabel ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtMoney(l.basicCents)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{l.allowancesCents ? fmtMoney(l.allowancesCents) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{l.bonusCents ? fmtMoney(l.bonusCents) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{l.payeCents ? fmtMoney(l.payeCents) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{l.pensionCents ? fmtMoney(l.pensionCents) : "—"}</TableCell>
                  <TableCell className="text-right font-mono font-medium">{fmtMoney(l.netCents)}</TableCell>
                  <TableCell className="text-xs">{l.bankName ?? "—"}{l.nuban ? <div className="font-mono text-muted-foreground">••{l.nuban.slice(-4)}</div> : null}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div></div>

          <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span>Gross <span className="font-mono font-semibold">{fmtMoney(run.grossCents)}</span></span>
            <span>Allowances <span className="font-mono">{fmtMoney(run.allowancesCents)}</span></span>
            <span>Bonus <span className="font-mono">{fmtMoney(run.bonusCents)}</span></span>
            <span>PAYE <span className="font-mono">{fmtMoney(run.payeCents)}</span></span>
            <span>Pension <span className="font-mono">{fmtMoney(run.pensionCents)}</span></span>
            <span>Net <span className="font-mono font-semibold">{fmtMoney(run.netCents)}</span></span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <TimelineChip label="Submitted" name={run.submittedByName} at={run.submittedAt} />
            <TimelineChip label="Approved" name={run.approvedByName} at={run.approvedAt} />
            <TimelineChip label="Posted" name={run.postedByName} at={run.postedAt} />
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {run.status === "draft" && canManage && <Button onClick={() => onSubmit(run.id)}><Send className="h-4 w-4 mr-1" />Submit for approval</Button>}
            {run.status === "pending_approval" && canApprove && <>
              <Button variant="outline" onClick={() => onReject(run)}><Undo2 className="h-4 w-4 mr-1" />Return</Button>
              <Button onClick={() => onApprove(run.id)}><CheckCircle2 className="h-4 w-4 mr-1" />Approve</Button>
            </>}
            {run.status === "approved" && canManage && <Button onClick={() => onPost(run)}><Landmark className="h-4 w-4 mr-1" />Post & disburse</Button>}
            {run.status === "posted" && <p className="text-xs text-muted-foreground">Posted to the GL — read-only.</p>}
            {run.status === "rejected" && <p className="text-xs text-muted-foreground">Returned — correct the draft and resubmit.</p>}
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
}

/** Status-timeline chip: emerald when done (name · date), dashed placeholder when pending. */
function TimelineChip({ label, name, at }: { label: string; name?: string | null; at?: string | null }) {
  const done = !!(name || at);
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${done ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-900/25 dark:text-emerald-200" : "border-dashed text-muted-foreground"}`}>
      {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <span className="h-2 w-2 shrink-0 rounded-full border border-current" aria-hidden />}
      <span className="font-medium">{label}</span>
      {done ? <span className="truncate">{name} · {fmtDateTime(at)}</span> : <span className="opacity-70">pending</span>}
    </span>
  );
}

// ── 1b. Create-run dialog ─────────────────────────────────────────────────────

function CreateRunDialog({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(currentMonth());
  const [kind, setKind] = useState<string>("payroll");
  const [description, setDescription] = useState("");
  const [bankAccountId, setBankAccountId] = useState<string | undefined>();
  const seq = useRef(1);
  const [lines, setLines] = useState<LineDraft[]>([]);

  const profilesQ = useApiQuery<{ items: StaffProfile[] }>(["payroll-profiles"], "/payroll/profiles", { enabled: open });
  const activeProfiles = useMemo(
    () => (profilesQ.data?.items ?? []).filter((p) => p.isActive && p.category === kind),
    [profilesQ.data, kind]
  );

  if (!canManage) return null;

  const blankLine = (): LineDraft => ({
    key: `m${seq.current++}`,
    profileId: undefined,
    payeeName: "", roleLabel: "",
    basicCents: null, allowancesCents: null, bonusCents: null, payeCents: null, pensionCents: null,
    bankName: "", nuban: "",
  });

  function toggleProfile(p: StaffProfile) {
    setLines((prev) => {
      if (prev.some((l) => l.profileId === p.id)) return prev.filter((l) => l.profileId !== p.id);
      return [...prev, {
        key: `pf-${p.id}`, profileId: p.id,
        payeeName: p.payeeName, roleLabel: p.roleLabel ?? "",
        basicCents: p.basicCents ?? 0, allowancesCents: p.allowancesCents ?? 0, bonusCents: p.bonusCents ?? 0,
        payeCents: p.payeCents ?? 0, pensionCents: p.pensionCents ?? 0,
        bankName: p.bankName ?? "", nuban: p.nuban ?? "",
      }];
    });
  }

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  const totGross = lines.reduce((a, l) => a + n0(l.basicCents) + n0(l.allowancesCents) + n0(l.bonusCents), 0);
  const totAllow = lines.reduce((a, l) => a + n0(l.allowancesCents), 0);
  const totBonus = lines.reduce((a, l) => a + n0(l.bonusCents), 0);
  const totPaye = lines.reduce((a, l) => a + n0(l.payeCents), 0);
  const totPension = lines.reduce((a, l) => a + n0(l.pensionCents), 0);
  const totNet = totGross - totPaye - totPension;

  async function submit() {
    if (!periodMonth) { toast.error("Choose the payroll period month."); return; }
    if (!lines.length) { toast.error("Add at least one payee line."); return; }
    if (lines.some((l) => !l.payeeName.trim())) { toast.error("Every line needs a payee name."); return; }
    const badNuban = lines.find((l) => l.nuban && !NUBAN_RE.test(l.nuban));
    if (badNuban) { toast.error(`NUBAN for ${badNuban.payeeName || "a payee"} must be exactly 10 digits.`); return; }
    try {
      await api.post<{ id: string }>("/payroll/runs", {
        periodMonth,
        kind,
        description: description.trim() || undefined,
        bankAccountId: bankAccountId || undefined,
        lines: lines.map((l) => ({
          payeeName: l.payeeName.trim(),
          roleLabel: l.roleLabel.trim() || undefined,
          basicCents: n0(l.basicCents),
          allowancesCents: n0(l.allowancesCents),
          bonusCents: n0(l.bonusCents),
          payeCents: n0(l.payeCents),
          pensionCents: n0(l.pensionCents),
          bankName: l.bankName.trim() || undefined,
          nuban: l.nuban.trim() || undefined,
        })),
      });
      toast.success("Payroll run created as draft.");
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      setOpen(false);
      setLines([]); setDescription(""); setBankAccountId(undefined); setPeriodMonth(currentMonth());
    } catch (e) { toast.error((e as ApiError).message || "Failed to create payroll run."); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />New payroll run</Button></DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New payroll run</DialogTitle>
          <DialogDescription>
            Compose a draft run for one month — staff payroll, stipends and honoraria each get their own run.
            Totals are recomputed by the server on save.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="pr-month">Period month</Label>
            <Input id="pr-month" type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PAYROLL_KIND_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="pr-desc">Description</Label>
            <Input id="pr-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={`e.g. ${PAYROLL_KIND_LABELS[kind] ?? "Payroll"} for ${periodMonth}`} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Pay from bank account (optional)</Label>
            <BankAccountSelect value={bankAccountId} onValueChange={setBankAccountId} placeholder="Decide at posting time" />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Load from staff profiles ({kindLabel(kind)})</Label>
          {profilesQ.isLoading ? <LoadingBlock label="Loading profiles…" />
            : profilesQ.error ? <p className="text-xs text-rose-600">Could not load profiles — add payees manually below.</p>
              : activeProfiles.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active {kindLabel(kind).toLowerCase()} profiles yet — add payees manually below, or create profiles in the “Staff profiles” tab.</p>
              ) : (
                <div className="max-h-40 divide-y overflow-y-auto rounded-md border">
                  {activeProfiles.map((p) => {
                    const checked = lines.some((l) => l.profileId === p.id);
                    const pnet = n0(p.basicCents) + n0(p.allowancesCents) + n0(p.bonusCents) - n0(p.payeCents) - n0(p.pensionCents);
                    return (
                      <div key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                        <Checkbox checked={checked} onCheckedChange={() => toggleProfile(p)} aria-label={`Load ${p.payeeName} into the run`} />
                        <span className="font-medium">{p.payeeName}</span>
                        <span className="truncate text-xs text-muted-foreground">{p.roleLabel ?? "—"}</span>
                        <span className="ml-auto shrink-0 font-mono text-xs">{fmtMoney(pnet)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label>Payee lines</Label>
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}><Plus className="h-3.5 w-3.5 mr-1" />Add row</Button>
          </div>
          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">No payees yet — tick profiles above or add a row.</p>
          ) : lines.map((l, i) => {
            const gross = n0(l.basicCents) + n0(l.allowancesCents) + n0(l.bonusCents);
            const net = gross - n0(l.payeCents) - n0(l.pensionCents);
            return (
              <div key={l.key} className="space-y-2.5 rounded-lg border p-3">
                <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_auto]">
                  <Input value={l.payeeName} onChange={(e) => setLine(i, { payeeName: e.target.value })} placeholder="Payee name" aria-label="Payee name" />
                  <Input value={l.roleLabel} onChange={(e) => setLine(i, { roleLabel: e.target.value })} placeholder="Role (e.g. Senior Pastor)" aria-label="Role" />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <MoneyField label="Basic" value={l.basicCents} onChange={(c) => setLine(i, { basicCents: c })} />
                  <MoneyField label="Allowances" value={l.allowancesCents} onChange={(c) => setLine(i, { allowancesCents: c })} />
                  <MoneyField label="Bonus" value={l.bonusCents} onChange={(c) => setLine(i, { bonusCents: c })} />
                  <MoneyField label="PAYE" value={l.payeCents} onChange={(c) => setLine(i, { payeCents: c })} />
                  <MoneyField label="Pension" value={l.pensionCents} onChange={(c) => setLine(i, { pensionCents: c })} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span>Gross <span className="font-mono">{fmtMoney(gross)}</span></span>
                  <span>Net <span className="font-mono font-medium text-foreground">{fmtMoney(net)}</span></span>
                  {(l.bankName || l.nuban) ? <span className="truncate">{l.bankName}{l.nuban ? ` ••${l.nuban.slice(-4)}` : ""}</span> : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span>Gross <span className="font-mono font-semibold">{fmtMoney(totGross)}</span></span>
          <span>Allowances <span className="font-mono">{fmtMoney(totAllow)}</span></span>
          <span>Bonus <span className="font-mono">{fmtMoney(totBonus)}</span></span>
          <span>PAYE <span className="font-mono">{fmtMoney(totPaye)}</span></span>
          <span>Pension <span className="font-mono">{fmtMoney(totPension)}</span></span>
          <span>Net <span className="font-mono font-semibold">{fmtMoney(totNet)}</span></span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!periodMonth || lines.length === 0} onClick={submit}>Create draft run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 2. Staff profiles ─────────────────────────────────────────────────────────

function ProfilesView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useApiQuery<{ items: StaffProfile[] }>(["payroll-profiles"], "/payroll/profiles");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffProfile | null>(null);

  const items = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => a.category.localeCompare(b.category) || a.payeeName.localeCompare(b.payeeName)),
    [data]
  );

  async function setActive(p: StaffProfile, isActive: boolean) {
    try {
      await api.patch(`/payroll/profiles/${p.id}`, { isActive });
      toast.success(isActive ? "Profile restored." : "Profile archived — it will no longer appear when loading runs.");
      qc.invalidateQueries({ queryKey: ["payroll-profiles"] });
    } catch (e) { toast.error((e as ApiError).message || "Failed to update profile."); }
  }

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} />;

  return (
    <div className="space-y-3">
      <Section
        title="Staff profiles"
        icon={Users}
        description="Payee records for payroll runs — staff salaries, pastoral stipends and visiting-minister honoraria. These are payee records only; no user accounts are created."
        actions={canManage ? (
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="h-4 w-4 mr-1" />New profile</Button>
        ) : undefined}
      >
        {items.length === 0 ? (
          <EmptyState icon={Users} title="No staff profiles" description="Add payees with their default amounts and bank details so monthly runs load with one click." />
        ) : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow>
              <TableHead>Payee</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Basic</TableHead>
              <TableHead className="text-right">Allow.</TableHead>
              <TableHead className="text-right">Bonus</TableHead>
              <TableHead className="text-right">Deductions</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow></TableHeader>
            <TableBody>{items.map((p) => {
              const ded = n0(p.payeCents) + n0(p.pensionCents);
              const net = n0(p.basicCents) + n0(p.allowancesCents) + n0(p.bonusCents) - ded;
              return (
                <TableRow key={p.id} className={p.isActive ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    {p.payeeName}
                    {(p.bankName || p.nuban) ? <div className="text-xs text-muted-foreground">{p.bankName}{p.nuban ? ` ••${p.nuban.slice(-4)}` : ""}</div> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.roleLabel ?? "—"}</TableCell>
                  <TableCell><StatusPill status={p.category} map={KIND_TONES} /></TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtMoney(p.basicCents)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{p.allowancesCents ? fmtMoney(p.allowancesCents) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{p.bonusCents ? fmtMoney(p.bonusCents) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{ded ? fmtMoney(ded) : "—"}</TableCell>
                  <TableCell className="text-right font-mono font-medium">{fmtMoney(net)}</TableCell>
                  <TableCell><StatusPill status={p.isActive ? "active" : "archived"} map={PROFILE_STATUS} /></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => { setEditing(p); setFormOpen(true); }}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                        {p.isActive
                          ? <Button size="sm" variant="ghost" onClick={() => setActive(p, false)}><Archive className="h-3.5 w-3.5 mr-1" />Archive</Button>
                          : <Button size="sm" variant="ghost" onClick={() => setActive(p, true)}><RotateCcw className="h-3.5 w-3.5 mr-1" />Restore</Button>}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}</TableBody>
          </Table></div>
        )}
      </Section>

      <ProfileFormDialog open={formOpen} onOpenChange={setFormOpen} profile={editing} />
    </div>
  );
}

// ── 2a. Profile create/edit dialog ────────────────────────────────────────────

function ProfileFormDialog({ open, onOpenChange, profile }: { open: boolean; onOpenChange: (o: boolean) => void; profile: StaffProfile | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        {open ? <ProfileFormBody key={profile?.id ?? "new"} profile={profile} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ProfileFormBody({ profile, onClose }: { profile: StaffProfile | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [payeeName, setPayeeName] = useState(profile?.payeeName ?? "");
  const [roleLabel, setRoleLabel] = useState(profile?.roleLabel ?? "");
  const [category, setCategory] = useState(profile?.category ?? "payroll");
  const [basicCents, setBasicCents] = useState<number | null>(profile?.basicCents ?? null);
  const [allowancesCents, setAllowancesCents] = useState<number | null>(profile?.allowancesCents ?? null);
  const [bonusCents, setBonusCents] = useState<number | null>(profile?.bonusCents ?? null);
  const [payeCents, setPayeCents] = useState<number | null>(profile?.payeCents ?? null);
  const [pensionCents, setPensionCents] = useState<number | null>(profile?.pensionCents ?? null);
  const [bankName, setBankName] = useState(profile?.bankName ?? "");
  const [nuban, setNuban] = useState(profile?.nuban ?? "");
  const [isActive, setIsActive] = useState(profile?.isActive ?? true);

  async function save() {
    if (!payeeName.trim()) { toast.error("Payee name is required."); return; }
    if (nuban && !NUBAN_RE.test(nuban)) { toast.error("NUBAN must be exactly 10 digits."); return; }
    const body = {
      payeeName: payeeName.trim(),
      roleLabel: roleLabel.trim() || undefined,
      category,
      basicCents: n0(basicCents),
      allowancesCents: n0(allowancesCents),
      bonusCents: n0(bonusCents),
      payeCents: n0(payeCents),
      pensionCents: n0(pensionCents),
      bankName: bankName.trim() || undefined,
      nuban: nuban.trim() || undefined,
      isActive,
    };
    try {
      if (profile) {
        await api.patch(`/payroll/profiles/${profile.id}`, body);
        toast.success("Profile updated.");
      } else {
        await api.post("/payroll/profiles", body);
        toast.success("Profile created.");
      }
      qc.invalidateQueries({ queryKey: ["payroll-profiles"] });
      onClose();
    } catch (e) { toast.error((e as ApiError).message || "Failed to save profile."); }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{profile ? "Edit staff profile" : "New staff profile"}</DialogTitle>
        <DialogDescription>A payee record for payroll runs — this does not create a user account.</DialogDescription>
      </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sp-name">Payee name *</Label>
            <Input id="sp-name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="e.g. Pastor Daniel Okafor" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sp-role">Role label</Label>
            <Input id="sp-role" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} placeholder="e.g. Organist" />
          </div>
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PAYROLL_KIND_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sp-bank">Bank name</Label>
            <Input id="sp-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Zenith Bank" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sp-nuban">NUBAN (10 digits)</Label>
            <Input id="sp-nuban" inputMode="numeric" maxLength={10} value={nuban} onChange={(e) => setNuban(e.target.value.replace(/\D/g, ""))} placeholder="0123456789" />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Switch id="sp-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="sp-active">Active (loadable into runs)</Label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <MoneyField label="Basic" value={basicCents} onChange={setBasicCents} />
          <MoneyField label="Allowances" value={allowancesCents} onChange={setAllowancesCents} />
          <MoneyField label="Bonus" value={bonusCents} onChange={setBonusCents} />
          <MoneyField label="PAYE" value={payeCents} onChange={setPayeCents} />
          <MoneyField label="Pension" value={pensionCents} onChange={setPensionCents} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>{profile ? "Save changes" : "Create profile"}</Button>
        </DialogFooter>
    </>
  );
}
