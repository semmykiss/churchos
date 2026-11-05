"use client";

/**
 * SimpleMode — income & expenses for churches without a trained accountant.
 *
 * Speaks plain language (money in / money out, categories, cash box vs bank) and
 * hides all double-entry jargon. Every posting still lands as a balanced journal
 * entry through /journal-entries/manual, so the ledger stays clean and the
 * accountant can switch to Full ledger mode anytime without migration.
 *
 * Activity view = cash movements derived from the latest journal entries:
 *   net cash debits > 0 → Money in · net cash credits > 0 → Money out ·
 *   cash lines that net to zero → internal transfer.
 */

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Info,
  Landmark,
  Repeat,
  Undo2,
  Wallet,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtMoney, type SessionUser } from "@/lib/types";
import { EmptyState, ErrorBlock, LoadingBlock, StatCard, useApiQuery } from "@/components/app/shared";
import { MoneyInput } from "./accounting-shared";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  balanceCents: number;
}

interface JLine {
  id?: string;
  accountCode?: string;
  accountName?: string;
  fundId?: string | null;
  debitCents: number;
  creditCents: number;
}

interface JournalEntry {
  id: string;
  entryDate: string;
  memo: string | null;
  sourceType: string;
  reference?: string | null;
  reversedByEntryId?: string | null;
  lines: JLine[];
}

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

