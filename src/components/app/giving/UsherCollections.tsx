"use client";

/**
 * Service Collections — the Head Usher desk inside the Giving module.
 *
 * Church flow this implements: members bring offerings & tithes to church,
 * ushers count them, record WHAT was collected (Tithe / Offering /
 * Thanksgiving… via funds) and HOW (cash / cheque / bank transfer / POS as
 * split lines with references), then sign & submit to finance. Finance (or
 * the church accountant) approves → the batch posts to the General Ledger.
 * Returned sheets can be edited and resubmitted until they balance.
 *
 * ACCESS: only users holding "giving.verify.usher" (Head Usher role) may
 * record/sign; finance viewers with giving.verify.accountant or
 * accounting.manage see the same list read-only. The SERVER enforces all of
 * this — these checks only shape the UI.
 */
import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HandCoins,
  Plus,
  Send,
  SquarePen,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { canDo, fmtDate, fmtDateTime, fmtMoney, type SessionUser } from "@/lib/types";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Section,
  StatCard,
  useApiQuery,
} from "@/components/app/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/* ───────────────────────────── constants ───────────────────────────── */

const SERVICE_NAMES = [
  "1st Service",
  "2nd Service",
  "3rd Service",
  "Midweek Service",
  "Bible Study",
  "Prayer Meeting",
  "Vigil",
  "Revival",
  "Special",
];

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  pos: "POS",
  other: "Other",
  // legacy donation methods that can surface in posted lines
  card: "Card",
  check: "Cheque",
  ach: "ACH",
};

const METHOD_TONES: Record<string, string> = {
  cash: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  cheque: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  bank_transfer: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  pos: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  other: "bg-muted text-muted-foreground",
};

const SHEET_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft — not submitted", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  usher_verified: { label: "With finance — awaiting approval", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  accountant_verified: { label: "Posted to GL ✓", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  rejected: { label: "Returned — needs fixing", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
};

const COLLECTION_METHODS = ["cash", "cheque", "bank_transfer", "pos", "other"] as const;

/** Nigerian cash notes/coins counted on the offering table — same set as the
 *  Accounting count-sheet form. Units are kobo per bundle item. */
const DENOMS = [
  { key: "n1000", label: "₦1,000", unit: 100000 },
  { key: "n500", label: "₦500", unit: 50000 },
  { key: "n200", label: "₦200", unit: 20000 },
  { key: "n100", label: "₦100", unit: 10000 },
  { key: "n50", label: "₦50", unit: 5000 },
  { key: "coins", label: "Coins", unit: 100 },
] as const;

/** Kobo total of a notes × count entry ("" / junk counts as 0). */
function denomCents(denoms: Record<string, string>): number {
  return DENOMS.reduce((a, d) => {
    const n = Math.max(0, Math.floor(Number(denoms[d.key] ?? "") || 0));
    return a + n * d.unit;
  }, 0);
}

/** Reverse map: stored kobo-per-denomination → counts (used when editing). */
function denomsFromCents(stored: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of DENOMS) {
    const kobo = Math.max(0, Math.floor(Number(stored[d.key]) || 0));
    const count = Math.round(kobo / d.unit);
    out[d.key] = count > 0 ? String(count) : "";
  }
  return out;
}

/* ───────────────────────────── types ───────────────────────────── */

interface UsherSheetLine {
  id: string;
  method: string;
  amountCents: number;
  reference: string | null;
  status: string;
  fundId: string | null;
  fundName: string | null;
}

interface UsherSheet {
  id: string;
  name: string;
  serviceDate: string;
  serviceName: string | null;
  status: string;
  verificationStatus: string | null;
  totalCents: number;
  countedByOne: string | null;
  countedByTwo: string | null;
  verifiedByUsherAt: string | null;
  verifiedByAccountantAt: string | null;
  postedAt: string | null;
  postedByName: string | null;
  rejectionNote: string | null;
  methods: { method: string; amountCents: number }[];
  denominations?: Record<string, number> | null;
  lines: UsherSheetLine[];
}

