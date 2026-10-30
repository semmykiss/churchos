"use client";

/**
 * MyGivingPortal — member self-service giving (giving.view.own + giving.give).
 * Warm, low-density, mobile-first: this is what a congregant opens on their
 * phone during a Sunday service. Every query is server-scoped to the signed-in
 * person — the member physically cannot see anyone else's giving.
 *
 * Batch A (security patch): History, Recurring & Pledges (self-service pause/
 * resume/cancel), Statements (own household statements + IRS-language preview).
 * Batch B adds the Give-now hero with tithe calculator + payment methods.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HandCoins, HeartHandshake, Receipt, Repeat, FileText, Printer, Pause, Play, Target, X } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, Section, StatusBadge, useApiQuery,
} from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtMoney, type DonationDTO } from "@/lib/types";
import type { SessionUser } from "@/lib/types";

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
  const [tab, setTab] = useState<"history" | "recurring" | "statements">("history");

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
          ["history", "History", Receipt],
          ["recurring", "Recurring & Pledges", Repeat],
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

      {tab === "history" ? <HistoryTab /> : null}
      {tab === "recurring" ? <RecurringPledgesTab /> : null}
      {tab === "statements" ? <StatementsTab /> : null}
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

function RecurringPledgesTab() {
  const recQ = useApiQuery<{ items: MyRecurringDTO[] }>(["my-giving", "recurring"], "/recurring-gifts");
  const pledgesQ = useApiQuery<{ items: MyPledgeDTO[] }>(["my-giving", "pledges"], "/pledges");
  const rec = recQ.data?.items ?? [];
  const pledges = pledgesQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Section title="Recurring gifts" description="Manage your automatic giving — pause any time, resume when ready.">
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

      <Section title="Your pledges" description="Commitments you've made toward funds and campaigns.">
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
