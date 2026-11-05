"use client";

/**
 * GLTab — General Ledger tab (modernized).
 *
 * Section 1 · Chart of Accounts: full customization (edit / archive / restore / delete),
 *   search, show-archived toggle, per-type groups with counts, and an account ledger
 *   drawer with from/to date filters and a running balance.
 * Section 2 · Journal: GL entries with JE references (JE-2026-0001 style), manual
 *   balanced double-entry posting, expandable line detail and append-only reversals.
 *
 * Money is integer kobo everywhere — MoneyInput emits cents, fmtMoney renders naira.
 */

import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  Landmark,
  Pencil,
  Plus,
  Scale,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import { api, ApiError, qs } from "@/lib/api";
import { fmtDate, fmtMoney, type FundDTO, type SessionUser } from "@/lib/types";
import { EmptyState, ErrorBlock, LoadingBlock, Section, useApiQuery } from "@/components/app/shared";
import { AccountSelect, KpiRow, MoneyInput, StatusPill } from "./accounting-shared";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// ── types ─────────────────────────────────────────────────────────────────────

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  fundRestriction?: string;
  functionalClass?: string | null;
  parentAccountId?: string | null;
  description?: string | null;
  sortOrder?: number | null;
  isActive: boolean;
  balanceCents: number;
}

interface LedgerLine {
  id: string;
  entryDate: string;
  journalEntryId: string;
  reference?: string | null;
  memo?: string | null;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

interface LedgerResp {
  account: { id: string; code: string; name: string; type: string };
  lines: LedgerLine[];
  openingBalanceCents: number;
  endingBalanceCents: number;
}

interface JELine {
  id: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  debitCents: number;
  creditCents: number;
  fundId?: string | null;
}

interface JournalEntry {
  id: string;
  entryDate: string;
  memo: string | null;
  sourceType: string;
  sourceId: string | null;
  reference?: string | null;
  createdByName?: string | null;
  reversedByEntryId?: string | null;
  lines: JELine[];
}

// ── constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = ["asset", "liability", "net_asset", "revenue", "expense"] as const;
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  net_asset: "Net Assets",
  revenue: "Revenue",
  expense: "Expenses",
};

const RESTRICTION_VALUES = ["unrestricted", "temp_restricted", "perm_restricted"] as const;
const RESTRICTION_LABELS: Record<string, string> = {
  unrestricted: "Unrestricted",
  temp_restricted: "Temp restricted",
  perm_restricted: "Perm restricted",
};

const FUNC_CLASS_VALUES = ["program", "admin", "fundraising"] as const;
const FUNC_CLASS_LABELS: Record<string, string> = {
  program: "Program",
  admin: "Admin",
  fundraising: "Fundraising",
};

/** Small colour dot per account-type group header (ledger scanning aid). */
const TYPE_DOT: Record<string, string> = {
  asset: "bg-emerald-500",
  liability: "bg-amber-500",
  net_asset: "bg-violet-500",
  revenue: "bg-sky-500",
  expense: "bg-rose-500",
};

