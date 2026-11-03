"use client";

/**
 * Giving module — trust-critical, append-only ledger.
 * Tabs: Gifts | Collections (service batches + usher count sheets) | Funds | Statements.
 * Money is integer cents end-to-end; reversals create NEW entries, never edits.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney, type BatchDTO, type DonationDTO, type FundDTO, type PersonListItem } from "@/lib/types";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  useApiQuery,
  type ModuleProps,
} from "@/components/app/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useGivingPermissions, type GivingPermissions } from "@/components/app/giving/hooks/useGivingPermissions";
import MyGivingPortal from "@/components/app/giving/MyGivingPortal";
import UsherCollections from "@/components/app/giving/UsherCollections";
import {
  FileText,
  HandCoins,
  Landmark,
  Layers,
  Plus,
  Printer,
  Receipt,
  Search,
  Target,
  Trash2,
  Undo2,
  Wallet,
  X,
  CheckCircle2,
  MessageSquareWarning,
} from "lucide-react";

/* ───────────────────────────── API shapes ───────────────────────────── */

interface StatementDTO {
  id: string;
  personId: string;
  personName: string;
  householdName: string | null;
  taxYear: number;
  totalCents: number;
  status: string;
  generatedAt: string;
  sentAt: string | null;
}

/* ───────────────────────────── helpers ───────────────────────────── */

const METHOD_LABELS: Record<string, string> = {
  card: "Card", ach: "ACH", cash: "Cash", check: "Cheque", other: "Other",
  // Nigerian payment methods (giving-module + accounting share these via accounting-shared NGN_METHOD_LABELS)
  bank_transfer: "Bank Transfer", pos: "POS", cheque: "Cheque", online: "Online", petty_cash: "Petty Cash",
};
const GIFT_METHODS = ["bank_transfer", "pos", "cash", "cheque", "card", "other"] as const;