/** NaN-safe kobo guard (MoneyInput emits NaN when cleared). */
function safeCents(c: number | null | undefined): number {
  return c != null && Number.isFinite(c) && c > 0 ? Math.round(c) : 0;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ═════════════════════════════ MAIN ═══════════════════════════════════════════

export function SimpleMode({ user, canManage }: { user: SessionUser; canManage: boolean }) {
  const qc = useQueryClient();
  const accountsQ = useApiQuery<{ items: AccountRow[] }>(["accounts"], "/accounts");
  const jeQ = useApiQuery<{ items: JournalEntry[] }>(["journal-entries"], "/journal-entries?take=100");

  const [dialog, setDialog] = useState<"in" | "out" | null>(null);

  const all = useMemo(() => accountsQ.data?.items ?? [], [accountsQ.data]);

  /** Cash & bank accounts (10xx current-asset cash lines; falls back to all assets). */
  const cashAccounts = useMemo(() => {
    const cash = all.filter((a) => a.isActive && a.type === "asset" && (a.code.startsWith("10") || /cash|bank|saving/i.test(a.name)));
    return cash.length ? cash : all.filter((a) => a.isActive && a.type === "asset");
  }, [all]);
  const cashIds = useMemo(() => new Set(cashAccounts.map((a) => a.id)), [cashAccounts]);
  /** JE list lines carry accountCode / accountName (not accountId) — match on both. */
  const cashCodes = useMemo(() => new Set(cashAccounts.map((a) => a.code)), [cashAccounts]);
  const cashNames = useMemo(() => new Set(cashAccounts.map((a) => a.name)), [cashAccounts]);
  const isCashLine = useCallback(
    (l: JLine) =>
      (l.accountCode != null && cashCodes.has(l.accountCode)) ||
      (l.accountCode == null && l.accountName != null && cashNames.has(l.accountName)),
    [cashCodes, cashNames],
  );

  const revenueAccounts = useMemo(() => all.filter((a) => a.isActive && a.type === "revenue"), [all]);
  const expenseAccounts = useMemo(() => all.filter((a) => a.isActive && a.type === "expense"), [all]);

  const entries = useMemo(() => jeQ.data?.items ?? [], [jeQ.data]);

  /** Classify each journal entry into plain-language cash movement. */
  const activity = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    let inMonth = 0;
    let outMonth = 0;
    const rows: {
      key: string;
      date: string;
      dir: "in" | "out" | "transfer";
      amountCents: number;
      label: string;
      category: string;
      reference?: string | null;
      reversed: boolean;
    }[] = [];

    for (const e of entries) {
      let cashDebit = 0;
      let cashCredit = 0;
      let counterpart = "";
      for (const l of e.lines) {
        if (isCashLine(l)) {
          cashDebit += l.debitCents || 0;
          cashCredit += l.creditCents || 0;
        } else if (!counterpart) {
          counterpart = l.accountName ?? "";
        }
      }
      if (cashDebit === 0 && cashCredit === 0) continue; // non-cash posting (accrual etc.)
      const net = cashDebit - cashCredit;
      const dir: "in" | "out" | "transfer" = net > 0 ? "in" : net < 0 ? "out" : "transfer";
      const amountCents = Math.abs(net);
      const label = e.memo?.trim() || counterpart || "Cash movement";
      const category =
        e.lines.find((l) => !isCashLine(l))?.accountName ??
        (dir === "in" ? "Money in" : dir === "out" ? "Money out" : "Transfer");

      if (dir === "in" && !e.reversedByEntryId && e.entryDate.slice(0, 7) === month) inMonth += amountCents;
      if (dir === "out" && !e.reversedByEntryId && e.entryDate.slice(0, 7) === month) outMonth += amountCents;

      rows.push({ key: e.id, date: e.entryDate, dir, amountCents, label, category, reference: e.reference, reversed: !!e.reversedByEntryId });
    }
    return { rows: rows.slice(0, 14), inMonth, outMonth };
  }, [entries, isCashLine]);

  /** Total cash & bank on hand (asset accounts in the cash set). */
  const cashOnHand = useMemo(
    () => all.filter((a) => cashIds.has(a.id)).reduce((s, a) => s + (a.balanceCents ?? 0), 0),
    [all, cashIds],
  );

  const now = new Date();
  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["journal-entries"] });
    void qc.invalidateQueries({ queryKey: ["accounts"] });
  }

  return (
    <div className="space-y-6">
      {/* friendly explainer */}
      <div className="flex items-start gap-2.5 rounded-xl border bg-muted/35 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Simple mode</span> tracks money in and money out — no debits,
          credits or journal codes. Everything is still recorded as a proper balanced double entry behind the scenes,
          so your accountant can switch to <span className="font-medium text-foreground">Full ledger</span> anytime.
        </p>
      </div>

      {/* month summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={`Money in · ${monthLabel}`}
          value={fmtMoney(activity.inMonth)}
          sub="Received this month"
          tone="positive"
        />
        <StatCard
          label={`Money out · ${monthLabel}`}
          value={fmtMoney(activity.outMonth)}
          sub="Spent this month"
          tone="warning"
        />
        <StatCard label="Cash & bank on hand" value={fmtMoney(cashOnHand)} sub="Across all cash and bank accounts" icon={Wallet} />
      </div>

      {/* big friendly actions */}
      {canManage ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setDialog("in")}
            className="group flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-900 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition-transform group-hover:scale-105 dark:bg-emerald-700">
              <ArrowDownLeft className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-emerald-900 dark:text-emerald-100">Record money in</span>
              <span className="block truncate text-xs text-emerald-800/80 dark:text-emerald-200/80">
                Offerings, tithes, donations, sales, rent…
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDialog("out")}
            className="group flex items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-left transition-colors hover:border-amber-300 hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-900 dark:bg-amber-950/40 dark:hover:bg-amber-900/40"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white shadow-sm transition-transform group-hover:scale-105 dark:bg-amber-700">
              <ArrowUpRight className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-amber-900 dark:text-amber-100">Record money out</span>
              <span className="block truncate text-xs text-amber-800/80 dark:text-amber-200/80">
                Salaries, bills, supplies, remittances…
              </span>
            </span>
          </button>
        </div>
      ) : (
        <p className="rounded-lg bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          You have view-only access — ask a finance admin to record entries.
        </p>
      )}

      {/* recent activity */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Recent activity</h3>
          <span className="text-xs text-muted-foreground">Latest {activity.rows.length} cash movements</span>
        </div>
        {accountsQ.isLoading || jeQ.isLoading ? (
          <div className="p-4"><LoadingBlock label="Loading your money story…" /></div>
        ) : accountsQ.isError ? (
          <div className="p-4"><ErrorBlock error={accountsQ.error} /></div>
        ) : jeQ.isError ? (
          <div className="p-4"><ErrorBlock error={jeQ.error} /></div>
        ) : activity.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Landmark}
              title="No money movements yet"
              description={
                canManage
                  ? "Record your first money in or money out above — it lands here instantly."
                  : "Cash movements will appear here once entries are recorded."
              }
            />
          </div>
        ) : (
          <ul className="divide-y">
            {activity.rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    r.dir === "in"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                      : r.dir === "out"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                        : "bg-muted text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  {r.dir === "in" ? <ArrowDownLeft className="h-4 w-4" /> : r.dir === "out" ? <ArrowUpRight className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.label}</span>
                    {r.reversed ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <Undo2 className="h-2.5 w-2.5" aria-hidden /> Reversed
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {fmtDate(r.date)} · {r.category}
                    {r.reference ? ` · ${r.reference}` : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    r.reversed
                      ? "text-muted-foreground line-through"
                      : r.dir === "in"
                        ? "text-emerald-700 dark:text-emerald-300"
                        : r.dir === "out"
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-muted-foreground"
                  }`}
                >
                  {r.dir === "in" ? "+" : r.dir === "out" ? "−" : ""}
                  {fmtMoney(r.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog ? (
        <MoneyDialog
          kind={dialog}
          categories={dialog === "in" ? revenueAccounts : expenseAccounts}
          locations={cashAccounts}
          onClose={() => setDialog(null)}
          onPosted={invalidate}
        />
      ) : null}
    </div>
  );
}

// ═══════════════════════ MONEY IN / OUT DIALOG ════════════════════════════════

function MoneyDialog({
  kind,
  categories,
  locations,
  onClose,
  onPosted,
}: {
  kind: "in" | "out";
  categories: AccountRow[];
  locations: AccountRow[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const isIn = kind === "in";
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const category = categories.find((c) => c.id === categoryId);
  const location = locations.find((l) => l.id === locationId);
  const amount = safeCents(amountCents);

  const ready =
    amount > 0 && !!category && !!location && category.id !== location.id && !!entryDate;

  async function save() {
    if (!ready || !category || !location) {
      if (category && location && category.id === location.id) {
        toast.error("Money can't come from and go to the same place — pick different accounts.");
      }
      return;
    }
    setBusy(true);
    const memo =
      note.trim() ||
      (isIn
        ? `Received — ${category.name} into ${location.name}`
        : `Paid out — ${category.name} from ${location.name}`);
    try {
      await api.post("/journal-entries/manual", {
        entryDate,
        memo,
        lines: isIn
          ? [
              { accountId: location.id, debitCents: amount, creditCents: 0 },
              { accountId: category.id, debitCents: 0, creditCents: amount },
            ]
          : [
              { accountId: category.id, debitCents: amount, creditCents: 0 },
              { accountId: location.id, debitCents: 0, creditCents: amount },
            ],
      });
      toast.success(
        isIn ? "Money in recorded — cash and bank updated." : "Money out recorded — cash and bank updated.",
      );
      onPosted();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-white ${
                isIn ? "bg-emerald-600 dark:bg-emerald-700" : "bg-amber-600 dark:bg-amber-700"
              }`}
              aria-hidden
            >
              {isIn ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            </span>
            {isIn ? "Record money in" : "Record money out"}
          </DialogTitle>
          <DialogDescription>
            {isIn
              ? "Money received by the church — into the cash box, safe or bank account."
              : "Money paid out by the church — from the cash box, safe or bank account."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sm-amount">Amount (₦)</Label>
            <MoneyInput
              id="sm-amount"
              value={amountCents}
              onChange={setAmountCents}
              placeholder="0.00"
              className="h-11 text-lg font-semibold"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sm-category">{isIn ? "Where did it come from?" : "What was it for?"}</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="sm-category" className="h-11">
                <SelectValue placeholder={categories.length ? "Choose a category" : "No categories yet"} />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No {isIn ? "income" : "expense"} categories in the chart yet — add them in Full ledger mode.
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sm-location">{isIn ? "Where is the money now?" : "Paid from where?"}</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger id="sm-location" className="h-11">
                <SelectValue placeholder={locations.length ? "Cash box, safe or bank account" : "No cash accounts yet"} />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sm-date">Date</Label>
            <Input id="sm-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="h-11" />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sm-note">Short note <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="sm-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isIn ? "e.g. Sunday offering — main service" : "e.g. Generator diesel refill"}
            />
          </div>

          {category && location && category.id === location.id ? (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" role="alert">
              Category and location are the same account — pick two different ones.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !ready}
            className={isIn ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600" : "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"}
          >
            {busy ? "Recording…" : isIn ? "Record money in" : "Record money out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
