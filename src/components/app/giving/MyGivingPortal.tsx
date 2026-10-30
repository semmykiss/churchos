"use client";

/**
 * MyGivingPortal — member self-service giving (giving.view.own + giving.give).
 * Warm, low-density, mobile-first: this is what a congregant opens on their
 * phone during a Sunday service. Every query is server-scoped to the signed-in
 * person — the member physically cannot see anyone else's giving.
 *
 * Batch B: Give-now hero (tithe calculator, tokenized methods, donor-covered
 * fees, one-time or recurring), self-service pledges, payment methods.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, HandCoins, HeartHandshake, Receipt, Repeat, FileText, Printer, Pause, Play, Target, Plus, X } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, Section, StatusBadge, useApiQuery,
} from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtMoney, type DonationDTO } from "@/lib/types";
import type { SessionUser } from "@/lib/types";
import GiveNowCard from "./GiveNowCard";
import { PaymentMethodsSection } from "./PaymentMethodsTab";
import MyPledgeDialog from "./MyPledgeDialog";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

const METHOD_LABELS: Record<string, string> = {
  card: "Card", ach: "Bank transfer", cash: "Cash", check: "Check", other: "Other",
};

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly",
};

interface MyPledgeDTO {
  id: string;
  fund: { id: string; name: string } | null;
  campaign: string;
  amountCents: number;
  frequency: string;
  startsOn: string;
  status: string;
  progressCents: number;
  progressPct: number;
}

interface MyRecurringDTO {
  id: string;
  fund: { id: string; name: string } | null;
  amountCents: number;
  frequency: string;
  nextRunAt: string | null;
  status: string;
  failureCount: number;
}

interface MyStatementDTO {
  id: string;
  personName: string;
  householdName: string | null;
  taxYear: number;
  totalCents: number;
  status: string;
  generatedAt: string;
}

/* ───────────────────────────── portal ───────────────────────────── */