interface FundLite {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

interface LineDraft {
  fundId: string;
  method: string;
  naira: string; // typed naira amount, converted to kobo on submit
  counting: boolean; // true → amount computed from the denomination grid
  denoms: Record<string, string>; // ₦ notes × count entries
}

function blankLine(): LineDraft {
  return { fundId: "", method: "cash", naira: "", counting: true, denoms: {} };
}

function amountToCents(v: string): number {
  const n = Number.parseFloat(String(v).replace(/[₦,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

function todayISODate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message || fallback : fallback;
}

/* ───────────────────────────── component ───────────────────────────── */

export default function UsherCollections({ user }: { user: SessionUser }) {
  const qc = useQueryClient();
  const canUsher = canDo(user, "giving.verify.usher");
  const canManageFinance = canDo(user, "giving.verify.accountant") || canDo(user, "accounting.manage");

  const sheetsQ = useApiQuery<{ items: UsherSheet[] }>(["usher-count-sheets"], "/count-sheets");
  const fundsQ = useApiQuery<{ items: FundLite[] }>(["funds"], "/funds");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UsherSheet | null>(null);
  const [signing, setSigning] = useState<UsherSheet | null>(null);
  const [signNote, setSignNote] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const funds = (fundsQ.data?.items ?? []).filter((f) => f.isActive);

  const sheets = sheetsQ.data?.items ?? [];
  const stats = useMemo(() => {
    const withFinance = sheets.filter((s) => s.verificationStatus === "usher_verified");
    const returned = sheets.filter((s) => s.verificationStatus === "rejected");
    const posted = sheets.filter((s) => s.verificationStatus === "accountant_verified");
    const drafts = sheets.filter((s) => s.verificationStatus === "draft");
    return {
      drafts: drafts.length,
      withFinance: withFinance.length,
      withFinanceTotal: withFinance.reduce((a, s) => a + s.totalCents, 0),
      returned: returned.length,
      postedCount: posted.length,
      postedTotal: posted.reduce((a, s) => a + s.totalCents, 0),
    };
  }, [sheets]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["usher-count-sheets"] });
    qc.invalidateQueries({ queryKey: ["giving-verification-queue"] });
    qc.invalidateQueries({ queryKey: ["batches"] });
  };

  /** Sign & submit: usher-verify puts the sheet in finance's approval queue. */
  async function signAndSubmit(sheet: UsherSheet) {
    setBusy(true);
    try {
      await api.post(`/batches/${sheet.id}/usher-verify`, { countedByOne: sheet.countedByOne || user.name });
      toast.success("Signed & submitted to finance for approval.");
      setSigning(null);
      refresh();
    } catch (e) {
      toast.error(errMessage(e, "Failed to submit to finance."));
    } finally {
      setBusy(false);
    }
  }

  if (sheetsQ.isLoading || fundsQ.isLoading) return <LoadingBlock label="Loading service collections…" />;
  if (sheetsQ.error) return <ErrorBlock error={sheetsQ.error} />;
  if (!canUsher && !canManageFinance) {
    return (
      <EmptyState
        icon={HandCoins}
        title="Head Usher access required"
        description="Recording service collections requires the Head Usher role. Ask a church admin to add it to your account (Administration → Users)."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Service Collections</h2>
        <p className="text-sm text-muted-foreground">
          Post what was collected during a service — offering, tithe, thanksgiving — split by how it came in
          (cash, cheque, bank transfer, POS). Finance approves before it posts to the church accounts.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Drafts" value={String(stats.drafts)} sub="not yet submitted" tone={stats.drafts ? "warning" : "default"} />
        <StatCard label="With finance" value={String(stats.withFinance)} sub={`${fmtMoney(stats.withFinanceTotal)} awaiting approval`} tone="violet" />
        <StatCard label="Returned" value={String(stats.returned)} sub="fix & resubmit" tone={stats.returned ? "negative" : "default"} />
        <StatCard label="Posted to GL" value={String(stats.postedCount)} sub={`${fmtMoney(stats.postedTotal)} approved`} tone="positive" />
      </div>

      <Section
        title="Collection sheets"
        description="One sheet per service counting session. Sign & submit sends it to the finance approval queue."
        actions={
          canUsher ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> Post Service Collections
            </Button>
          ) : undefined
        }
      >
        {sheets.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="No collections posted yet"
            description="After the counts are done, post what came in during the service — cash, cheque and transfer lines all in one sheet — and send it to finance for approval."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Service</TableHead>
                  <TableHead>Split by method</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Counted by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((s) => {
                  const status = SHEET_STATUS[s.verificationStatus ?? "draft"] ?? SHEET_STATUS.draft;
                  const editable = canUsher && (s.verificationStatus === "draft" || s.verificationStatus === "rejected");
                  const isOpen = expanded === s.id;
                  return (
                    <Fragment key={s.id}>
                      <TableRow className="row-hover">
                        <TableCell>
                          <button
                            type="button"
                            aria-label={isOpen ? "Hide breakdown" : "Show breakdown"}
                            className="p-1 rounded hover:bg-muted"
                            onClick={() => setExpanded(isOpen ? null : s.id)}
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{s.serviceName ?? s.name}</div>
                          <div className="text-xs text-muted-foreground">{fmtDate(s.serviceDate)}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {s.methods.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              s.methods.map((m) => (
                                <Badge key={m.method} variant="outline" className={`text-[11px] ${METHOD_TONES[m.method] ?? METHOD_TONES.other}`}>
                                  {METHOD_LABELS[m.method] ?? m.method} · {fmtMoney(m.amountCents)}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(s.totalCents)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.countedByOne ?? "—"}
                          {s.countedByTwo && s.countedByTwo !== s.countedByOne ? <div>+ {s.countedByTwo}</div> : null}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>
                            {status.label}
                          </span>
                          {s.verificationStatus === "rejected" && s.rejectionNote ? (
                            <div className="mt-1 flex items-start gap-1 max-w-[15rem] text-xs text-rose-600 dark:text-rose-300">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                              <span>{s.rejectionNote}</span>
                            </div>
                          ) : null}
                          {s.verificationStatus === "accountant_verified" && s.postedAt ? (
                            <div className="mt-1 text-xs text-muted-foreground">Posted {fmtDateTime(s.postedAt)}{s.postedByName ? ` by ${s.postedByName}` : ""}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {canUsher && editable ? (
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" variant="outline" onClick={() => { setEditing(s); setFormOpen(true); }}>
                                <SquarePen className="h-3.5 w-3.5" /> Edit
                              </Button>
                              <Button size="sm" onClick={() => { setSigning(s); setSignNote(""); }}>
                                <Send className="h-3.5 w-3.5" /> Sign &amp; submit
                              </Button>
                            </div>
                          ) : s.verificationStatus === "usher_verified" ? (
                            <span className="text-xs text-muted-foreground">Awaiting finance approval</span>
                          ) : s.verificationStatus === "accountant_verified" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Approved by finance
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow key={`${s.id}-detail`} className="bg-muted/40 hover:bg-muted/40">
                          <TableCell />
                          <TableCell colSpan={6}>
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Collection lines</div>
                            {s.lines.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No line detail recorded.</p>
                            ) : (
                              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                {s.lines.map((l) => (
                                  <div key={l.id} className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm">
                                    <div className="min-w-0">
                                      <div className="truncate font-medium">{l.fundName ?? "Category"}</div>
                                      <div className="text-xs text-muted-foreground">
                                        {METHOD_LABELS[l.method] ?? l.method}
                                        {l.reference ? ` · ${l.reference}` : ""}
                                      </div>
                                    </div>
                                    <div className="font-mono text-sm tabular-nums shrink-0">{fmtMoney(l.amountCents)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* create / edit dialog */}
      <SheetFormDialog
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }}
        user={user}
        editing={editing}
        funds={funds}
        onSaved={(sheet, submit) => {
          refresh();
          if (submit && sheet) {
            setSigning(sheet);
            setSignNote("");
          }
        }}
        busy={busy}
        setBusy={setBusy}
      />

      {/* sign & submit confirmation */}
      <Dialog open={!!signing} onOpenChange={(o) => { if (!o) setSigning(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sign &amp; submit to finance</DialogTitle>
            <DialogDescription>
              {signing?.serviceName} — {signing ? fmtDate(signing.serviceDate) : ""} · {signing ? fmtMoney(signing.totalCents) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sign-counted">Counted by (you co-sign)</Label>
              <Input id="sign-counted" value={signing?.countedByOne || user.name} readOnly />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sign-note">Note (optional)</Label>
              <Textarea
                id="sign-note"
                rows={2}
                placeholder="e.g. Counted with deputy head usher after 2nd Service."
                value={signNote}
                onChange={(e) => setSignNote(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Finance will see this sheet in their approval queue and post it to the church accounts once approved.
              If something is off they can return it to you with a query note.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSigning(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => signing && signAndSubmit(signing)}>
              <Send className="h-4 w-4 mr-1" /> Submit to finance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────────────── form dialog ───────────────────────────── */

function SheetFormDialog({
  open,
  onOpenChange,
  user,
  editing,
  funds,
  onSaved,
  busy,
  setBusy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: SessionUser;
  editing: UsherSheet | null;
  funds: FundLite[];
  onSaved: (sheet: UsherSheet | null, submit: boolean) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [serviceDate, setServiceDate] = useState(todayISODate());
  const [serviceName, setServiceName] = useState(SERVICE_NAMES[0]);
  const [countedByOne, setCountedByOne] = useState(user.name);
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [formKey, setFormKey] = useState<string>("");

  // Re-seed the form whenever it opens (create → blank, edit → the sheet's lines)
  const seedKey = `${open ? "o" : "c"}-${editing?.id ?? "new"}`;
  if (open && formKey !== seedKey) {
    setFormKey(seedKey);
    setServiceDate(editing ? editing.serviceDate.slice(0, 10) : todayISODate());
    setServiceName(editing?.serviceName ?? SERVICE_NAMES[0]);
    setCountedByOne(editing?.countedByOne || user.name);
    // If the sheet carries a stored denomination breakdown that exactly matches
    // its single cash line, rehydrate the notes × count grid for that line.
    const stored = editing?.denominations ?? null;
    const storedTotal = stored ? Object.values(stored).reduce((a, v) => a + (Number(v) || 0), 0) : 0;
    const firstCashIdx = editing?.lines.findIndex((l) => l.method === "cash") ?? -1;
    setLines(
      editing?.lines.length
        ? editing.lines.map((l, i) => {
            const counting = !!stored && storedTotal > 0 && i === firstCashIdx && l.amountCents === storedTotal;
            return {
              fundId: l.fundId ?? "",
              method: l.method,
              naira: (l.amountCents / 100).toFixed(2),
              counting,
              denoms: counting ? denomsFromCents(stored) : {},
            };
          })
        : [blankLine()]
    );
  }

  const parsed = lines.map((l) => ({ ...l, cents: l.counting ? denomCents(l.denoms) : amountToCents(l.naira) }));
  const validLines = parsed.filter((l) => l.fundId && Number.isFinite(l.cents) && l.cents > 0);
  const totalCents = validLines.reduce((a, l) => a + l.cents, 0);
  const cashCountedCents = parsed.reduce((a, l) => a + (l.method === "cash" && l.counting ? l.cents : 0), 0);
  // aggregate every counted line into one denominations map (kobo per note) —
  // the same shape the Accounting count-sheet form stores on the batch.
  const denomAgg: Record<string, number> = {};
  for (const l of parsed) {
    if (!l.counting || !Number.isFinite(l.cents) || l.cents <= 0) continue;
    for (const d of DENOMS) {
      const n = Math.max(0, Math.floor(Number(l.denoms[d.key] ?? "") || 0));
      if (n > 0) denomAgg[d.key] = (denomAgg[d.key] ?? 0) + n * d.unit;
    }
  }
  const hasDenoms = Object.keys(denomAgg).length > 0;
  const methodTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of validLines) map.set(l.method, (map.get(l.method) ?? 0) + l.cents);
    return [...map.entries()];
  }, [lines]);
  const allValid = validLines.length > 0 && validLines.length === parsed.length;

  async function save(submitAfter: boolean) {
    if (!allValid) {
      toast.error("Every line needs a category, a payment method and an amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        serviceDate,
        serviceName,
        countedByOne: countedByOne.trim() || user.name,
        lines: validLines.map((l) => ({ fundId: l.fundId, method: l.method, amountCents: l.cents })),
        ...(hasDenoms ? { denominations: denomAgg } : {}),
      };
      let sheet: UsherSheet | null = null;
      if (editing) {
        sheet = await api.patch<UsherSheet>(`/count-sheets/${editing.id}`, payload);
        toast.success(submitAfter ? "Collection updated — submitting to finance…" : "Collection updated.");
      } else {
        sheet = await api.post<UsherSheet>("/count-sheets", payload);
        toast.success(submitAfter ? "Collection recorded — submitting to finance…" : "Draft saved — sign & submit when ready.");
      }
      if (submitAfter && sheet) {
        await api.post(`/batches/${sheet.id}/usher-verify`, { countedByOne: countedByOne.trim() || user.name });
        toast.success("Signed & submitted to finance for approval.");
      }
      onOpenChange(false);
      onSaved(sheet, false);
    } catch (e) {
      toast.error(errMessage(e, "Failed to save the collection sheet."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl w-[95vw]">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-xl">{editing ? "Edit service collections" : "Post service collections"}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Record every collection from the service as its own line — the category it belongs to and how it was
            paid. Cash, cheque, bank transfer and POS can be mixed freely in one sheet.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[80vh] space-y-6 overflow-y-auto scroll-slim pr-1">
          {/* ── service details ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold tracking-tight">Service details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="uc-date" className="text-sm font-medium">Service date</Label>
                <Input id="uc-date" type="date" className="h-11" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="uc-service" className="text-sm font-medium">Service</Label>
                <Select value={serviceName} onValueChange={setServiceName}>
                  <SelectTrigger id="uc-service" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SERVICE_NAMES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* ── collection lines ── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight">Collection lines</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setLines([...lines, blankLine()])}
              >
                <Plus className="h-4 w-4 mr-1" /> Add line
              </Button>
            </div>
            <div className="space-y-3">
              {lines.map((line, i) => (
                <div key={i} className="rounded-xl border bg-muted/30 p-4">
                  <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1.1fr_auto] items-end">
                    <div className="grid gap-1.5">
                      <Label className="text-xs text-muted-foreground">Category</Label>
                      <Select
                        value={line.fundId || undefined}
                        onValueChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, fundId: v } : x)))}
                      >
                        <SelectTrigger className="h-11"><SelectValue placeholder="Fund / category" /></SelectTrigger>
                        <SelectContent className="max-h-72">
                          {funds.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name} <span className="text-xs text-muted-foreground">({f.code})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs text-muted-foreground">Paid how</Label>
                      <Select
                        value={line.method}
                        onValueChange={(v) =>
                          setLines(
                            lines.map((x, j) =>
                              j === i ? { ...x, method: v, counting: v === "cash" ? x.counting : false, denoms: v === "cash" ? x.denoms : {} } : x,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COLLECTION_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <Label className="text-xs text-muted-foreground">Amount (₦)</Label>
                        {line.method === "cash" ? (
                          <button
                            type="button"
                            aria-pressed={line.counting}
                            aria-label={line.counting ? "Hide denomination counter" : "Count cash by denominations"}
                            title={line.counting ? "Hide denomination counter" : "Count cash by denominations"}
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                              line.counting
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                            onClick={() =>
                              setLines(
                                lines.map((x, j) =>
                                  j === i ? { ...x, counting: !x.counting, denoms: x.counting ? {} : x.denoms } : x,
                                ),
                              )
                            }
                          >
                            <Calculator className="h-3 w-3" /> {line.counting ? "Counting" : "Count"}
                          </button>
                        ) : null}
                      </div>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        className={`h-11 ${line.counting ? "font-mono tabular-nums" : ""}`}
                        value={line.counting ? (denomCents(line.denoms) / 100).toFixed(2) : line.naira}
                        readOnly={line.counting}
                        onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, naira: e.target.value } : x)))}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11"
                      aria-label="Remove line"
                      disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {line.counting ? (
                    <div className="mt-3 rounded-lg border bg-background px-3.5 py-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cash denomination calculator — notes × count
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {DENOMS.map((d) => (
                          <div key={d.key} className="grid gap-1.5">
                            <Label className="text-xs text-muted-foreground">{d.label} × count</Label>
                            <Input
                              inputMode="numeric"
                              placeholder="0"
                              className="h-10"
                              value={line.denoms[d.key] ?? ""}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, j) =>
                                    j === i ? { ...x, denoms: { ...x.denoms, [d.key]: e.target.value } } : x,
                                  ),
                                )
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        Cash subtotal: <span className="font-mono font-semibold text-foreground">{fmtMoney(denomCents(line.denoms))}</span>
                        <span className="ml-2 text-xs">counts fill this line's amount automatically</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-4 py-3">
              <span className="text-sm font-semibold">Total: <span className="font-mono text-base">{fmtMoney(totalCents)}</span></span>
              <span className="text-muted-foreground">·</span>
              {methodTotals.map(([m, cents]) => (
                <Badge key={m} variant="outline" className={`text-[11px] ${METHOD_TONES[m] ?? METHOD_TONES.other}`}>
                  {METHOD_LABELS[m] ?? m} · {fmtMoney(cents)}
                </Badge>
              ))}
              {hasDenoms ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  cash counted by denominations: <span className="font-mono">{fmtMoney(cashCountedCents)}</span>
                </span>
              ) : null}
            </div>
            {!allValid && lines.some((l) => (!l.counting && l.naira.trim() !== "") || l.fundId || (l.counting && denomCents(l.denoms) > 0)) ? (
              <p className="text-xs text-rose-600 dark:text-rose-300">
                Every line needs a category, a payment method and an amount greater than zero.
              </p>
            ) : null}
          </section>

          {/* ── counters & sign-off ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold tracking-tight">Counters &amp; sign-off</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="uc-by" className="text-sm font-medium">Counted by (1)</Label>
                <Input id="uc-by" className="h-11" value={countedByOne} onChange={(e) => setCountedByOne(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="uc-by-two" className="text-sm font-medium">Counted by (2)</Label>
                <Input
                  id="uc-by-two"
                  className="h-11"
                  value={user.name}
                  readOnly
                  aria-label="Second counter — recorded automatically from your sign-in when you sign and submit"
                />
                <p className="text-xs text-muted-foreground">
                  Recorded automatically from your sign-in when the sheet is signed &amp; submitted to finance.
                </p>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" className="h-10" disabled={busy || !allValid} onClick={() => save(false)}>
            {editing ? "Save changes" : "Save as draft"}
          </Button>
          <Button className="h-10" disabled={busy || !allValid} onClick={() => save(true)}>
            <Send className="h-4 w-4 mr-1" /> {editing ? "Save & submit to finance" : "Submit to finance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