const FUND_TYPES = ["tithe", "general", "designated", "restricted", "building", "missions"];
const FUND_TYPE_LABELS: Record<string, string> = {
  tithe: "Tithe", general: "General", designated: "Designated",
  restricted: "Restricted", building: "Building", missions: "Missions",
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** Parse a naira string into integer kobo; NaN when invalid. */
function amountToCents(v: string): number {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

function todayISODate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function donorName(d: DonationDTO): string {
  if (d.isAnonymous) return "Anonymous";
  return d.person?.name ?? d.householdName ?? "No donor on file";
}

/* ───────────────────────────── module ───────────────────────────── */

export default function GivingModule({ user }: ModuleProps) {
  const perms = useGivingPermissions(user);

  // Member self-service: members (own-data grants only) get the warm portal,
  // NEVER the staff ledger. The server scopes every query to personId=self;
  // this routing is purely presentational.
  if (perms.isMemberOnly) {
    // Head Usher variant: the usher desk (post service collections to finance,
    // track approval) lives alongside — NOT inside — their personal portal.
    if (perms.canVerifyUsher) {
      return (
        <Tabs defaultValue="my-giving">
          <TabsList>
            <TabsTrigger value="my-giving" className="gap-1.5">
              <Wallet className="h-4 w-4" /> My Giving
            </TabsTrigger>
            <TabsTrigger value="collections" className="gap-1.5">
              <HandCoins className="h-4 w-4" /> Service Collections
            </TabsTrigger>
          </TabsList>
          <TabsContent value="my-giving" className="mt-4">
            <MyGivingPortal user={user} />
          </TabsContent>
          <TabsContent value="collections" className="mt-4">
            <UsherCollections user={user} />
          </TabsContent>
        </Tabs>
      );
    }
    return <MyGivingPortal user={user} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Giving"
        description="An append-only gift ledger: splits must balance, batches post under two-person control, and corrections are reversal entries — never edits."
      />
      <Tabs defaultValue="gifts">
        <TabsList>
          <TabsTrigger value="gifts" className="gap-1.5">
            <Receipt className="h-4 w-4" /> Gifts
          </TabsTrigger>
          <TabsTrigger value="collections" className="gap-1.5">
            <HandCoins className="h-4 w-4" /> Collections
          </TabsTrigger>
          <TabsTrigger value="funds" className="gap-1.5">
            <Target className="h-4 w-4" /> Funds
          </TabsTrigger>
          <TabsTrigger value="statements" className="gap-1.5">
            <FileText className="h-4 w-4" /> Statements
          </TabsTrigger>
        </TabsList>
        <TabsContent value="gifts" className="mt-4">
          <GiftsTab perms={perms} />
        </TabsContent>
        <TabsContent value="collections" className="mt-4">
          {/* Batches verification + usher count sheets, stacked under one tab. */}
          <div className="space-y-8">
            <Section title="Service batches">
              <BatchesTab perms={perms} />
            </Section>
            <Section title="Usher count sheets">
              <UsherCollections user={user} />
            </Section>
          </div>
        </TabsContent>
        <TabsContent value="funds" className="mt-4">
          <FundsPledgesTab perms={perms} />
        </TabsContent>
        <TabsContent value="statements" className="mt-4">
          <StatementsTab perms={perms} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ═════════════════════════════ GIFTS ═════════════════════════════ */

function GiftsTab({ perms }: { perms: GivingPermissions }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [recordOpen, setRecordOpen] = useState(false);
  const pageSize = 25;

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const donationsQ = useApiQuery<{ total: number; items: DonationDTO[] }>(
    ["donations", page, search, method, status],
    `/donations${qs({
      search: search || undefined,
      method: method === "all" ? undefined : method,
      status: status === "all" ? undefined : status,
      page,
      pageSize,
    })}`
  );
  const donations = donationsQ.data?.items ?? [];
  const total = donationsQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Accountant confirmation queue: pending gifts on this page + bulk post-to-GL.
  const qc = useQueryClient();
  const [bulkBusy, setBulkBusy] = useState(false);
  const pendingOnPage = perms.canVerifyAccountant ? donations.filter((d) => d.status === "pending").length : 0;

  async function approveBulk(donationIds: string[]) {
    if (!donationIds.length) return;
    setBulkBusy(true);
    try {
      const res = await api.post<{ results: { id: string; ok: boolean; error?: string }[] }>("/donations/approve-gl-bulk", { donationIds });
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - ok;
      if (failed > 0) toast.warning(`${ok} gift${ok === 1 ? "" : "s"} posted; ${failed} could not be approved.`);
      else toast.success(`${ok} gift${ok === 1 ? "" : "s"} approved & posted to the GL.`);
      void qc.invalidateQueries({ queryKey: ["donations"] });
      void qc.invalidateQueries({ queryKey: ["batches"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not approve the gifts."));
    } finally {
      setBulkBusy(false);
    }
  }

  // Tithe vs Offering YTD — the split finance staff want at a glance.
  // Derived from the funds list (already aggregates YTD per fund).
  const fundsQ = useApiQuery<{ items: FundDTO[] }>(["funds"], "/funds");
  const titheYTD = (fundsQ.data?.items ?? []).filter((f) => f.type === "tithe").reduce((a, f) => a + (f.receivedCentsYTD ?? 0), 0);
  const offeringsYTD = (fundsQ.data?.items ?? []).filter((f) => f.type !== "tithe").reduce((a, f) => a + (f.receivedCentsYTD ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tithe YTD" value={fmtMoney(titheYTD)} icon={Landmark} tone="positive" sub="funds typed 'tithe'" />
        <StatCard label="Offerings YTD" value={fmtMoney(offeringsYTD)} icon={Wallet} sub="all other funds" />
        <StatCard label="Gifts on file" value={total} icon={Receipt} />
        <StatCard
          label="Tithe share"
          value={titheYTD + offeringsYTD > 0 ? `${Math.round((titheYTD / (titheYTD + offeringsYTD)) * 100)}%` : "—"}
          icon={Target}
        />
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Donor, email or payment ref"
            className="pl-9"
            aria-label="Search gifts"
          />
        </div>
        <Select
          value={method}
          onValueChange={(v) => {
            setMethod(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="lg:w-36" aria-label="Method filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {Object.entries(METHOD_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="lg:w-36" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["posted", "pending", "reversed", "failed"].map((s) => (
              <SelectItem key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 lg:ml-auto">
          {perms.canVerifyAccountant && pendingOnPage > 0 ? (
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={bulkBusy}
              onClick={() => void approveBulk(donations.filter((d) => d.status === "pending").map((d) => d.id))}
              aria-label={`Approve and post ${pendingOnPage} pending gifts to the general ledger`}
            >
              <CheckCircle2 className="h-4 w-4" />
              {bulkBusy ? "Posting…" : `Approve & post (${pendingOnPage})`}
            </Button>
          ) : null}
          {perms.canRecord ? (
            <Button onClick={() => setRecordOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Record gift
            </Button>
          ) : null}
        </div>
      </div>

      {donationsQ.isLoading ? (
        <LoadingBlock label="Loading gifts…" />
      ) : donationsQ.isError ? (
        <ErrorBlock error={donationsQ.error} />
      ) : donations.length === 0 ? (
        <EmptyState icon={Receipt} title="No gifts match" description="Adjust the filters or record the first gift." />
      ) : (
        <>
          {/* desktop */}
          <div className="hidden overflow-x-auto rounded-lg border lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Donor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Funds</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {donations.map((d) => (
                  <GiftRow key={d.id} d={d} canReverse={perms.canReverse} canVerify={perms.canVerifyAccountant} />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* mobile / tablet */}
          <div className="space-y-3 lg:hidden">
            {donations.map((d) => (
              <div key={d.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{donorName(d)}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(d.receivedOn)}</p>
                  </div>
                  <p className="text-lg font-bold tabular-nums">{fmtMoney(d.amountCents)}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{METHOD_LABELS[d.method] ?? d.method}</Badge>
                  <StatusBadge status={d.status} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {(d.splits ?? []).map((s) => s.fundName).join(", ") || "No splits"}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {d.batch?.name ?? "No batch"}
                    {d.batch?.countedByOne ? <span className="block">Counted by {d.batch.countedByOne}</span> : null}
                  </span>
                  <div className="flex items-center gap-1">
                    {perms.canVerifyAccountant && d.status === "pending" ? <ApproveGiftButton d={d} /> : null}
                    <ReverseButton d={d} canReverse={perms.canReverse} />
                  </div>
                </div>
                {perms.canVerifyAccountant && d.status === "pending" ? (
                  <div className="mt-1.5 flex justify-end">
                    <ReturnGiftButton d={d} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {total} gift{total === 1 ? "" : "s"} · page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <RecordGiftDialog open={recordOpen} onOpenChange={setRecordOpen} />
    </div>
  );
}

function GiftRow({ d, canReverse, canVerify }: { d: DonationDTO; canReverse: boolean; canVerify?: boolean }) {
  const showVerify = !!canVerify && d.status === "pending";
  return (
    <TableRow className="row-hover">
      <TableCell className="whitespace-nowrap">{fmtDate(d.receivedOn)}</TableCell>
      <TableCell>
        <p className="font-medium">{donorName(d)}</p>
        {d.checkNumber ? <p className="text-xs text-muted-foreground">Payment ref: {d.checkNumber}</p> : null}
        {d.rejectionNote ? <p className="text-xs text-destructive" title={d.rejectionNote}>Query: {d.rejectionNote}</p> : null}
      </TableCell>
      <TableCell className="text-right font-bold tabular-nums">{fmtMoney(d.amountCents)}</TableCell>
      <TableCell className="whitespace-nowrap">{METHOD_LABELS[d.method] ?? d.method}</TableCell>
      <TableCell className="max-w-56">
        <span className="block truncate text-sm" title={(d.splits ?? []).map((s) => `${s.fundName} ${fmtMoney(s.amountCents)}`).join(", ")}>
          {(d.splits ?? []).map((s) => s.fundName).join(", ") || "—"}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {d.batch?.name ?? "—"}
        {d.batch?.countedByOne ? <span className="block text-xs">Counted by {d.batch.countedByOne}</span> : null}
      </TableCell>
      <TableCell>
        <StatusBadge status={d.status} />
        {d.verificationStatus === "rejected" ? (
          <span className="ml-1.5 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">returned</span>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {showVerify ? <ApproveGiftButton d={d} /> : null}
          {showVerify ? <ReturnGiftButton d={d} /> : null}
          <ReverseButton d={d} canReverse={canReverse} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function ReverseButton({ d, canReverse: allowed }: { d: DonationDTO; canReverse: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const canReverse = allowed && (d.status === "posted" || d.status === "pending");

  if (!canReverse) return null;

  async function reverse() {
    if (!reason.trim()) {
      toast.error("A reason is required to reverse a gift.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/donations/${d.id}/reverse`, { reason: reason.trim() });
      toast.success("Reversal recorded as a new entry — the original stays immutable.");
      setOpen(false);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["donations"] });
      void qc.invalidateQueries({ queryKey: ["batches"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not reverse this gift."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-destructive"
        onClick={() => setOpen(true)}
        aria-label={`Reverse gift of ${fmtMoney(d.amountCents)} from ${donorName(d)}`}
      >
        <Undo2 className="h-4 w-4" /> Reverse
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reverse this gift?</AlertDialogTitle>
          <AlertDialogDescription>
            Gifts are immutable: reversing creates a <strong>new</strong> reversal entry of{" "}
            {fmtMoney(d.amountCents)} linked to the original. The row stays visible with status “reversed”.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`reverse-reason-${d.id}`}>Reason (required)</Label>
          <Textarea
            id={`reverse-reason-${d.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Deposit duplicated — transposed amount"
            rows={2}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep gift</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void reverse();
            }}
            disabled={busy || !reason.trim()}
          >
            Record reversal
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Accountant confirm: posts the pending gift to the GL (Dr Cash / Cr Revenue). */
function ApproveGiftButton({ d }: { d: DonationDTO }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api.post(`/donations/${d.id}/approve-gl`, {});
      toast.success(`${donorName(d)} — ${fmtMoney(d.amountCents)} approved & posted to the GL.`);
      void qc.invalidateQueries({ queryKey: ["donations"] });
      void qc.invalidateQueries({ queryKey: ["batches"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not approve this gift."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1 text-teal-700"
      disabled={busy}
      onClick={() => void approve()}
      aria-label={`Approve gift of ${fmtMoney(d.amountCents)} from ${donorName(d)} and post to the general ledger`}
      title="Confirm this gift and post it to the General Ledger"
    >
      <CheckCircle2 className="h-4 w-4" /> {busy ? "Posting…" : "Approve"}
    </Button>
  );
}

/** Accountant returns a pending gift to the usher/clerk queue with a mandatory note. */
function ReturnGiftButton({ d }: { d: DonationDTO }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function reject() {
    if (!note.trim()) {
      toast.error("A query note is required.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/donations/${d.id}/reject`, { note: note.trim() });
      toast.success("Gift returned with your query — it stays in the pending queue.");
      setOpen(false);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["donations"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not return this gift."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-amber-600"
        onClick={() => setOpen(true)}
        aria-label={`Return gift of ${fmtMoney(d.amountCents)} from ${donorName(d)} with a query`}
        title="Return to usher/clerk queue with a query note"
      >
        <MessageSquareWarning className="h-4 w-4" /> Query
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Return this gift with a query?</AlertDialogTitle>
          <AlertDialogDescription>
            {donorName(d)} — {fmtMoney(d.amountCents)} stays <strong>pending</strong> and is flagged back to the usher/clerk queue. The note is mandatory (e.g. transfer not found on the bank statement).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`gift-query-${d.id}`}>Query note (required)</Label>
          <Textarea
            id={`gift-query-${d.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Bank transfer not found on the GTBank statement for this date"
            rows={2}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void reject();
            }}
            disabled={busy || !note.trim()}
          >
            Return with query
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── record gift ── */

interface SplitRow {
  fundId: string;
  amount: string; // naira, as typed
}

function RecordGiftDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const fundsQ = useApiQuery<{ items: FundDTO[] }>(["funds"], "/funds");
  const funds = fundsQ.data?.items ?? [];

  const [person, setPerson] = useState<PersonListItem | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [receivedOn, setReceivedOn] = useState(todayISODate());
  const [splits, setSplits] = useState<SplitRow[]>([{ fundId: "", amount: "" }]);
  const [checkNumber, setCheckNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);

  const totalCents = amountToCents(amount);
  const splitSum = splits.reduce((a, s) => {
    const c = amountToCents(s.amount);
    return a + (Number.isFinite(c) ? c : 0);
  }, 0);
  const splitsValid = splits.every((s) => s.fundId && Number.isFinite(amountToCents(s.amount)) && amountToCents(s.amount) > 0);
  const amountsMatch = Number.isFinite(totalCents) && totalCents > 0 && splitsValid && splitSum === totalCents;

  function setSplit(i: number, patch: Partial<SplitRow>) {
    setSplits((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function submit() {
    setBusy(true);
    try {
      await api.post("/donations", {
        personId: person?.id || undefined,
        amountCents: totalCents,
        method,
        receivedOn,
        splits: splits.map((s) => ({ fundId: s.fundId, amountCents: amountToCents(s.amount) })),
        checkNumber: (method === "cheque" || method === "bank_transfer" || method === "pos") && checkNumber.trim() ? checkNumber.trim() : undefined,
        memo: memo.trim() || undefined,
        isAnonymous,
      });
      toast.success("Gift recorded — it stays pending until finance approves & posts it to the ledger.");
      onOpenChange(false);
      setPerson(null);
      setAmount("");
      setSplits([{ fundId: "", amount: "" }]);
      setCheckNumber("");
      setMemo("");
      setIsAnonymous(false);
      void qc.invalidateQueries({ queryKey: ["donations"] });
      void qc.invalidateQueries({ queryKey: ["funds"] });
      void qc.invalidateQueries({ queryKey: ["batches"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not record the gift."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Record gift</DialogTitle>
          <DialogDescription>
            Fund splits must sum exactly to the total. New gifts land as pending — finance approves &amp; posts them to the ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <PersonPicker value={person} onChange={setPerson} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gift-amount">Amount (₦)</Label>
              <Input
                id="gift-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="120.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gift-method">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="gift-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GIFT_METHODS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {METHOD_LABELS[v] ?? v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(method === "cheque" || method === "bank_transfer" || method === "pos") ? (
            <div className="space-y-1.5">
              <Label htmlFor="gift-check">Payment ref / teller #</Label>
              <Input id="gift-check" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} placeholder="NIBSS session / cheque #" />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="gift-date">Received on</Label>
            <Input id="gift-date" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </div>

          {/* split editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Fund splits</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setSplits((prev) => [...prev, { fundId: "", amount: "" }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add split
              </Button>
            </div>
            {splits.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={s.fundId || undefined} onValueChange={(v) => setSplit(i, { fundId: v })}>
                  <SelectTrigger className="flex-1" aria-label={`Fund for split ${i + 1}`}>
                    <SelectValue placeholder="Choose fund" />
                  </SelectTrigger>
                  <SelectContent>
                    {funds.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  className="w-32"
                  value={s.amount}
                  onChange={(e) => setSplit(i, { amount: e.target.value })}
                  placeholder="0.00"
                  aria-label={`Naira amount for split ${i + 1}`}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  aria-label={`Remove split ${i + 1}`}
                  disabled={splits.length === 1}
                  onClick={() => setSplits((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${amountsMatch ? "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"}`}>
              <span>
                Splits total {fmtMoney(splitSum)} of {Number.isFinite(totalCents) ? fmtMoney(totalCents) : "—"}
              </span>
              <span className="font-medium">
                {amountsMatch ? "Balanced" : Number.isFinite(totalCents) && totalCents > 0 ? `Off by ${fmtMoney(Math.abs(totalCents - splitSum))}` : "Enter a total"}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gift-memo">Memo (optional)</Label>
            <Input id="gift-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Building fund pledge" />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="gift-anon">Anonymous gift</Label>
              <p className="text-xs text-muted-foreground">Donor name is hidden on statements and exports.</p>
            </div>
            <Switch id="gift-anon" checked={isAnonymous} onCheckedChange={setIsAnonymous} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!amountsMatch || busy || !receivedOn}>
            Record gift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── shared person picker (search + select) ── */

function PersonPicker({ value, onChange }: { value: PersonListItem | null; onChange: (p: PersonListItem | null) => void }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const peopleQ = useApiQuery<{ items: PersonListItem[] }>(
    ["people-search", search, "picker"],
    `/people${qs({ search, pageSize: 8 })}`,
    { enabled: !value && search.trim().length >= 2 }
  );

  return (
    <div className="space-y-1.5">
      <Label>Donor</Label>
      {value ? (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <div>
            <p className="text-sm font-medium">
              {value.firstName} {value.lastName}
            </p>
            <p className="text-xs text-muted-foreground">{value.email || value.phone || value.household?.name || ""}</p>
          </div>
          <Button size="icon" variant="ghost" aria-label="Clear donor" onClick={() => onChange(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search people by name…"
            autoComplete="off"
            aria-label="Search donors"
          />
          {search.trim().length >= 2 ? (
            <div className="max-h-40 overflow-y-auto scroll-slim rounded-md border">
              {peopleQ.isLoading ? (
                <LoadingBlock label="Searching…" />
              ) : (peopleQ.data?.items ?? []).length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No matching people.</p>
              ) : (
                (peopleQ.data?.items ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => onChange(p)}
                  >
                    <span>
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="text-xs text-muted-foreground">{p.household?.name ?? p.email ?? ""}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Leave empty for cash / anonymous gifts.</p>
          )}
        </>
      )}
    </div>
  );
}

/* ═════════════════════════════ BATCHES ═════════════════════════════ */

function BatchesTab({ perms }: { perms: GivingPermissions }) {
  const batchesQ = useApiQuery<{ items: BatchDTO[] }>(["batches"], "/batches");
  const [newOpen, setNewOpen] = useState(false);
  const batches = batchesQ.data?.items ?? [];
  const openBatches = batches.filter((b) => b.status === "open");
  const pendingTotal = openBatches.reduce((a, b) => a + b.totalCents, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open batches" value={openBatches.length} icon={Layers} tone={openBatches.length ? "warning" : "default"} />
        <StatCard label="Pending total" value={fmtMoney(pendingTotal)} sub="awaiting usher & finance approval" icon={Wallet} tone="warning" />
        <StatCard label="All batches" value={batches.length} sub="most recent 60" />
        <StatCard
          label="Posted value (recent)"
          value={fmtMoney(batches.filter((b) => b.status === "posted").reduce((a, b) => a + b.totalCents, 0))}
          tone="positive"
        />
      </div>

      <Section
        title="Batches"
        description="A batch is a counting session. Gifts land as pending; an usher co-signs the count, then finance approves to post the batch to the GL."
        actions={
          perms.canManageBatches ? (
            <Button onClick={() => setNewOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> New batch
            </Button>
          ) : undefined
        }
      >
        {batchesQ.isLoading ? (
          <LoadingBlock label="Loading batches…" />
        ) : batchesQ.isError ? (
          <ErrorBlock error={batchesQ.error} />
        ) : batches.length === 0 ? (
          <EmptyState icon={Layers} title="No batches yet" description="Create one per counting session (usually per service)." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Service date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead>Counted by</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id} className="row-hover">
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(b.serviceDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={b.status} />
                      {b.verificationStatus ? (
                        <span className={`ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          b.verificationStatus === "accountant_verified" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                          : b.verificationStatus === "usher_verified" ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                          : b.verificationStatus === "rejected" ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200"
                          : "bg-muted text-muted-foreground"
                        }`}>
                          {b.verificationStatus === "accountant_verified" ? "posted to GL" : b.verificationStatus === "usher_verified" ? "usher ✓" : b.verificationStatus === "rejected" ? "returned" : b.verificationStatus}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(b.totalCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.pendingCount ?? 0}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[b.countedByOne, b.countedByTwo].filter(Boolean).join(" + ") || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.status === "open" && b.verificationStatus !== "usher_verified" && (perms.canVerifyUsher || perms.canManageBatches) ? (
                        <UsherSignOffButton batch={b} />
                      ) : null}
                      {b.status === "open" && b.verificationStatus !== "usher_verified" && !perms.canVerifyUsher && !perms.canManageBatches ? (
                        <span className="text-xs text-muted-foreground">Awaiting usher sign-off</span>
                      ) : null}
                      {b.verificationStatus === "usher_verified" && perms.canVerifyAccountant ? <ApproveBatchButton batch={b} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <NewBatchDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

/** Accountant approves an usher-verified batch and posts all its gifts to the GL. */
function ApproveBatchButton({ batch }: { batch: BatchDTO }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api.post(`/batches/${batch.id}/approve-gl`, {});
      toast.success(`Batch “${batch.name}” approved — ${fmtMoney(batch.totalCents)} posted to the GL.`);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["batches"] });
      void qc.invalidateQueries({ queryKey: ["donations"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not approve the batch."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)} aria-label={`Approve batch ${batch.name} and post to the general ledger`}>
        <CheckCircle2 className="h-4 w-4" /> Approve &amp; post
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve “{batch.name}” and post to GL?</AlertDialogTitle>
          <AlertDialogDescription>
            {fmtMoney(batch.totalCents)} counted by {batch.countedByOne || "—"} + {batch.countedByTwo || "—"}. All gifts in this batch become <strong>posted</strong> and a balanced journal entry (Dr Cash / Cr Revenue per fund) is written. Any statutory remittance rules accrue automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void approve();
            }}
            disabled={busy}
          >
            {busy ? "Posting…" : "Approve & post to GL"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Usher / head-usher co-sign on an open batch (two-person control). Posting
 *  itself happens only when finance approves the usher-verified batch. */
function UsherSignOffButton({ batch }: { batch: BatchDTO }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [countedByOne, setCountedByOne] = useState("");
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      await api.post(`/batches/${batch.id}/usher-verify`, { countedByOne: countedByOne.trim() || undefined });
      toast.success(`Batch “${batch.name}” signed off — now awaiting finance approval to post to the GL.`);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["batches"] });
      void qc.invalidateQueries({ queryKey: ["donations"] });
      void qc.invalidateQueries({ queryKey: ["giving-verification-queue"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not sign off the batch."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`Sign off batch ${batch.name}`}>
        Usher sign-off
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign off “{batch.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Two-person control: confirm the counted cash/transfer totals match the recorded gifts. This sends the batch
            to finance for approval — <strong>nothing posts to the ledger yet</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`counter-one-${batch.id}`}>Counted by (first counter)</Label>
          <Input
            id={`counter-one-${batch.id}`}
            value={countedByOne}
            onChange={(e) => setCountedByOne(e.target.value)}
            placeholder={batch.countedByOne || "Your full name"}
            autoFocus
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void verify();
            }}
            disabled={busy}
          >
            {busy ? "Signing…" : "Sign off & send to finance"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function NewBatchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [serviceDate, setServiceDate] = useState(todayISODate());
  const [depositAccount, setDepositAccount] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post("/batches", { name: name.trim(), serviceDate, depositAccount: depositAccount.trim() || undefined });
      toast.success("Batch created.");
      onOpenChange(false);
      setName("");
      void qc.invalidateQueries({ queryKey: ["batches"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not create the batch."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New batch</DialogTitle>
          <DialogDescription>Gifts recorded while a batch is open land as pending in it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="batch-name">Name</Label>
            <Input id="batch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Offering — ${fmtDate(new Date())}`} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="batch-date">Service date</Label>
            <Input id="batch-date" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="batch-deposit">Deposit account (optional)</Label>
            <Input id="batch-deposit" value={depositAccount} onChange={(e) => setDepositAccount(e.target.value)} placeholder="Operating — 4100" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || !serviceDate || busy}>
            Create batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═════════════════════════════ FUNDS ═════════════════════════════ */

function FundsPledgesTab({ perms }: { perms: GivingPermissions }) {
  const fundsQ = useApiQuery<{ items: FundDTO[] }>(["funds"], "/funds");
  const [fundOpen, setFundOpen] = useState(false);

  const funds = fundsQ.data?.items ?? [];

  return (
    <div className="space-y-8">
      <Section
        title="Funds"
        description="Designated buckets gifts can be split into."
        actions={
          perms.canManageFunds ? (
            <Button onClick={() => setFundOpen(true)} className="gap-1.5" variant="outline">
              <Plus className="h-4 w-4" /> New fund
            </Button>
          ) : undefined
        }
      >
        {fundsQ.isLoading ? (
          <LoadingBlock label="Loading funds…" />
        ) : fundsQ.isError ? (
          <ErrorBlock error={fundsQ.error} />
        ) : funds.length === 0 ? (
          <EmptyState icon={Target} title="No funds yet" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {funds.map((f) => {
              const pct = f.goalCents && f.goalCents > 0 ? Math.min(100, Math.round(((f.receivedCentsYTD ?? 0) / f.goalCents) * 100)) : null;
              return (
                <Card key={f.id}>
                  <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                    <CardTitle className="text-base">{f.name}</CardTitle>
                    <Badge variant="outline" className="capitalize">
                      {f.type}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="font-mono text-xs text-muted-foreground">{f.code}</p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">YTD received </span>
                      <span className="font-semibold tabular-nums">{fmtMoney(f.receivedCentsYTD ?? 0)}</span>
                    </p>
                    {f.goalCents ? (
                      <div className="space-y-1">
                        <Progress value={pct ?? 0} aria-label={`${pct}% of goal`} />
                        <p className="text-xs text-muted-foreground">
                          {pct}% of {fmtMoney(f.goalCents)} goal
                        </p>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {f.isTaxDeductible ? <span>Tax-deductible</span> : <span>Not tax-deductible</span>}
                      {!f.isActive ? <Badge variant="outline">Inactive</Badge> : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <NewFundDialog open={fundOpen} onOpenChange={setFundOpen} />
    </div>
  );
}

function NewFundDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("general");
  const [taxDeductible, setTaxDeductible] = useState(true);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const goalCents = goal ? amountToCents(goal) : undefined;
      await api.post("/funds", {
        name: name.trim(),
        code: code.trim(),
        type,
        isTaxDeductible: taxDeductible,
        goalCents: goalCents && Number.isFinite(goalCents) && goalCents > 0 ? goalCents : undefined,
      });
      toast.success("Fund created.");
      onOpenChange(false);
      setName("");
      setCode("");
      setGoal("");
      void qc.invalidateQueries({ queryKey: ["funds"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not create the fund."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New fund</DialogTitle>
          <DialogDescription>Funds appear in the gift split editor and giving reports.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fund-name">Name</Label>
              <Input id="fund-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Missions" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fund-code">Code</Label>
              <Input id="fund-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="500-MIS" className="font-mono" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fund-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="fund-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUND_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {FUND_TYPE_LABELS[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fund-goal">Annual goal (optional)</Label>
              <Input id="fund-goal" type="number" min={0} step="0.01" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="50000" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="fund-tax">Tax-deductible</Label>
            <Switch id="fund-tax" checked={taxDeductible} onCheckedChange={setTaxDeductible} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || !code.trim() || busy}>
            Create fund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═════════════════════════════ STATEMENTS ═════════════════════════════ */

function StatementsTab({ perms }: { perms: GivingPermissions }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const statementsQ = useApiQuery<{ items: StatementDTO[] }>(["statements", year], `/statements${qs({ taxYear: year })}`);
  const statements = statementsQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="space-y-1.5">
          <Label className="sr-only" htmlFor="stmt-year">
            Tax year
          </Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger id="stmt-year" className="sm:w-44" aria-label="Tax year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  Tax year {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:ml-auto">
          {perms.canManageStatements ? <GenerateStatementsButton year={year} existing={statements.length} /> : null}
        </div>
      </div>

      {statementsQ.isLoading ? (
        <LoadingBlock label="Loading statements…" />
      ) : statementsQ.isError ? (
        <ErrorBlock error={statementsQ.error} />
      ) : statements.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={`No statements for ${year}`}
          description="Generate statements to produce per-household letters with the FIRS-required acknowledgement language."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Statement unit</TableHead>
                <TableHead className="text-right">Tax year</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.map((s) => (
                <TableRow key={s.id} className="row-hover">
                  <TableCell>
                    <p className="font-medium">{s.householdName ?? s.personName}</p>
                    {s.householdName ? <p className="text-xs text-muted-foreground">{s.personName}</p> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.taxYear}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(s.totalCents)}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(s.generatedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{s.sentAt ? fmtDate(s.sentAt) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setPreviewId(s.id)} aria-label={`Preview statement for ${s.householdName ?? s.personName}`}>
                      Preview
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <StatementPreviewDialog id={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}

function GenerateStatementsButton({ year, existing }: { year: number; existing: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const resp = await api.post<{ created: number }>("/statements/generate", { taxYear: year });
      toast.success(`Created ${resp.created} statement${resp.created === 1 ? "" : "s"} for ${year}.`);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["statements"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not generate statements."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button className="gap-1.5" disabled={busy} onClick={() => setOpen(true)}>
        <Landmark className="h-4 w-4" /> Generate statements
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Generate {year} statements?</AlertDialogTitle>
          <AlertDialogDescription>
            {existing > 0
              ? `${existing} statement${existing === 1 ? " already exists" : "s already exist"} for ${year}; generation upserts per household with the year's posted, non-reversed gifts.`
              : "One statement per household with posted, non-reversed gifts, including the FIRS-required “no goods or services” acknowledgement."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void generate();
            }}
            disabled={busy}
          >
            Generate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StatementPreviewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const prevQ = useApiQuery<{ html: string }>(["statement-preview", id], `/statements/${id}/preview`, {
    enabled: !!id,
  });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Giving statement preview</DialogTitle>
          <DialogDescription>Prints on letterhead with the FIRS-required statutory acknowledgement language.</DialogDescription>
        </DialogHeader>
        {prevQ.isLoading ? (
          <LoadingBlock label="Rendering statement…" />
        ) : prevQ.isError ? (
          <ErrorBlock error={prevQ.error} />
        ) : (
          <iframe
            ref={iframeRef}
            title="Giving statement"
            srcDoc={prevQ.data?.html ?? ""}
            className="h-[65vh] w-full rounded-md border bg-white"
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            className="gap-1.5"
            disabled={!prevQ.data?.html}
            onClick={() => iframeRef.current?.contentWindow?.print()}
            aria-label="Print statement"
          >
            <Printer className="h-4 w-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