export default function MyGivingPortal({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<"give" | "history" | "recurring" | "methods" | "statements">("give");
  const [pledgeOpen, setPledgeOpen] = useState(false);
  const [recurringPrefill, setRecurringPrefill] = useState(false);

  // lightweight lifetime total for the hero strip (server-scoped to self)
  const donationsQ = useApiQuery<{ total: number; items: DonationDTO[] }>(
    ["my-giving", "recent"], "/donations?pageSize=100",
  );
  const ytdCents = (donationsQ.data?.items ?? [])
    .filter((d) => d.status === "posted" && new Date(d.receivedOn).getFullYear() === new Date().getFullYear())
    .reduce((a, d) => a + d.amountCents, 0);
  const giftCount = donationsQ.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Giving"
        description="Give, view your history, and manage how you give."
      />

      {/* hero strip — history at a glance */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Given this year</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtMoney(ytdCents)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total gifts</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{giftCount}</p>
        </div>
        <div className="rounded-xl border bg-primary/5 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Thank you</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-primary">
            <HeartHandshake className="h-4 w-4" /> Every gift matters, {user.name.split(" ")[0]}
          </p>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="My giving sections">
        {([
          ["give", "Give", HandCoins],
          ["history", "History", Receipt],
          ["recurring", "Recurring & Pledges", Repeat],
          ["methods", "Payment Methods", CreditCard],
          ["statements", "Statements", FileText],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              tab === key ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "give" ? <GiveNowCard prefillRecurring={recurringPrefill} /> : null}
      {tab === "history" ? <HistoryTab /> : null}
      {tab === "recurring" ? <RecurringPledgesTab onMakePledge={() => setPledgeOpen(true)} onSetupRecurring={() => { setRecurringPrefill(true); setTab("give"); }} /> : null}
      {tab === "methods" ? <PaymentMethodsSection /> : null}
      {tab === "statements" ? <StatementsTab /> : null}

      {pledgeOpen ? <MyPledgeDialog onClose={() => setPledgeOpen(false)} /> : null}
    </div>
  );
}

/* ───────────────────────────── history ───────────────────────────── */

function HistoryTab() {
  const q = useApiQuery<{ total: number; items: DonationDTO[] }>(["my-giving", "history"], "/donations?pageSize=100");
  const items = q.data?.items ?? [];

  if (q.isLoading) return <LoadingBlock label="Loading your gifts…" />;
  if (q.isError) return <ErrorBlock error={q.error} />;
  if (items.length === 0) {
    return <EmptyState icon={HandCoins} title="No gifts yet" description="Your giving history will appear here." />;
  }

  return (
    <Section title="Your gifts" description="Only you and the church finance team can see this.">
      <ul className="divide-y rounded-lg border">
        {items.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Receipt className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {(d.splits ?? []).map((s) => s.fundName).join(", ") || "General"}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtDate(d.receivedOn)} · {METHOD_LABELS[d.method] ?? d.method}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">{fmtMoney(d.amountCents)}</p>
              <StatusBadge status={d.status} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ───────────────────── recurring & pledges ───────────────────── */

function RecurringPledgesTab({ onMakePledge, onSetupRecurring }: { onMakePledge: () => void; onSetupRecurring: () => void }) {
  const recQ = useApiQuery<{ items: MyRecurringDTO[] }>(["my-giving", "recurring"], "/recurring-gifts");
  const pledgesQ = useApiQuery<{ items: MyPledgeDTO[] }>(["my-giving", "pledges"], "/pledges");
  const rec = recQ.data?.items ?? [];
  const pledges = pledgesQ.data?.items ?? [];

  return (
      <div className="space-y-4">
      <CommitmentCard />

      <Section
        title="Recurring gifts"
        description="Manage your automatic giving — pause any time, resume when ready."
        actions={
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onSetupRecurring}>
            <Plus className="h-4 w-4" /> Set up recurring
          </Button>
        }
      >
        {recQ.isLoading ? (
          <LoadingBlock label="Loading…" />
        ) : recQ.isError ? (
          <ErrorBlock error={recQ.error} />
        ) : rec.length === 0 ? (
          <EmptyState icon={Repeat} title="No recurring gifts" description="Set up automatic giving to make generosity effortless." />
        ) : (
          <ul className="space-y-2">
            {rec.map((g) => (
              <RecurringRow key={g.id} gift={g} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Your pledges"
        description="Commitments you've made toward funds and campaigns."
        actions={
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onMakePledge}>
            <Plus className="h-4 w-4" /> Make a pledge
          </Button>
        }
      >
        {pledgesQ.isLoading ? (
          <LoadingBlock label="Loading…" />
        ) : pledgesQ.isError ? (
          <ErrorBlock error={pledgesQ.error} />
        ) : pledges.length === 0 ? (
          <EmptyState icon={Target} title="No pledges" description="Pledges you make will show progress here." />
        ) : (
          <ul className="space-y-3">
            {pledges.map((p) => (
              <li key={p.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{p.fund?.name ?? "Fund"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.campaign} · {fmtMoney(p.amountCents)} · {FREQ_LABELS[p.frequency] ?? p.frequency}
                    </p>
                  </div>
                  <Badge variant="outline">{p.status}</Badge>
                </div>
                <div className="mt-3 space-y-1">
                  <Progress value={p.progressPct} aria-label={`Pledge progress ${p.progressPct}%`} />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {fmtMoney(p.progressCents)} of {fmtMoney(p.amountCents)} ({Math.round(p.progressPct)}%)
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/* ───────────────────── tithe commitment (covenant) ───────────────────── */

interface CommitmentDTO {
  id: string;
  commitmentType: string; // tithe_percent | fixed_amount
  percent: number | null;
  fixedAmountCents: number | null;
  frequency: string | null;
  startedOn: string | null;
}

function CommitmentCard() {
  const qc = useQueryClient();
  const q = useApiQuery<{ commitment: CommitmentDTO | null }>(["my-giving", "commitment"], "/giving/me/commitment");
  const [editOpen, setEditOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const c = q.data?.commitment ?? null;

  async function remove() {
    try {
      await api.del("/giving/me/commitment");
      toast.success("Commitment removed");
      void qc.invalidateQueries({ queryKey: ["my-giving"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setConfirmRemove(false);
    }
  }

  return (
    <Section
      title="Tithe commitment"
      description="Declare the share of your income you commit to giving — it pre-fills the Give calculator. Only you see this."
    >
      {q.isLoading ? (
        <LoadingBlock label="Loading…" />
      ) : q.isError ? (
        <ErrorBlock error={q.error} />
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            {c ? (
              <>
                <p className="text-sm font-semibold tabular-nums">
                  {c.commitmentType === "tithe_percent"
                    ? `${c.percent}% of income`
                    : `${fmtMoney(c.fixedAmountCents ?? 0)}`}
                  {c.frequency ? <span className="font-normal text-muted-foreground"> · {FREQ_LABELS[c.frequency] ?? c.frequency}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">Committed since {c.startedOn ? fmtDate(c.startedOn) : "today"} — pre-fills your Give calculator.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">No commitment yet</p>
                <p className="text-xs text-muted-foreground">Set a tithe commitment and the Give calculator follows it automatically.</p>
              </>
            )}
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setEditOpen(true)}>
            {c ? "Update" : "Set commitment"}
          </Button>
          {c ? (
            <Button size="sm" variant="ghost" className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          ) : null}
        </div>
      )}

      {editOpen ? <CommitmentDialog commitment={c} onClose={() => setEditOpen(false)} /> : null}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your commitment?</AlertDialogTitle>
            <AlertDialogDescription>
              The calculator goes back to the default 10%. Your past gifts and history are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={(e) => { e.preventDefault(); void remove(); }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function CommitmentDialog({ commitment, onClose }: { commitment: CommitmentDTO | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"tithe_percent" | "fixed_amount">(
    (commitment?.commitmentType as "tithe_percent" | "fixed_amount") ?? "tithe_percent",
  );
  const [percent, setPercent] = useState(commitment?.percent ? String(commitment.percent) : "10");
  const [amount, setAmount] = useState(commitment?.fixedAmountCents ? (commitment.fixedAmountCents / 100).toFixed(2) : "");
  const [frequency, setFrequency] = useState(commitment?.frequency ?? "monthly");
  const [busy, setBusy] = useState(false);

  const percentNum = Number(percent);
  const amountCents = Math.round(Number(amount) * 100);
  const valid = type === "tithe_percent"
    ? Number.isFinite(percentNum) && percentNum > 0 && percentNum <= 100
    : Number.isFinite(amountCents) && amountCents >= 100;

  async function save() {
    setBusy(true);
    try {
      await api.post("/giving/me/commitment", {
        commitmentType: type,
        percent: type === "tithe_percent" ? percentNum : undefined,
        fixedAmountCents: type === "fixed_amount" ? amountCents : undefined,
        frequency: frequency || undefined,
      });
      toast.success("Commitment saved");
      void qc.invalidateQueries({ queryKey: ["my-giving"] });
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tithe commitment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup value={type} onValueChange={(v) => setType(v as "tithe_percent" | "fixed_amount")} className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm" htmlFor="cmt-pct">
              <RadioGroupItem value="tithe_percent" id="cmt-pct" /> Percent of income
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm" htmlFor="cmt-fixed">
              <RadioGroupItem value="fixed_amount" id="cmt-fixed" /> Fixed amount
            </label>
          </RadioGroup>
          {type === "tithe_percent" ? (
            <div className="space-y-1.5">
              <Label htmlFor="cmt-percent">Percent</Label>
              <div className="relative w-28">
                <Input id="cmt-percent" inputMode="decimal" className="pr-7" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, ""))} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="cmt-amount">Amount</Label>
              <div className="relative w-36">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input id="cmt-amount" inputMode="decimal" className="pl-7" placeholder="100.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cmt-freq">Cadence (optional)</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger id="cmt-freq" aria-label="Commitment cadence"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="annual">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => void save()}>{busy ? "Saving…" : "Save commitment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecurringRow({ gift }: { gift: MyRecurringDTO }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function act(action: "pause" | "resume" | "cancel") {
    setBusy(true);
    try {
      await api.post(`/recurring-gifts/${gift.id}/${action}`, {});
      toast.success(action === "cancel" ? "Recurring gift canceled" : action === "pause" ? "Paused — nothing will charge" : "Resumed");
      void qc.invalidateQueries({ queryKey: ["my-giving"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {fmtMoney(gift.amountCents)} · {gift.fund?.name ?? "Fund"}
        </p>
        <p className="text-xs text-muted-foreground">
          {FREQ_LABELS[gift.frequency] ?? gift.frequency}
          {gift.nextRunAt && gift.status === "active" ? ` · next ${fmtDate(gift.nextRunAt)}` : ""}
          {gift.status === "paused" ? " · paused" : ""}
        </p>
      </div>
      <StatusBadge status={gift.status} />
      <div className="flex shrink-0 gap-1.5">
        {gift.status === "active" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("pause")} aria-label="Pause recurring gift">
            <Pause className="h-3.5 w-3.5" /> Pause
          </Button>
        ) : null}
        {gift.status === "paused" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("resume")} aria-label="Resume recurring gift">
            <Play className="h-3.5 w-3.5" /> Resume
          </Button>
        ) : null}
        {gift.status !== "canceled" ? (
          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950" disabled={busy} onClick={() => setConfirmCancel(true)} aria-label="Cancel recurring gift">
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        ) : null}
      </div>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this recurring gift?</AlertDialogTitle>
            <AlertDialogDescription>
              No further charges will be made. Your past gifts stay in your history. You can set up a new recurring gift any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={(e) => { e.preventDefault(); void act("cancel"); }}>
              Cancel gift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/* ───────────────────────────── statements ───────────────────────────── */

function StatementsTab() {
  const q = useApiQuery<{ items: MyStatementDTO[] }>(["my-giving", "statements"], "/statements");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const items = q.data?.items ?? [];

  return (
    <Section title="Tax statements" description="Annual contribution statements with the IRS-required language.">
      {q.isLoading ? (
        <LoadingBlock label="Loading…" />
      ) : q.isError ? (
        <ErrorBlock error={q.error} />
      ) : items.length === 0 ? (
        <EmptyState icon={FileText} title="No statements yet" description="Statements are generated by the finance team after year-end." />
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.taxYear} giving statement</p>
                <p className="text-xs text-muted-foreground">
                  {s.householdName ?? s.personName} · {fmtMoney(s.totalCents)} total
                </p>
              </div>
              <StatusBadge status={s.status} />
              <Button size="sm" variant="outline" onClick={() => setPreviewId(s.id)} aria-label={`View ${s.taxYear} statement`}>
                <Printer className="h-3.5 w-3.5" /> View / Print
              </Button>
            </li>
          ))}
        </ul>
      )}

      {previewId ? <StatementPreviewDialog statementId={previewId} onClose={() => setPreviewId(null)} /> : null}
    </Section>
  );
}

function StatementPreviewDialog({ statementId, onClose }: { statementId: string; onClose: () => void }) {
  const q = useApiQuery<{ html: string }>(["my-giving", "statement", statementId], `/statements/${statementId}/preview`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Giving statement</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <LoadingBlock label="Preparing statement…" />
        ) : q.isError ? (
          <ErrorBlock error={q.error} />
        ) : (
          <iframe
            title="Giving statement preview"
            srcDoc={q.data?.html ?? ""}
            className="h-[60vh] w-full rounded-md border bg-white"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