/** Source-type label + pill tone map for journal rows. */
const SOURCE_PILL: Record<string, { label: string; tone: string }> = {
  donation: { label: "Gift", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  bill: { label: "Bill", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  bill_payment: { label: "Bill payment", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  manual_journal: { label: "Manual", tone: "bg-muted text-muted-foreground" },
  manual: { label: "Manual", tone: "bg-muted text-muted-foreground" },
  payment_voucher: { label: "Payment voucher", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  payroll: { label: "Payroll (legacy)", tone: "bg-muted text-muted-foreground" },
  payroll_run: { label: "Payroll", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  remittance_accrual: { label: "Remittance accrual", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  remittance_payment: { label: "Remittance payment", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  other_receipt: { label: "Other receipt", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  cash_deposit: { label: "Cash deposit", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  petty_cash: { label: "Petty cash", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  petty_replenish: { label: "Petty replenish", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  asset_acquisition: { label: "Asset acquisition", tone: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200" },
  asset_disposal: { label: "Asset disposal", tone: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200" },
  bank_charge: { label: "Bank charge", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
  reversal: { label: "Reversal", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
};

const JE_STATUS_PILL: Record<string, { label: string; tone: string }> = {
  posted: { label: "Posted", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  reversed: { label: "Reversed", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
};

const ACCOUNT_STATUS_PILL: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  archived: { label: "Archived", tone: "bg-muted text-muted-foreground" },
};

const RESTRICTION_PILL: Record<string, { label: string; tone: string }> = {
  unrestricted: { label: "Unrestricted", tone: "bg-muted text-muted-foreground" },
  temp_restricted: { label: "Temp restricted", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  perm_restricted: { label: "Perm restricted", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
};

const FUNC_CLASS_PILL: Record<string, { label: string; tone: string }> = {
  program: { label: "Program", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  admin: { label: "Admin", tone: "bg-muted text-muted-foreground" },
  fundraising: { label: "Fundraising", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
};

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

/** NaN-safe kobo guard for MoneyInput emissions (cleared inputs emit NaN). */
function safeCents(c: number | null | undefined): number {
  return c != null && Number.isFinite(c) && c > 0 ? Math.round(c) : 0;
}

// ═════════════════════════════ MAIN TAB ═══════════════════════════════════════

export function GLTab({ user, canManage }: { user: SessionUser; canManage: boolean }) {
  const qc = useQueryClient();
  const accountsQ = useApiQuery<{ items: AccountRow[] }>(["accounts"], "/accounts");

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [deleting, setDeleting] = useState<AccountRow | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  const all = useMemo(() => accountsQ.data?.items ?? [], [accountsQ.data]);
  const archivedCount = useMemo(() => all.filter((a) => !a.isActive).length, [all]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((a) => {
      if (!showArchived && !a.isActive) return false;
      if (!q) return true;
      return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
  }, [all, search, showArchived]);

  const byType = useMemo(() => {
    const m = new Map<string, AccountRow[]>();
    for (const t of ACCOUNT_TYPES) m.set(t, []);
    for (const a of visible) m.get(a.type)?.push(a);
    for (const list of m.values()) {
      list.sort((x, y) => x.code.localeCompare(y.code, "en", { numeric: true }));
    }
    return m;
  }, [visible]);

  async function toggleArchive(a: AccountRow) {
    setBusyAccountId(a.id);
    try {
      await api.patch(`/accounts/${a.id}`, { isActive: !a.isActive });
      toast.success(a.isActive ? `Account ${a.code} archived.` : `Account ${a.code} restored.`);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyAccountId(null);
    }
  }

  async function doDelete() {
    if (!deleting) return;
    setBusyAccountId(deleting.id);
    try {
      await api.del(`/accounts/${deleting.id}`);
      toast.success(`Account ${deleting.code} deleted.`);
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      // 409 and friends: always surface the server message (archive-instead guidance).
      toast.error(errMsg(e));
    } finally {
      setBusyAccountId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* ═══════════ SECTION 1 · CHART OF ACCOUNTS ═══════════ */}
      <Section
        title="Chart of accounts"
        icon={BookOpenCheck}
        description="The general ledger structure — every bank, fund, liability and expense lives here. Rename and reclassify freely; posted balances always stay intact."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code or name…"
                aria-label="Search accounts by code or name"
                className="h-9 w-44 pl-8"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Switch id="gl-show-archived" checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived accounts" />
              <Label htmlFor="gl-show-archived" className="cursor-pointer text-xs text-muted-foreground">
                Show archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
              </Label>
            </div>
            {canManage ? (
              <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" /> New account
              </Button>
            ) : null}
          </div>
        }
      >
        {accountsQ.isLoading ? (
          <LoadingBlock label="Loading chart of accounts…" />
        ) : accountsQ.isError ? (
          <ErrorBlock error={accountsQ.error} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={BookOpenCheck}
            title="No accounts yet"
            description={canManage ? "Create your first GL account to start posting balanced entries." : "The seed chart appears here once the ledger is initialised."}
            action={
              canManage ? (
                <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
                  <Plus className="h-4 w-4" /> New account
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {visible.length === 0 ? (
              <EmptyState icon={Search} title="No matches" description={`No accounts match “${search.trim()}”.`} />
            ) : (
              /* One full-width grouped ledger table — QuickBooks-style type sections as
                 full-width header rows. No inner scrollbars, no side-by-side card crush. */
              <Card className="gap-0 overflow-hidden py-0">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="w-16">Code</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="hidden md:table-cell">Restriction / Class</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="hidden w-28 lg:table-cell">Status</TableHead>
                      <TableHead className="w-[7.25rem] text-right"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ACCOUNT_TYPES.map((t) => {
                      const list = byType.get(t) ?? [];
                      if (!list.length) return null;
                      const groupTotal = list.reduce((s, a) => s + (a.balanceCents ?? 0), 0);
                      return (
                        <Fragment key={t}>
                          {/* type section header row */}
                          <TableRow className="bg-muted/45 hover:bg-muted/45">
                            <TableCell colSpan={6} className="h-10 py-0">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${TYPE_DOT[t]}`} aria-hidden />
                                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {ACCOUNT_TYPE_LABELS[t]}
                                  </span>
                                  <Badge variant="secondary" className="px-1.5 text-[10px]">{list.length}</Badge>
                                </div>
                                <span className="text-xs font-semibold tabular-nums text-muted-foreground">{fmtMoney(groupTotal)}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {list.map((a) => (
                            <TableRow key={a.id} className={`group ${a.isActive ? undefined : "opacity-60"}`}>
                              <TableCell className="font-mono text-xs text-muted-foreground">{a.code}</TableCell>
                              <TableCell>
                                <div className="font-medium leading-tight">{a.name}</div>
                                {a.description ? (
                                  <div className="line-clamp-1 text-xs text-muted-foreground">{a.description}</div>
                                ) : null}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                <div className="flex flex-wrap gap-1">
                                  <StatusPill status={a.fundRestriction ?? "unrestricted"} map={RESTRICTION_PILL} />
                                  {a.functionalClass ? <StatusPill status={a.functionalClass} map={FUNC_CLASS_PILL} /> : null}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">{fmtMoney(a.balanceCents)}</TableCell>
                              <TableCell className="hidden lg:table-cell">
                                <StatusPill status={a.isActive ? "active" : "archived"} map={ACCOUNT_STATUS_PILL} />
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    aria-label={`View ledger for ${a.code} ${a.name}`}
                                    title="View ledger"
                                    onClick={() => setLedgerId(a.id)}
                                  >
                                    <Landmark className="h-3.5 w-3.5" />
                                  </Button>
                                  {canManage ? (
                                    <>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                        aria-label={`Edit account ${a.code} ${a.name}`}
                                        title="Edit account"
                                        onClick={() => setEditing(a)}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                        disabled={busyAccountId === a.id}
                                        aria-label={`${a.isActive ? "Archive" : "Restore"} account ${a.code} ${a.name}`}
                                        title={a.isActive ? "Archive account" : "Restore account"}
                                        onClick={() => void toggleArchive(a)}
                                      >
                                        {a.isActive ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-danger hover:text-danger"
                                        aria-label={`Delete account ${a.code} ${a.name}`}
                                        title="Delete account"
                                        onClick={() => setDeleting(a)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </div>
        )}
      </Section>

      {/* ═══════════ SECTION 2 · JOURNAL ═══════════ */}
      <JournalSection user={user} canManage={canManage} />

      {/* dialogs & drawers */}
      {newOpen ? <AccountDialog existing={null} onClose={() => setNewOpen(false)} /> : null}
      {editing ? <AccountDialog existing={editing} onClose={() => setEditing(null)} /> : null}
      {ledgerId ? <LedgerDrawer accountId={ledgerId} onClose={() => setLedgerId(null)} /> : null}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.name}” will be permanently removed from the chart. Accounts with accounting activity
              or module mappings cannot be deleted — archive them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              disabled={busyAccountId === deleting?.id}
              onClick={(ev) => {
                ev.preventDefault();
                void doDelete();
              }}
            >
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═════════════════════════════ JOURNAL SECTION ════════════════════════════════

function JournalSection({ user, canManage }: { user: SessionUser; canManage: boolean }) {
  const qc = useQueryClient();
  const jeQ = useApiQuery<{ items: JournalEntry[] }>(["journal-entries"], "/journal-entries?take=50");
  const accountsQ = useApiQuery<{ items: AccountRow[] }>(["accounts"], "/accounts");
  const fundsQ = useApiQuery<{ items: FundDTO[] }>(["funds"], "/funds");

  const [manualOpen, setManualOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const [reason, setReason] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);

  const items = useMemo(() => jeQ.data?.items ?? [], [jeQ.data]);
  const accountMap = useMemo(() => new Map((accountsQ.data?.items ?? []).map((a) => [a.id, a])), [accountsQ.data]);
  const fundMap = useMemo(() => new Map((fundsQ.data?.items ?? []).map((f) => [f.id, f])), [fundsQ.data]);

  const totalDebits = items.reduce((s, e) => s + e.lines.reduce((x, l) => x + (l.debitCents || 0), 0), 0);
  const totalCredits = items.reduce((s, e) => s + e.lines.reduce((x, l) => x + (l.creditCents || 0), 0), 0);
  const inBalance = totalDebits === totalCredits;

  const colCount = canManage ? 9 : 8;

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function doReverse() {
    if (!reversing || !reason.trim()) return;
    setReverseBusy(true);
    try {
      await api.post(`/journal-entries/${reversing.id}/reverse`, { reason: reason.trim() });
      toast.success("Reversing entry posted — the original stays untouched.");
      setReversing(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setReverseBusy(false);
    }
  }

  return (
    <Section
      title="Journal"
      icon={Scale}
      description="Every posting in double-entry form with its GL reference (JE-2026-0001). Entries are append-only — corrections are reversing entries, never edits."
      actions={
        canManage ? (
          <Button size="sm" className="gap-1.5" onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" /> Record manual entry
          </Button>
        ) : undefined
      }
    >
      <KpiRow
        items={[
          { label: "Entries (latest 50)", value: String(items.length) },
          { label: "Total debits", value: fmtMoney(totalDebits) },
          { label: "Total credits", value: fmtMoney(totalCredits) },
          {
            label: "Debits = credits",
            value: inBalance ? "✓ Balanced" : `Off by ${fmtMoney(Math.abs(totalDebits - totalCredits))}`,
            tone: inBalance ? "positive" : "negative",
          },
        ]}
      />

      {jeQ.isLoading ? (
        <LoadingBlock label="Loading journal entries…" />
      ) : jeQ.isError ? (
        <ErrorBlock error={jeQ.error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No journal entries yet"
          description="Post a gift, bill or manual entry — every posting lands here with its JE reference."
          action={
            canManage ? (
              <Button size="sm" className="gap-1.5" onClick={() => setManualOpen(true)}>
                <Plus className="h-4 w-4" /> Record manual entry
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="max-h-[36rem] overflow-x-auto overflow-y-auto rounded-xl border scroll-slim">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-10"><span className="sr-only">Expand</span></TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden md:table-cell">Created by</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => {
                const isExpanded = expandedIds.includes(e.id);
                const amountCents = e.lines.reduce((s, l) => s + (l.debitCents || 0), 0);
                const reverseBlocked = !!e.reversedByEntryId || e.sourceType === "reversal";
                return (
                  <JournalRow
                    key={e.id}
                    entry={e}
                    canManage={canManage}
                    isExpanded={isExpanded}
                    colCount={colCount}
                    amountCents={amountCents}
                    reverseBlocked={reverseBlocked}
                    viewerName={user.name}
                    accountMap={accountMap}
                    fundMap={fundMap}
                    onToggle={() => toggleExpanded(e.id)}
                    onReverse={() => {
                      setReversing(e);
                      setReason("");
                    }}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* manual entry dialog */}
      {manualOpen ? <ManualEntryDialog onClose={() => setManualOpen(false)} /> : null}

      {/* reversal confirm */}
      <AlertDialog
        open={!!reversing}
        onOpenChange={(o) => {
          if (!o) {
            setReversing(null);
            setReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this journal entry?</AlertDialogTitle>
            <AlertDialogDescription>
              An append-only reversing entry is created (debits and credits swapped) — the original is never edited.
              {reversing?.reference ? ` This affects ${reversing.reference}.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason for reversal (required) — e.g. duplicate posting on 12 Mar"
            aria-label="Reason for reversal"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim() || reverseBusy}
              onClick={(ev) => {
                ev.preventDefault();
                void doReverse();
              }}
            >
              {reverseBusy ? "Posting…" : "Reverse entry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

// ── journal row + expandable line detail ──────────────────────────────────────

function JournalRow({
  entry: e,
  canManage,
  isExpanded,
  colCount,
  amountCents,
  reverseBlocked,
  viewerName,
  accountMap,
  fundMap,
  onToggle,
  onReverse,
}: {
  entry: JournalEntry;
  canManage: boolean;
  isExpanded: boolean;
  colCount: number;
  amountCents: number;
  reverseBlocked: boolean;
  viewerName: string;
  accountMap: Map<string, AccountRow>;
  fundMap: Map<string, FundDTO>;
  onToggle: () => void;
  onReverse: () => void;
}) {
  return (
    <>
      <TableRow>
        <TableCell>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `Collapse lines for ${e.reference ?? "entry"}` : `Expand lines for ${e.reference ?? "entry"}`}
            onClick={onToggle}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{e.reference ?? "—"}</TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(e.entryDate)}</TableCell>
        <TableCell className="max-w-[14rem] truncate text-sm">{e.memo ?? "—"}</TableCell>
        <TableCell className="hidden lg:table-cell">
          <StatusPill status={e.sourceType} map={SOURCE_PILL} />
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">{fmtMoney(amountCents)}</TableCell>
        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
          {e.createdByName ?? "—"}
          {e.createdByName && e.createdByName === viewerName ? <span className="text-foreground/70"> (you)</span> : null}
        </TableCell>
        <TableCell>
          <StatusPill status={e.reversedByEntryId ? "reversed" : "posted"} map={JE_STATUS_PILL} />
        </TableCell>
        {canManage ? (
          <TableCell className="text-right">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              disabled={reverseBlocked}
              title={reverseBlocked ? "Already reversed, or a reversal itself" : "Post a reversing entry"}
              onClick={onReverse}
            >
              <Undo2 className="h-3.5 w-3.5" /> Reverse
            </Button>
          </TableCell>
        ) : null}
      </TableRow>
      {isExpanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colCount} className="bg-muted/30 p-0">
            <div className="overflow-x-auto px-4 py-3 scroll-slim">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-xs font-medium text-muted-foreground">
                    <th className="py-1 text-left font-medium">Account</th>
                    <th className="hidden py-1 text-left font-medium sm:table-cell">Fund</th>
                    <th className="py-1 text-right font-medium">Debit</th>
                    <th className="py-1 text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lines.map((l) => {
                    const acct = accountMap.get(l.accountId);
                    const code = l.accountCode ?? acct?.code ?? "—";
                    const name = l.accountName ?? acct?.name ?? "Unknown account";
                    const fund = l.fundId ? fundMap.get(l.fundId) : undefined;
                    return (
                      <tr key={l.id} className="border-t border-border/60">
                        <td className="py-1.5">
                          <span className="mr-2 font-mono text-xs text-muted-foreground">{code}</span>
                          {name}
                        </td>
                        <td className="hidden py-1.5 text-xs text-muted-foreground sm:table-cell">
                          {fund ? `${fund.name} (${fund.code})` : "—"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{l.debitCents ? fmtMoney(l.debitCents) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{l.creditCents ? fmtMoney(l.creditCents) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

// ═══════════════════════ MANUAL ENTRY DIALOG ══════════════════════════════════

interface DraftLine {
  accountId: string;
  debitCents: number | null;
  creditCents: number | null;
}

function ManualEntryDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { accountId: "", debitCents: null, creditCents: null },
    { accountId: "", debitCents: null, creditCents: null },
  ]);
  const [busy, setBusy] = useState(false);

  const debitTotal = lines.reduce((s, l) => s + safeCents(l.debitCents), 0);
  const creditTotal = lines.reduce((s, l) => s + safeCents(l.creditCents), 0);
  const nonZeroCount = lines.filter((l) => l.accountId && (safeCents(l.debitCents) > 0 || safeCents(l.creditCents) > 0)).length;
  const stripOk = debitTotal > 0 && debitTotal === creditTotal;
  const balanced =
    stripOk &&
    nonZeroCount >= 2 &&
    lines.every((l) => !(safeCents(l.debitCents) > 0 && safeCents(l.creditCents) > 0)) &&
    lines.every((l) => (safeCents(l.debitCents) > 0 || safeCents(l.creditCents) > 0 ? !!l.accountId : true));

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)));
  }

  async function save() {
    if (!balanced) {
      toast.error("Debits must equal credits and every line needs an account.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/journal-entries/manual", {
        entryDate,
        memo: memo.trim() || undefined,
        lines: lines
          .filter((l) => l.accountId && (safeCents(l.debitCents) > 0 || safeCents(l.creditCents) > 0))
          .map((l) => ({ accountId: l.accountId, debitCents: safeCents(l.debitCents), creditCents: safeCents(l.creditCents) })),
      });
      toast.success("Journal entry posted — balanced double entry recorded.");
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record manual entry</DialogTitle>
          <DialogDescription>
            Multi-line debit / credit builder. The server enforces debits = credits to the kobo — an unbalanced
            entry never hits the book. Corrections are reversing entries, never edits.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="gl-je-date">Date</Label>
            <Input id="gl-je-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gl-je-memo">Memo</Label>
            <Input id="gl-je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Reclassify generator fuel to 6100" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="hidden grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_2rem] gap-2 px-1 text-xs font-semibold text-muted-foreground sm:grid">
            <span>Account</span>
            <span className="text-right">Debit (₦)</span>
            <span className="text-right">Credit (₦)</span>
            <span />
          </div>
          <div className="overflow-x-auto scroll-slim">
            <div className="min-w-[30rem] space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_2rem] items-center gap-2">
                  <AccountSelect
                    value={l.accountId || undefined}
                    onValueChange={(v) => updateLine(i, { accountId: v })}
                    placeholder="Select account"
                  />
                  <MoneyInput value={l.debitCents} onChange={(c) => updateLine(i, { debitCents: c, creditCents: null })} />
                  <MoneyInput value={l.creditCents} onChange={(c) => updateLine(i, { creditCents: c, debitCents: null })} />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={lines.length <= 2}
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() => removeLine(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setLines((p) => [...p, { accountId: "", debitCents: null, creditCents: null }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add line
          </Button>
        </div>

        <div
          className={`rounded-md px-3 py-2 text-sm ${
            stripOk
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
          }`}
          role="status"
        >
          Debits <span className="font-mono">{fmtMoney(debitTotal)}</span> · Credits{" "}
          <span className="font-mono">{fmtMoney(creditTotal)}</span>{" "}
          {stripOk ? "✓ Balanced" : `— off by ${fmtMoney(Math.abs(debitTotal - creditTotal))}`}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !balanced} onClick={() => void save()}>
            {busy ? "Posting…" : "Post entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════ NEW / EDIT ACCOUNT DIALOG ════════════════════════════

function AccountDialog({ existing, onClose }: { existing: AccountRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const [code, setCode] = useState(existing?.code ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState(existing?.type ?? "expense");
  const [fundRestriction, setFundRestriction] = useState(existing?.fundRestriction ?? "unrestricted");
  const [functionalClass, setFunctionalClass] = useState(existing?.functionalClass ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!code.trim() || !name.trim()) {
      toast.error("Account code and name are required.");
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await api.patch(`/accounts/${existing.id}`, {
          name: name.trim(),
          type,
          fundRestriction,
          functionalClass: type === "expense" ? functionalClass || undefined : undefined,
          description: description.trim() || undefined,
        });
        toast.success(`Account ${existing.code} updated.`);
      } else {
        await api.post("/accounts", {
          code: code.trim(),
          name: name.trim(),
          type,
          fundRestriction,
          functionalClass: type === "expense" ? functionalClass || undefined : undefined,
        });
        toast.success(`Account ${code.trim()} created.`);
      }
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    } catch (e) {
      // Type changes on accounts with journal activity are rejected server-side — show why.
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit account ${existing.code}` : "New account"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update naming, classification and notes. Codes are immutable once created."
              : "Codes follow your chart numbering — e.g. 1xxx assets, 4xxx revenue, 6xxx expenses."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="gl-acct-code">Code *</Label>
              <Input
                id="gl-acct-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={isEdit}
                placeholder="6100"
                className="font-mono"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gl-acct-type">Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="gl-acct-type" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="gl-acct-name">Name *</Label>
            <Input id="gl-acct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Utilities" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="gl-acct-restriction">Fund restriction</Label>
              <Select value={fundRestriction} onValueChange={setFundRestriction}>
                <SelectTrigger id="gl-acct-restriction" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESTRICTION_VALUES.map((r) => (
                    <SelectItem key={r} value={r}>{RESTRICTION_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {type === "expense" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="gl-acct-func">Functional class</Label>
                <Select value={functionalClass || undefined} onValueChange={setFunctionalClass}>
                  <SelectTrigger id="gl-acct-func" className="w-full"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    {FUNC_CLASS_VALUES.map((f) => (
                      <SelectItem key={f} value={f}>{FUNC_CLASS_LABELS[f]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="gl-acct-desc">Description</Label>
            <Textarea
              id="gl-acct-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What posts here, and any usage policy — e.g. Fuel, servicing and repairs for generators."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !code.trim() || !name.trim()} onClick={() => void save()}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════ ACCOUNT LEDGER DRAWER ════════════════════════════════

function LedgerDrawer({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useApiQuery<LedgerResp>(
    ["account-ledger", accountId, from, to],
    `/accounts/${accountId}/ledger${qs({ from, to })}`,
  );

  const lines = q.data?.lines ?? [];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b pr-10">
          <SheetTitle className="flex items-center gap-2">
            {q.data ? (
              <>
                <span className="font-mono text-muted-foreground">{q.data.account.code}</span>
                {q.data.account.name}
              </>
            ) : (
              "Account ledger"
            )}
          </SheetTitle>
          <SheetDescription>Running balance on the natural side — filter by posting date.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
          <div className="grid gap-1">
            <Label htmlFor="gl-ledger-from" className="text-xs text-muted-foreground">From</Label>
            <Input id="gl-ledger-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="gl-ledger-to" className="text-xs text-muted-foreground">To</Label>
            <Input id="gl-ledger-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
          </div>
          {from || to ? (
            <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>
              Clear dates
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            Opening <span className="font-mono font-medium text-foreground">{fmtMoney(q.data?.openingBalanceCents ?? 0)}</span>
          </span>
          <span className="text-muted-foreground">
            Ending <span className="font-mono font-semibold text-foreground">{fmtMoney(q.data?.endingBalanceCents ?? 0)}</span>
          </span>
        </div>

        {q.isLoading ? (
          <LoadingBlock label="Loading ledger…" />
        ) : q.isError ? (
          <div className="p-4"><ErrorBlock error={q.error} /></div>
        ) : lines.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No movement yet"
            description="No journal lines touch this account in the selected period."
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
            <div className="overflow-x-auto px-4 py-3 scroll-slim">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>JE ref</TableHead>
                    <TableHead>Memo</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(l.entryDate)}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{l.reference ?? "—"}</TableCell>
                      <TableCell className="max-w-[12rem] truncate text-xs">{l.memo ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{l.debitCents ? fmtMoney(l.debitCents) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{l.creditCents ? fmtMoney(l.creditCents) : "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmtMoney(l.balanceCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
