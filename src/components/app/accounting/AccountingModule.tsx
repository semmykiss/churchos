"use client";

/**
 * AccountingModule — internal fund accounting (admin/finance; pastors get
 * read-only aggregate oversight via accounting.view).
 * Tabs: Chart of Accounts | Bills & Vendors | Bank Reconciliation | Budgets | Reports.
 * Money is integer kobo everywhere; journal entries are append-only and must
 * balance to the kobo (server-enforced).
 */
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpenCheck, Briefcase, Building2, CheckCircle2, FileSpreadsheet, HeartHandshake,
  Landmark, Megaphone, Plus, Scale, Send, Target, Upload, Wallet,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, Section, StatCard, StatusBadge, useApiQuery,
  type ModuleProps,
} from "@/components/app/shared";
import { api, ApiError, qs } from "@/lib/api";
import { fmtDate, fmtMoney } from "@/lib/types";
import { canDo } from "@/lib/types";
import { ReceiptsTab } from "./receipts-tab";
import { VouchersTab } from "./vouchers-tab";
import { RemittancesTab } from "./remittances-tab";
import { NGN_METHOD_LABELS, bpsToPct } from "./accounting-shared";

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

const ACCOUNT_TYPES = ["asset", "liability", "net_asset", "revenue", "expense"] as const;
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", net_asset: "Net Assets", revenue: "Revenue", expense: "Expenses",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function AccountingModule({ user }: ModuleProps) {
  const canManage = canDo(user, "accounting.manage");
  const canView = canDo(user, "accounting.view") || canManage;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description="Double-entry general ledger: receipts, vouchers, bank reconciliation, budgets, HQ remittances and board-ready reports. Journal entries are append-only and must balance to the kobo."
      />
      <Tabs defaultValue={canView ? "receipts" : "accounts"}>
        <TabsList className="flex-wrap h-auto">
          {canView && <TabsTrigger value="receipts" className="gap-1.5"><HeartHandshake className="h-4 w-4" /> Receipts &amp; Giving Sync</TabsTrigger>}
          <TabsTrigger value="accounts" className="gap-1.5"><BookOpenCheck className="h-4 w-4" /> Chart of Accounts</TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1.5"><Wallet className="h-4 w-4" /> Expenses, Vouchers &amp; Bills</TabsTrigger>
          <TabsTrigger value="remittances" className="gap-1.5"><Send className="h-4 w-4" /> Remittances</TabsTrigger>
          <TabsTrigger value="reconciliation" className="gap-1.5"><Landmark className="h-4 w-4" /> Bank Reconciliation</TabsTrigger>
          <TabsTrigger value="budgets" className="gap-1.5"><Target className="h-4 w-4" /> Budgets</TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5"><FileSpreadsheet className="h-4 w-4" /> Reports</TabsTrigger>
        </TabsList>
        {canView && <TabsContent value="receipts" className="mt-4"><ReceiptsTab user={user} /></TabsContent>}
        <TabsContent value="accounts" className="mt-4"><AccountsTab canManage={canManage} /></TabsContent>
        <TabsContent value="expenses" className="mt-4"><VouchersTab user={user} /></TabsContent>
        <TabsContent value="remittances" className="mt-4"><RemittancesTab user={user} /></TabsContent>
        <TabsContent value="reconciliation" className="mt-4"><ReconciliationTab canManage={canManage} /></TabsContent>
        <TabsContent value="budgets" className="mt-4"><BudgetsTab canManage={canManage} /></TabsContent>
        <TabsContent value="reports" className="mt-4"><ReportsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ═════════════════════ CHART OF ACCOUNTS ═════════════════════ */

interface AccountDTO {
  id: string; code: string; name: string; type: string;
  fundRestriction: string; functionalClass: string | null; isActive: boolean; balanceCents: number;
}

function AccountsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const q = useApiQuery<{ items: AccountDTO[] }>(["accounts"], "/accounts");
  const [open, setOpen] = useState(false);
  const [jeOpen, setJeOpen] = useState(false);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  const byType = useMemo(() => {
    const m = new Map<string, AccountDTO[]>();
    for (const a of items) {
      m.set(a.type, [...(m.get(a.type) ?? []), a]);
    }
    return m;
  }, [items]);

  return (
    <div className="space-y-4">
      <Section
        title="Chart of accounts"
        description="The general ledger structure. Seed chart included — extend with your own codes. Click any account to open its ledger."
        actions={canManage ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setJeOpen(true)}>
              <Scale className="h-4 w-4" /> Manual Journal Entry
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New account
            </Button>
          </div>
        ) : undefined}
      >
        {q.isLoading ? (
          <LoadingBlock label="Loading accounts…" />
        ) : q.isError ? (
          <ErrorBlock error={q.error} />
        ) : items.length === 0 ? (
          <EmptyState icon={BookOpenCheck} title="No accounts" description="The seed chart appears on first load." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {ACCOUNT_TYPES.map((type) => {
              const list = byType.get(type) ?? [];
              if (!list.length) return null;
              return (
                <Card key={type}>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{ACCOUNT_TYPE_LABELS[type]}</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <ul className="divide-y">
                      {list.map((a) => (
                        <li key={a.id}>
                          <button type="button" onClick={() => setLedgerId(a.id)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors">
                            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{a.code}</span>
                            <span className="min-w-0 flex-1 truncate">{a.name}</span>
                            {a.functionalClass ? <Badge variant="outline" className="text-[10px]">{a.functionalClass}</Badge> : null}
                            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{fmtMoney(a.balanceCents)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Recent journal entries" description="Every posting, in double-entry form. Append-only — corrections are reversing entries.">
        <JournalEntriesList canManage={canManage} />
      </Section>

      {open ? <NewAccountDialog onClose={() => setOpen(false)} /> : null}
      {jeOpen ? <ManualJournalDialog onClose={() => setJeOpen(false)} /> : null}
      {ledgerId ? <AccountLedgerDrawer accountId={ledgerId} onClose={() => setLedgerId(null)} /> : null}
    </div>
  );
}

function JournalEntriesList({ canManage }: { canManage?: boolean }) {
  const qc = useQueryClient();
  const [reversing, setReversing] = useState<{ id: string; memo: string | null } | null>(null);
  const [reason, setReason] = useState("");
  const q = useApiQuery<{ items: { id: string; entryDate: string; memo: string | null; sourceType: string; reversedByEntryId?: string | null; lines: { accountCode: string; accountName: string; debitCents: number; creditCents: number }[] }[] }>(
    ["journal-entries"], "/journal-entries?take=20",
  );
  async function doReverse() {
    if (!reversing || !reason.trim()) return;
    try {
      await api.post(`/journal-entries/${reversing.id}/reverse`, { reason: reason.trim() });
      toast.success("Reversing entry posted.");
      setReversing(null); setReason("");
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err) { toast.error(errMsg(err)); }
  }
  if (q.isLoading) return <LoadingBlock label="Loading entries…" />;
  if (q.isError) return <ErrorBlock error={q.error} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState icon={Scale} title="No journal entries yet" description="Post a gift, bill or payment to see entries here." />;
  return (
    <div className="space-y-2">
      {items.map((e) => (
        <div key={e.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status={e.sourceType} />
            <span>{fmtDate(e.entryDate)}</span>
            <span className="min-w-0 flex-1 truncate">{e.memo}</span>
            {e.reversedByEntryId ? <Badge variant="outline" className="text-[10px] text-rose-600">reversed</Badge> : null}
            {canManage && !e.reversedByEntryId && e.sourceType !== "reversal" ? (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setReversing({ id: e.id, memo: e.memo }); setReason(""); }}>Reverse</Button>
            ) : null}
          </div>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {e.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-0.5 pr-2 font-mono text-xs text-muted-foreground">{l.accountCode}</td>
                  <td className="py-0.5">{l.accountName}</td>
                  <td className="py-0.5 text-right tabular-nums">{l.debitCents ? fmtMoney(l.debitCents) : ""}</td>
                  <td className="py-0.5 text-right tabular-nums">{l.creditCents ? fmtMoney(l.creditCents) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <AlertDialog open={!!reversing} onOpenChange={(o) => !o && setReversing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Reverse this journal entry?</AlertDialogTitle>
            <AlertDialogDescription>An append-only reversing entry will be created (debits↔credits swapped). The original is never edited. Reason: {reversing?.memo ?? ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reversal" />
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doReverse} disabled={!reason.trim()}>Reverse entry</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewAccountDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [restriction, setRestriction] = useState("unrestricted");
  const [functionalClass, setFunctionalClass] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.post("/accounts", { code, name, type, fundRestriction: restriction, functionalClass: functionalClass || undefined });
      toast.success(`Account ${code} created`);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>Codes follow your chart numbering — e.g. 6xxx for new expense groups.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acct-code">Code *</Label>
              <Input id="acct-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6100" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-type">Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="acct-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acct-name">Name *</Label>
            <Input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Utilities" />
          </div>
          {type === "expense" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="acct-func">Functional class</Label>
                <Select value={functionalClass} onValueChange={setFunctionalClass}>
                  <SelectTrigger id="acct-func"><SelectValue placeholder="Program" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="program">Program</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="fundraising">Fundraising</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acct-restr">Fund restriction</Label>
                <Select value={restriction} onValueChange={setRestriction}>
                  <SelectTrigger id="acct-restr"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unrestricted">Unrestricted</SelectItem>
                    <SelectItem value="temp_restricted">Temp restricted</SelectItem>
                    <SelectItem value="perm_restricted">Perm restricted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !code.trim() || !name.trim()} onClick={() => void save()}>
            {busy ? "Saving…" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═════════════════════ BILLS & VENDORS ═════════════════════ */

interface BillDTO {
  id: string;
  vendor: { id: string; name: string };
  billNumber: string | null;
  billDate: string;
  dueDate: string;
  status: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  lines: { accountId: string; fundId: string | null; description: string | null; amountCents: number }[];
}

export function BillsVendorsTab({ canManage }: { canManage: boolean }) {
  const [sub, setSub] = useState<"bills" | "vendors">("bills");
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(["bills", "vendors"] as const).map((s) => (
          <button
            key={s} onClick={() => setSub(s)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition-colors ${sub === s ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {sub === "bills" ? <BillsList canManage={canManage} /> : <VendorsList canManage={canManage} />}
    </div>
  );
}

function BillsList({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const q = useApiQuery<{ items: BillDTO[] }>(["bills"], "/bills");
  const accountsQ = useApiQuery<{ items: AccountDTO[] }>(["accounts"], "/accounts");
  const [newOpen, setNewOpen] = useState(false);
  const [payFor, setPayFor] = useState<BillDTO | null>(null);
  const [voidFor, setVoidFor] = useState<BillDTO | null>(null);
  const items = q.data?.items ?? [];
  const expenseAccounts = (accountsQ.data?.items ?? []).filter((a) => a.type === "expense");
  const outstanding = items.filter((b) => b.status === "unpaid" || b.status === "partial");
  const dueSoon = outstanding.filter((b) => new Date(b.dueDate).getTime() - Date.now() < 14 * 86400 * 1000).reduce((a, b) => a + b.balanceCents, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Outstanding bills" value={outstanding.length} icon={Building2} tone={outstanding.length ? "warning" : "default"} />
        <StatCard label="Due within 14 days" value={fmtMoney(dueSoon)} icon={Wallet} tone={dueSoon > 0 ? "warning" : "default"} />
        <StatCard label="Total on file" value={items.length} icon={FileSpreadsheet} />
      </div>

      <Section
        title="Bills"
        description="Accounts payable. Recording a bill books the expense; paying it settles the liability."
        actions={canManage ? (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> New bill
          </Button>
        ) : undefined}
      >
        {q.isLoading ? (
          <LoadingBlock label="Loading bills…" />
        ) : q.isError ? (
          <ErrorBlock error={q.error} />
        ) : items.length === 0 ? (
          <EmptyState icon={Building2} title="No bills" description="Record your first vendor bill to start tracking payables." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.vendor.name}</TableCell>
                    <TableCell className="text-muted-foreground">{b.billNumber ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(b.dueDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(b.totalCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(b.balanceCents)}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right">
                      {canManage && (b.status === "unpaid" || b.status === "partial") ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setPayFor(b)}>Record payment</Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setVoidFor(b)}>Void</Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {newOpen ? <NewBillDialog accounts={expenseAccounts} onClose={() => setNewOpen(false)} /> : null}
      {payFor ? <PayBillDialog bill={payFor} onClose={() => setPayFor(null)} /> : null}

      <AlertDialog open={!!voidFor} onOpenChange={(o) => !o && setVoidFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this bill?</AlertDialogTitle>
            <AlertDialogDescription>
              The bill is marked void and its accrual entry stays in the book. Bills with payments cannot be voided.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={async (e) => {
              e.preventDefault();
              if (!voidFor) return;
              try {
                await api.post(`/bills/${voidFor.id}/void`, {});
                toast.success("Bill voided");
                void qc.invalidateQueries({ queryKey: ["bills"] });
                void qc.invalidateQueries({ queryKey: ["accounts"] });
              } catch (err) {
                toast.error(errMsg(err));
              }
              setVoidFor(null);
            }}>Void bill</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewBillDialog({ accounts, onClose }: { accounts: AccountDTO[]; onClose: () => void }) {
  const qc = useQueryClient();
  const vendorsQ = useApiQuery<{ items: { id: string; name: string; defaultExpenseAccountId: string | null }[] }>(["vendors"], "/vendors");
  const vendors = vendorsQ.data?.items ?? [];
  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<{ accountId: string; fundId: string; description: string; amount: string }[]>([
    { accountId: "", fundId: "", description: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const fundsQ = useApiQuery<{ items: { id: string; name: string; type: string }[] }>(["funds"], "/funds");
  const funds = fundsQ.data?.items ?? [];
  const totalCents = lines.reduce((a, l) => a + Math.round(Number(l.amount) * 100) || 0, 0);
  const balanced = lines.every((l) => Math.round(Number(l.amount) * 100) > 0 && l.accountId);

  async function save() {
    setBusy(true);
    try {
      await api.post("/bills", {
        vendorId,
        billNumber: billNumber || undefined,
        billDate,
        dueDate: dueDate || billDate,
        memo: memo || undefined,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          fundId: l.fundId || undefined,
          description: l.description || undefined,
          amountCents: Math.round(Number(l.amount) * 100),
        })),
      });
      toast.success(`Bill recorded — ${fmtMoney(totalCents)} accrued to Accounts Payable`);
      void qc.invalidateQueries({ queryKey: ["bills"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New bill</DialogTitle>
          <DialogDescription>Lines must name an expense account; the total accrues to Accounts Payable.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vendor *</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-num">Bill #</Label>
              <Input id="bill-num" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="INV-2041" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-date">Bill date *</Label>
              <Input id="bill-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-due">Due date</Label>
              <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* line items — same must-balance discipline as gift splits */}
          <div className="space-y-2">
            <Label>Line items</Label>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                <Select value={l.accountId} onValueChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, accountId: v } : x)))}>
                  <SelectTrigger aria-label="Expense account"><SelectValue placeholder="Expense account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={l.fundId} onValueChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, fundId: v } : x)))}>
                  <SelectTrigger aria-label="Fund"><SelectValue placeholder="Fund (optional)" /></SelectTrigger>
                  <SelectContent>
                    {funds.map((f) => <SelectItem key={f.id} value={f.id}>{f.type === "tithe" ? "Tithe" : f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  inputMode="decimal" className="w-28" placeholder="0.00" value={l.amount}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, "") } : x)))}
                  aria-label="Amount"
                />
                <Button
                  variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setLines([...lines, { accountId: "", fundId: "", description: "", amount: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
            <div className={`rounded-md border p-2 text-sm font-medium tabular-nums ${balanced ? "border-teal-600/30 bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200" : "border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>
              Total: {fmtMoney(totalCents)} {balanced ? "— ready to accrue" : "— every line needs an account and an amount"}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bill-memo">Memo</Label>
            <Textarea id="bill-memo" rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !vendorId || !balanced} onClick={() => void save()}>
            {busy ? "Saving…" : "Record bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayBillDialog({ bill, onClose }: { bill: BillDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const banksQ = useApiQuery<{ items: { id: string; name: string }[] }>(["bank-accounts"], "/bank-accounts");
  const [amount, setAmount] = useState((bill.balanceCents / 100).toFixed(2));
  const [method, setMethod] = useState("bank_transfer");
  const [checkNumber, setCheckNumber] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const banks = banksQ.data?.items ?? [];
  const amountCents = Math.round(Number(amount) * 100);
  const valid = amountCents > 0 && amountCents <= bill.balanceCents;

  async function save() {
    setBusy(true);
    try {
      await api.post(`/bills/${bill.id}/payments`, {
        amountCents, method, checkNumber: checkNumber || undefined, paidOn,
        bankAccountId: bankAccountId || undefined,
      });
      toast.success(`Payment of ${fmtMoney(amountCents)} recorded — AP settled`);
      void qc.invalidateQueries({ queryKey: ["bills"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment — {bill.vendor.name}</DialogTitle>
          <DialogDescription>
            Balance due {fmtMoney(bill.balanceCents)} of {fmtMoney(bill.totalCents)}. Partial payments are supported.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount</Label>
              <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Paid on</Label>
              <Input id="pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="pay-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["bank_transfer", "pos", "cheque", "cash"].map((m) => <SelectItem key={m} value={m}>{NGN_METHOD_LABELS[m] ?? m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(method === "cheque" || method === "bank_transfer" || method === "pos") ? (
              <div className="space-y-1.5">
                <Label htmlFor="pay-check">Payment ref / teller #</Label>
                <Input id="pay-check" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} placeholder="NIBSS session / cheque #" />
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Bank account</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger><SelectValue placeholder="Default operating cash" /></SelectTrigger>
              <SelectContent>
                {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!valid && amount ? <p className="text-xs font-medium text-red-600">Amount must be between ₦0.01 and the balance due.</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => void save()}>{busy ? "Saving…" : "Record payment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VendorsList({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const q = useApiQuery<{ items: { id: string; name: string; email: string | null; phone: string | null; taxId: string | null; openBillCount: number; openTotalCents: number }[] }>(["vendors"], "/vendors");
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];

  return (
    <Section
      title="Vendors"
      description="Who the church buys from — TIN tracking for Withholding Tax compliance."
      actions={canManage ? (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New vendor
        </Button>
      ) : undefined}
    >
      {q.isLoading ? (
        <LoadingBlock label="Loading vendors…" />
      ) : q.isError ? (
        <ErrorBlock error={q.error} />
      ) : items.length === 0 ? (
        <EmptyState icon={Building2} title="No vendors" description="Add your first vendor to record bills." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{v.name}</p>
                <p className="text-xs text-muted-foreground">{[v.email, v.phone, v.taxId ? `TIN ${v.taxId}` : null, v.whtApplicable ? "WHT ✓" : null].filter(Boolean).join(" · ") || "No contact details"}</p>
              </div>
              {v.openBillCount > 0 ? (
                <Badge variant="outline">{v.openBillCount} open · {fmtMoney(v.openTotalCents)}</Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {open ? <NewVendorDialog onClose={() => setOpen(false)} /> : null}
    </Section>
  );
}

function NewVendorDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumberNuban, setAccountNumberNuban] = useState("");
  const [whtApplicable, setWhtApplicable] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.post("/vendors", { name, email: email || undefined, phone: phone || undefined, taxId: taxId || undefined, bankName: bankName || undefined, accountNumberNuban: accountNumberNuban || undefined, whtApplicable });
      toast.success("Vendor added");
      void qc.invalidateQueries({ queryKey: ["vendors"] });
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New vendor</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="v-name">Name *</Label><Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="v-email">Email</Label><Input id="v-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="v-phone">Phone</Label><Input id="v-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="v-tax">TIN (Tax Identification Number)</Label><Input id="v-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="e.g. 12345678-0001" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="v-bank">Bank name</Label><Input id="v-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Guaranty Trust Bank" /></div>
            <div className="space-y-1.5"><Label htmlFor="v-nuban">NUBAN (10 digits)</Label><Input id="v-nuban" inputMode="numeric" maxLength={10} value={accountNumberNuban} onChange={(e) => setAccountNumberNuban(e.target.value.replace(/\D/g, ""))} placeholder="0123456789" /></div>
          </div>
          <label className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer">
            <span className="text-sm">WHT applicable (Withholding Tax)</span>
            <input type="checkbox" checked={whtApplicable} onChange={(e) => setWhtApplicable(e.target.checked)} className="h-4 w-4" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Add vendor"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═════════════════════ BANK RECONCILIATION ═════════════════════ */

function ReconciliationTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const banksQ = useApiQuery<{ items: { id: string; name: string; glAccountCode: string | null }[] }>(["bank-accounts"], "/bank-accounts");
  const accountsQ = useApiQuery<{ items: AccountDTO[] }>(["accounts"], "/accounts");
  const banks = banksQ.data?.items ?? [];
  const cashAccounts = (accountsQ.data?.items ?? []).filter((a) => a.type === "asset");
  const [bankId, setBankId] = useState("");
  const [selectedTxn, setSelectedTxn] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const activeId = bankId || banks[0]?.id || "";
  const detailQ = useApiQuery<{
    bankAccount: { name: string };
    transactions: { id: string; postedDate: string; description: string | null; amountCents: number; reconciled: boolean; matchedJournalEntryId: string | null }[];
    entries: { id: string; entryDate: string; memo: string | null; amountCents: number }[];
    summary: { bookBalanceCents: number; bankBalanceCents: number; differenceCents: number; reconciledCount: number; totalCount: number };
  }>(
    ["bank-txn", activeId], activeId ? `/bank-accounts/${activeId}/transactions` : "/bank-accounts",
  );

  async function match(entryId: string) {
    if (!selectedTxn) return;
    try {
      await api.post(`/bank-transactions/${selectedTxn}/match`, { journalEntryId: entryId });
      toast.success("Matched and reconciled");
      setSelectedTxn(null);
      void qc.invalidateQueries({ queryKey: ["bank-txn"] });
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function autoMatch() {
    if (!activeId) return;
    try {
      const r = await api.post(`/bank-accounts/${activeId}/automatch`, {});
      toast.success(`Auto-matched ${r.matched} of ${r.considered} unreconciled bank lines.`);
      void qc.invalidateQueries({ queryKey: ["bank-txn"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err) { toast.error(errMsg(err)); }
  }

  async function quickBook(txnId: string, kind: "charge" | "interest") {
    try {
      await api.post(`/bank-transactions/${txnId}/quickbook`, { kind });
      toast.success(kind === "charge" ? "Bank charge booked & reconciled." : "Bank interest booked & reconciled.");
      void qc.invalidateQueries({ queryKey: ["bank-txn"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
    } catch (err) { toast.error(errMsg(err)); }
  }

  if (banksQ.isLoading) return <LoadingBlock label="Loading bank accounts…" />;
  if (!banks.length) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Landmark} title="No bank accounts"
          description={canManage ? "Add a bank account and link it to a cash GL account to start reconciling." : "No bank accounts configured."}
        />
        {canManage ? <NewBankAccountDialog cashAccounts={cashAccounts} onDone={() => { void qc.invalidateQueries({ queryKey: ["bank-accounts"] }); }} /> : null}
      </div>
    );
  }

  const s = detailQ.data?.summary;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={activeId} onValueChange={setBankId}>
          <SelectTrigger className="w-64" aria-label="Bank account"><SelectValue /></SelectTrigger>
          <SelectContent>
            {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {canManage ? (
          <div className="flex gap-2">
            <NewBankAccountDialog cashAccounts={cashAccounts} onDone={() => { void qc.invalidateQueries({ queryKey: ["bank-accounts"] }); }} />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void autoMatch()} disabled={!activeId}>
              <CheckCircle2 className="h-4 w-4" /> Auto-Match
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Import statement (CSV / OFX)
            </Button>
          </div>
        ) : null}
      </div>

      {s ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Book balance" value={fmtMoney(s.bookBalanceCents)} icon={Scale} />
          <StatCard label="Bank balance (imported)" value={fmtMoney(s.bankBalanceCents)} icon={Landmark} />
          <StatCard label="Difference" value={fmtMoney(s.differenceCents)} icon={s.differenceCents === 0 ? CheckCircle2 : Wallet} tone={s.differenceCents === 0 ? "positive" : "warning"} sub={`${s.reconciledCount}/${s.totalCount} reconciled`} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Bank transactions" description="Click one, then click the matching entry.">
          {detailQ.isLoading ? (
            <LoadingBlock label="Loading…" />
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border scroll-slim">
              {(detailQ.data?.transactions ?? []).map((t) => (
                <li key={t.id}>
                  <button
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${selectedTxn === t.id ? "bg-primary/10" : ""} ${t.reconciled ? "opacity-60" : ""}`}
                    onClick={() => !t.reconciled && setSelectedTxn(selectedTxn === t.id ? null : t.id)}
                  >
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">{fmtDate(t.postedDate)}</span>
                    <span className="min-w-0 flex-1 truncate">{t.description ?? "—"}</span>
                    {t.reconciled ? <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600" aria-label="reconciled" /> : null}
                    <span className={`shrink-0 tabular-nums ${t.amountCents < 0 ? "text-red-600" : "text-teal-700"}`}>
                      {t.amountCents < 0 ? "−" : "+"}{fmtMoney(Math.abs(t.amountCents))}
                    </span>
                  </button>
                  {canManage && !t.reconciled ? (
                    <div className="flex justify-end gap-1 px-3 pb-1.5 -mt-1">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void quickBook(t.id, "charge")}>Quick book charge</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void quickBook(t.id, "interest")}>Quick book interest</Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Book entries (cash side)" description={selectedTxn ? "Click the entry that matches the selected bank line." : "Select a bank transaction to match."}>
          <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border scroll-slim">
            {(detailQ.data?.entries ?? []).map((e) => (
              <li key={e.id}>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  disabled={!selectedTxn || !canManage}
                  onClick={() => void match(e.id)}
                >
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">{fmtDate(e.entryDate)}</span>
                  <span className="min-w-0 flex-1 truncate">{e.memo ?? "—"}</span>
                  <span className={`shrink-0 tabular-nums ${e.amountCents < 0 ? "text-red-600" : "text-teal-700"}`}>
                    {e.amountCents < 0 ? "−" : "+"}{fmtMoney(Math.abs(e.amountCents))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {importOpen ? <ImportStatementDialog bankId={activeId} onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}

function NewBankAccountDialog({ cashAccounts, onDone }: { cashAccounts: AccountDTO[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [glAccountId, setGlAccountId] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.post("/bank-accounts", { name, glAccountId: glAccountId || undefined });
      toast.success("Bank account added");
      void qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New bank account
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New bank account</DialogTitle>
            <DialogDescription>Link it to a cash GL account so imported statements can match journal entries.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bank-name">Name *</Label>
              <Input id="bank-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Operating — First Community Bank ••4021" />
            </div>
            <div className="space-y-1.5">
              <Label>GL cash account</Label>
              <Select value={glAccountId} onValueChange={setGlAccountId}>
                <SelectTrigger><SelectValue placeholder="Pick a cash account" /></SelectTrigger>
                <SelectContent>
                  {cashAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportStatementDialog({ bankId, onClose }: { bankId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const looksOfx = /<\s*(ofx|stmttrn)/i.test(content);

  async function save() {
    setBusy(true);
    try {
      const res = await api.post<{ imported: number; parsed: number; format: string }>(`/bank-accounts/${bankId}/import`, { content });
      toast.success(`Imported ${res.imported} of ${res.parsed} rows from ${res.format.toUpperCase()} (duplicates skipped)`);
      void qc.invalidateQueries({ queryKey: ["bank-txn"] });
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import bank statement</DialogTitle>
          <DialogDescription>
            CSV (date, description, amount — deposits positive) or an OFX/QFX export from your bank. Re-imports are deduped.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file" accept=".csv,.ofx,.qfx,text/csv,application/ofx" ref={fileRef}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setContent(await f.text());
            }}
          />
          {content ? (
            <p className={`text-xs ${looksOfx ? "text-teal-700" : "text-muted-foreground"}`}>
              {looksOfx ? "OFX/QFX detected — transactions will be parsed from <STMTTRN> records." : "Parsed as CSV rows."}
            </p>
          ) : null}
          <Textarea
            rows={6} value={content} onChange={(e) => setContent(e.target.value)}
            placeholder={`CSV:  2026-10-01,Transfer — weekly giving,1250.00
…or paste an OFX/QFX file — <STMTTRN> blocks are detected automatically.`}
            className="font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !content.trim()} onClick={() => void save()}>{busy ? "Importing…" : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═════════════════════ BUDGETS ═════════════════════ */

function BudgetsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [kind, setKind] = useState<"expense" | "revenue">("expense");
  const q = useApiQuery<{
    accounts: { id: string; code: string; name: string }[];
    budgets: { accountId: string; monthly: number[] }[];
    actual: Record<string, number[]>;
  }>(["budgets", year, kind], `/budgets${qs({ fiscalYear: year, kind })}`);

  const [editing, setEditing] = useState<{ accountId: string; monthly: number[] } | null>(null);
  const accounts = q.data?.accounts ?? [];
  const budgetMap = new Map((q.data?.budgets ?? []).map((b) => [b.accountId, b.monthly] as const));
  const actual = q.data?.actual ?? {};

  const totalBudget = accounts.reduce((a, acct) => a + (budgetMap.get(acct.id) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).reduce((x, y) => x + y, 0), 0);
  const totalActual = accounts.reduce((a, acct) => a + (actual[acct.id] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).reduce((x, y) => x + y, 0), 0);

  async function saveRow() {
    if (!editing) return;
    try {
      await api.post("/budgets", { fiscalYear: year, accountId: editing.accountId, monthly: editing.monthly });
      toast.success("Budget saved");
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["budgets"] });
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-40" aria-label="Fiscal year"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[thisYear + 1, thisYear, thisYear - 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => setKind(v as "expense" | "revenue")}>
          <SelectTrigger className="w-44" aria-label="Budget kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="expense">Expense budgets</SelectItem>
            <SelectItem value="revenue">Revenue budgets</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-1 flex-wrap justify-end gap-3">
          <StatCard label="Budgeted (year)" value={fmtMoney(totalBudget)} icon={Target} />
          <StatCard label="Actual (year)" value={fmtMoney(totalActual)} icon={Scale} tone={totalActual > totalBudget ? "warning" : "default"} />
        </div>
      </div>

      <Section title={kind === "revenue" ? "Revenue budget vs actual" : "Budget vs actual"} description={kind === "revenue" ? "Projected Tithes / Offerings / Receipts per revenue account, with actuals from the GL." : "Monthly expense budget per account with actuals from the GL."}>
        {q.isLoading ? (
          <LoadingBlock label="Loading budgets…" />
        ) : accounts.length === 0 ? (
          <EmptyState icon={Target} title={`No ${kind} accounts`} description={`Add ${kind} accounts in the Chart of Accounts.`} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  {MONTHS.map((m) => <TableHead key={m} className="text-right text-xs">{m}</TableHead>)}
                  <TableHead className="text-right">Year</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  {canManage ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((acct) => {
                  const budget = budgetMap.get(acct.id) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
                  const act = actual[acct.id] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
                  const bTotal = budget.reduce((x, y) => x + y, 0);
                  const aTotal = act.reduce((x, y) => x + y, 0);
                  const variancePct = bTotal > 0 ? Math.round(((aTotal - bTotal) / bTotal) * 100) : null;
                  return (
                    <TableRow key={acct.id}>
                      <TableCell className="whitespace-nowrap text-sm">{acct.code} · {acct.name}</TableCell>
                      {budget.map((b, i) => (
                        <TableCell key={i} className="text-right text-xs tabular-nums">
                          <span className={act[i] > b && b > 0 ? "font-medium text-red-600" : ""}>{fmtMoney(b)}</span>
                          {act[i] ? <span className="block text-[10px] text-muted-foreground">act {fmtMoney(act[i])}</span> : null}
                        </TableCell>
                      ))}
                      <TableCell className="text-right text-sm font-medium tabular-nums">{fmtMoney(bTotal)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {variancePct == null ? "—" : (
                          <span className={variancePct > 0 ? "text-red-600" : "text-teal-700"}>{variancePct > 0 ? "+" : ""}{variancePct}%</span>
                        )}
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ accountId: acct.id, monthly: [...budget] })}>Edit</Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {editing ? (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Edit monthly budget</DialogTitle></DialogHeader>
            <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
              <div className="space-y-1">
                <Label className="text-xs">Distribute annual amount evenly</Label>
                <Input inputMode="decimal" className="h-8 w-40 text-sm" placeholder="e.g. 1200000" onChange={(e) => {
                  const annual = Math.round(Number(e.target.value.replace(/[^0-9.]/g, "")) * 100) || 0;
                  if (annual > 0) {
                    const each = Math.floor(annual / 12);
                    const rem = annual - each * 12;
                    const monthly = Array(12).fill(each);
                    monthly[0] += rem;
                    setEditing({ ...editing, monthly });
                  }
                }} />
              </div>
              <p className="text-xs text-muted-foreground pb-1.5">Enter an annual ₦ amount to spread it evenly across Jan–Dec.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {MONTHS.map((m, i) => (
                <div key={m} className="space-y-1">
                  <Label className="text-xs">{m}</Label>
                  <Input
                    inputMode="decimal" className="h-8 text-sm"
                    value={((editing.monthly[i] ?? 0) / 100).toString()}
                    onChange={(e) => {
                      const v = Math.round(Number(e.target.value.replace(/[^0-9.]/g, "")) * 100) || 0;
                      setEditing({ ...editing, monthly: editing.monthly.map((x, j) => (j === i ? v : x)) });
                    }}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => void saveRow()}>Save budget</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/* ═════════════════════ REPORTS ═════════════════════ */

function ReportsTab() {
  const thisYear = new Date().getUTCFullYear();
  const [report, setReport] = useState("activities");
  const [from, setFrom] = useState(`${thisYear}-01-01`);
  const [to, setTo] = useState(`${thisYear}-12-31`);
  const [asOf, setAsOf] = useState(`${thisYear}-12-31`);

  const rangeParams = qs({ from, to });
  const activitiesQ = useApiQuery<{
    revenue: { fundName: string; fundType: string; amountCents: number }[];
    expenses: { fundName: string; amountCents: number }[];
    byFunctional: Record<string, number>;
    totalRevenueCents: number; totalExpenseCents: number; netCents: number;
  }>(["report", "activities", from, to], `/reports/statement-of-activities${rangeParams}`);
  const positionQ = useApiQuery<{
    assets: { code: string; name: string; balanceCents: number }[];
    liabilities: { code: string; name: string; balanceCents: number }[];
    netAssets: { code: string; name: string; restriction: string; balanceCents: number }[];
    undesignatedSurplusCents: number;
    totalAssetsCents: number; totalLiabilitiesCents: number; totalNetAssetsCents: number; checkCents: number;
  }>(["report", "position", asOf], `/reports/statement-of-financial-position${qs({ asOf })}`);
  const fundsQ = useApiQuery<{ items: { name: string; type: string; revenueCents: number; expenseCents: number; balanceCents: number }[] }>(
    ["report", "funds", asOf], `/reports/fund-balances${qs({ asOf })}`,
  );
  const givingQ = useApiQuery<{ items: { type: string; amountCents: number; count: number }[]; totalCents: number; giftCount: number }>(
    ["report", "giving", from, to], `/reports/giving-breakdown${rangeParams}`,
  );
  const receiptsPaymentsQ = useApiQuery<{
    openingBalanceCents: number; receipts: { category: string; amountCents: number }[]; payments: { category: string; amountCents: number }[];
    totalReceiptsCents: number; totalPaymentsCents: number; closingBalanceCents: number;
  }>(["report", "receipts-payments", from, to], `/reports/receipts-payments${rangeParams}`);
  const remittancesQ = useApiQuery<{
    destinations: { name: string; tier: string; grossBaseCents: number; accruedCents: number; paidCents: number; outstandingCents: number }[];
    totalAccruedCents: number; totalPaidCents: number; totalOutstandingCents: number;
  }>(["report", "remittances", from, to], `/reports/remittances${rangeParams}`);
  const trialBalanceQ = useApiQuery<{
    items: { code: string; name: string; type: string; debitCents: number; creditCents: number }[];
    totalDebitsCents: number; totalCreditsCents: number; checkCents: number;
  }>(["report", "trial-balance", asOf], `/reports/trial-balance${qs({ asOf })}`);

  const REPORTS = [
    { key: "activities", label: "Statement of Activities" },
    { key: "position", label: "Statement of Financial Position" },
    { key: "functional", label: "Statement of Functional Expenses" },
    { key: "funds", label: "Fund Balances" },
    { key: "giving", label: "Giving Breakdown" },
    { key: "receipts_payments", label: "Receipts & Payments Account" },
    { key: "remittances", label: "National / HQ Remittance Report" },
    { key: "trial_balance", label: "Trial Balance" },
  ];

  const FUNCTIONAL_LABELS: Record<string, string> = {
    program: "Program services",
    admin: "Management & general",
    fundraising: "Fundraising",
  };

  function exportCsv() {
    let rows: string[][] = [];
    if (report === "activities" && activitiesQ.data) {
      rows = [["Section", "Fund", "Type", "Amount (cents)"],
        ...activitiesQ.data.revenue.map((r) => ["Revenue", r.fundName, r.fundType, String(r.amountCents)]),
        ...activitiesQ.data.expenses.map((e) => ["Expense", e.fundName, "", String(e.amountCents)]),
        ["Net", "", "", String(activitiesQ.data.netCents)]];
    } else if (report === "functional" && activitiesQ.data) {
      const entries = Object.entries(activitiesQ.data.byFunctional ?? {});
      rows = [["Functional class", "Amount (cents)"],
        ...entries.map(([k, v]) => [FUNCTIONAL_LABELS[k] ?? k, String(v)]),
        ["Total expenses", String(activitiesQ.data.totalExpenseCents)]];
    } else if (report === "position" && positionQ.data) {
      rows = [["Section", "Code", "Name", "Amount (cents)"],
        ...positionQ.data.assets.map((a) => ["Asset", a.code, a.name, String(a.balanceCents)]),
        ...positionQ.data.liabilities.map((l) => ["Liability", l.code, l.name, String(l.balanceCents)]),
        ...positionQ.data.netAssets.map((n) => ["Net asset", n.code, n.name, String(n.balanceCents)])];
    } else if (report === "funds" && fundsQ.data) {
      rows = [["Fund", "Type", "Revenue (cents)", "Expenses (cents)", "Balance (cents)"],
        ...fundsQ.data.items.map((f) => [f.name, f.type, String(f.revenueCents), String(f.expenseCents), String(f.balanceCents)])];
    } else if (report === "giving" && givingQ.data) {
      rows = [["Fund type", "Amount (cents)", "Gifts"],
        ...givingQ.data.items.map((g) => [g.type, String(g.amountCents), String(g.count)])];
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report}-${report === "position" || report === "funds" ? asOf : from + "_to_" + to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Report</Label>
          <Select value={report} onValueChange={setReport}>
            <SelectTrigger className="w-72" aria-label="Report"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REPORTS.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {report === "position" || report === "funds" ? (
          <div className="space-y-1.5">
            <Label htmlFor="rep-asof">As of</Label>
            <Input id="rep-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="rep-from">From</Label>
              <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-to">To</Label>
              <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
        <Button variant="outline" onClick={() => window.print()}><FileSpreadsheet className="h-4 w-4 mr-1.5" />Print / PDF Report</Button>
      </div>

      {report === "activities" ? (
        <Card>
          <CardHeader><CardTitle>Statement of Activities</CardTitle></CardHeader>
          <CardContent>
            {activitiesQ.isLoading ? <LoadingBlock /> : activitiesQ.isError ? <ErrorBlock error={activitiesQ.error} /> : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <StatCard label="Total revenue" value={fmtMoney(activitiesQ.data?.totalRevenueCents ?? 0)} icon={Scale} tone="positive" />
                  <StatCard label="Total expenses" value={fmtMoney(activitiesQ.data?.totalExpenseCents ?? 0)} icon={Wallet} tone="warning" />
                  <StatCard label="Net surplus / (deficit)" value={fmtMoney(activitiesQ.data?.netCents ?? 0)} icon={CheckCircle2} tone={(activitiesQ.data?.netCents ?? 0) >= 0 ? "positive" : "negative"} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Revenue by fund</h4>
                    <ul className="divide-y rounded-lg border text-sm">
                      {(activitiesQ.data?.revenue ?? []).map((r, i) => (
                        <li key={i} className="flex justify-between px-3 py-1.5"><span>{r.fundName}</span><span className="tabular-nums">{fmtMoney(r.amountCents)}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Expenses by fund</h4>
                    <ul className="divide-y rounded-lg border text-sm">
                      {(activitiesQ.data?.expenses ?? []).map((e, i) => (
                        <li key={i} className="flex justify-between px-3 py-1.5"><span>{e.fundName}</span><span className="tabular-nums">{fmtMoney(e.amountCents)}</span></li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {report === "position" ? (
        <Card>
          <CardHeader><CardTitle>Statement of Financial Position</CardTitle></CardHeader>
          <CardContent>
            {positionQ.isLoading ? <LoadingBlock /> : positionQ.isError ? <ErrorBlock error={positionQ.error} /> : (
              <div className="space-y-4">
                {positionQ.data?.checkCents ? (
                  <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    Note: A = L + NA is off by {fmtMoney(positionQ.data.checkCents)} — check for unbalanced or partial entries.
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-teal-700"><CheckCircle2 className="h-3.5 w-3.5" /> Assets = Liabilities + Net Assets ✓</p>
                )}
                <div className="grid gap-4 lg:grid-cols-3">
                  {([["Assets", positionQ.data?.assets], ["Liabilities", positionQ.data?.liabilities], ["Net Assets", positionQ.data?.netAssets]] as const).map(([label, list]) => (
                    <div key={label}>
                      <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{label}</h4>
                      <ul className="divide-y rounded-lg border text-sm">
                        {(list ?? []).map((x, i) => (
                          <li key={i} className="flex justify-between px-3 py-1.5"><span className="truncate">{x.code} · {x.name}</span><span className="tabular-nums">{fmtMoney(x.balanceCents)}</span></li>
                        ))}
                        {label === "Net Assets" && positionQ.data?.undesignatedSurplusCents ? (
                          <li className="flex justify-between px-3 py-1.5 font-medium"><span>Undesignated surplus (unclosed)</span><span className="tabular-nums">{fmtMoney(positionQ.data.undesignatedSurplusCents)}</span></li>
                        ) : null}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {report === "functional" ? (
        <Card>
          <CardHeader><CardTitle>Statement of Functional Expenses</CardTitle></CardHeader>
          <CardContent>
            {activitiesQ.isLoading ? <LoadingBlock /> : activitiesQ.isError ? <ErrorBlock error={activitiesQ.error} /> : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Expense allocation by functional class — the Program / Admin / Fundraising split required for Charity & CAC Incorporated Trustees governance reporting.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  {["program", "admin", "fundraising"].map((k) => {
                    const v = activitiesQ.data?.byFunctional?.[k] ?? 0;
                    return (
                      <StatCard
                        key={k}
                        label={FUNCTIONAL_LABELS[k]}
                        value={fmtMoney(v)}
                        icon={k === "program" ? HeartHandshake : k === "admin" ? Briefcase : Megaphone}
                        tone={k === "program" ? "positive" : "default"}
                      />
                    );
                  })}
                </div>
                <ul className="divide-y rounded-lg border text-sm">
                  {["program", "admin", "fundraising"].map((k) => {
                    const v = activitiesQ.data?.byFunctional?.[k] ?? 0;
                    const total = activitiesQ.data?.totalExpenseCents ?? 0;
                    const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                    return (
                      <li key={k} className="px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span>{FUNCTIONAL_LABELS[k]}</span>
                          <span className="font-medium tabular-nums">{fmtMoney(v)} · {pct}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={k === "program" ? "h-full rounded-full bg-teal-600" : k === "admin" ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-rose-500"} style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                  <li className="flex justify-between px-3 py-2 font-medium">
                    <span>Total expenses</span>
                    <span className="tabular-nums">{fmtMoney(activitiesQ.data?.totalExpenseCents ?? 0)}</span>
                  </li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {report === "funds" ? (
        <Card>
          <CardHeader><CardTitle>Fund Balances</CardTitle></CardHeader>
          <CardContent>
            {fundsQ.isLoading ? <LoadingBlock /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Fund</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Expenses</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(fundsQ.data?.items ?? []).map((f, i) => (
                    <TableRow key={i}>
                      <TableCell>{f.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{f.type}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(f.revenueCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(f.expenseCents)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmtMoney(f.balanceCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {report === "giving" ? (
        <Card>
          <CardHeader><CardTitle>Giving Breakdown</CardTitle></CardHeader>
          <CardContent>
            {givingQ.isLoading ? <LoadingBlock /> : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <StatCard label="Total given" value={fmtMoney(givingQ.data?.totalCents ?? 0)} icon={Scale} tone="positive" />
                  <StatCard label="Gifts" value={givingQ.data?.giftCount ?? 0} icon={FileSpreadsheet} />
                </div>
                <ul className="divide-y rounded-lg border text-sm">
                  {(givingQ.data?.items ?? []).map((g, i) => (
                    <li key={i} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 capitalize">{g.type}</span>
                      <span className="text-xs text-muted-foreground">{g.count} gifts</span>
                      <span className="font-medium tabular-nums">{fmtMoney(g.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {report === "receipts_payments" ? (
        <Card>
          <CardHeader><CardTitle>Receipts &amp; Payments Account</CardTitle></CardHeader>
          <CardContent>
            {receiptsPaymentsQ.isLoading ? <LoadingBlock /> : receiptsPaymentsQ.isError ? <ErrorBlock error={receiptsPaymentsQ.error} /> : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Cash-basis summary — Opening Cash/Bank + Receipts − Payments = Closing. The #1 report Nigerian church boards and AGM members request.</p>
                <div className="grid gap-4 sm:grid-cols-4">
                  <StatCard label="Opening balance" value={fmtMoney(receiptsPaymentsQ.data?.openingBalanceCents ?? 0)} icon={Wallet} />
                  <StatCard label="Total receipts" value={fmtMoney(receiptsPaymentsQ.data?.totalReceiptsCents ?? 0)} icon={HeartHandshake} tone="positive" />
                  <StatCard label="Total payments" value={fmtMoney(receiptsPaymentsQ.data?.totalPaymentsCents ?? 0)} icon={Briefcase} tone="warning" />
                  <StatCard label="Closing balance" value={fmtMoney(receiptsPaymentsQ.data?.closingBalanceCents ?? 0)} icon={CheckCircle2} tone={(receiptsPaymentsQ.data?.closingBalanceCents ?? 0) >= 0 ? "positive" : "negative"} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Receipts</h4>
                    <ul className="divide-y rounded-lg border text-sm">
                      {(receiptsPaymentsQ.data?.receipts ?? []).map((r, i) => (
                        <li key={i} className="flex justify-between px-3 py-1.5"><span>{r.category}</span><span className="tabular-nums">{fmtMoney(r.amountCents)}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Payments</h4>
                    <ul className="divide-y rounded-lg border text-sm">
                      {(receiptsPaymentsQ.data?.payments ?? []).map((p, i) => (
                        <li key={i} className="flex justify-between px-3 py-1.5"><span>{p.category}</span><span className="tabular-nums">{fmtMoney(p.amountCents)}</span></li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {report === "remittances" ? (
        <Card>
          <CardHeader><CardTitle>National / HQ Remittance Report</CardTitle></CardHeader>
          <CardContent>
            {remittancesQ.isLoading ? <LoadingBlock /> : remittancesQ.isError ? <ErrorBlock error={remittancesQ.error} /> : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Period breakdown of gross income by fund, statutory % accrued, amount paid, and outstanding balance per HQ tier.</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <StatCard label="Total accrued" value={fmtMoney(remittancesQ.data?.totalAccruedCents ?? 0)} icon={Send} />
                  <StatCard label="Total paid" value={fmtMoney(remittancesQ.data?.totalPaidCents ?? 0)} icon={CheckCircle2} tone="positive" />
                  <StatCard label="Outstanding" value={fmtMoney(remittancesQ.data?.totalOutstandingCents ?? 0)} icon={Landmark} tone="warning" />
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Destination</TableHead><TableHead>Tier</TableHead><TableHead className="text-right">Gross base</TableHead><TableHead className="text-right">Accrued</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(remittancesQ.data?.destinations ?? []).map((d, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">{d.tier}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(d.grossBaseCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(d.accruedCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(d.paidCents)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{fmtMoney(d.outstandingCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {report === "trial_balance" ? (
        <Card>
          <CardHeader><CardTitle>Trial Balance</CardTitle></CardHeader>
          <CardContent>
            {trialBalanceQ.isLoading ? <LoadingBlock /> : trialBalanceQ.isError ? <ErrorBlock error={trialBalanceQ.error} /> : (
              <div className="space-y-4">
                {trialBalanceQ.data?.checkCents ? (
                  <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">Debits ≠ Credits — off by {fmtMoney(trialBalanceQ.data.checkCents)}. Check for unbalanced entries.</p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-teal-700"><CheckCircle2 className="h-3.5 w-3.5" /> Total Debits = Total Credits ✓</p>
                )}
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(trialBalanceQ.data?.items ?? []).map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{t.code}</TableCell>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">{t.type}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.debitCents ? fmtMoney(t.debitCents) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.creditCents ? fmtMoney(t.creditCents) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between border-t pt-2 text-sm font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">Dr {fmtMoney(trialBalanceQ.data?.totalDebitsCents ?? 0)} · Cr {fmtMoney(trialBalanceQ.data?.totalCreditsCents ?? 0)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/* ═════════════════════ MANUAL JOURNAL + ACCOUNT LEDGER (enterprise) ═══════════ */

function ManualJournalDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const accountsQ = useApiQuery<{ items: AccountDTO[] }>(["accounts"], "/accounts");
  const accounts = accountsQ.data?.items ?? [];
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<{ accountId: string; debit: string; credit: string }[]>([
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const debitTotal = lines.reduce((a, l) => a + (Math.round(Number(l.debit) * 100) || 0), 0);
  const creditTotal = lines.reduce((a, l) => a + (Math.round(Number(l.credit) * 100) || 0), 0);
  const balanced = debitTotal > 0 && debitTotal === creditTotal && lines.every((l) => l.accountId);

  async function save() {
    if (!balanced) { toast.error("Debits must equal credits and every line needs an account."); return; }
    setBusy(true);
    try {
      await api.post("/journal-entries/manual", {
        entryDate, memo: memo.trim() || undefined,
        lines: lines.map((l) => ({ accountId: l.accountId, debitCents: Math.round(Number(l.debit) * 100) || 0, creditCents: Math.round(Number(l.credit) * 100) || 0 })),
      });
      toast.success("Manual journal entry posted.");
      void qc.invalidateQueries({ queryKey: ["journal-entries"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    } catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Manual Journal Entry</DialogTitle>
          <DialogDescription>Multi-line Debit/Credit builder. The server enforces Σ debits = Σ credits to the kobo — an unbalanced entry never hits the book. Corrections are reversing entries, never edits.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="je-date">Date</Label><Input id="je-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="je-memo">Memo</Label><Input id="je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Reclassify generator fuel to 6100" /></div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_7rem_7rem_auto] gap-2 text-xs font-semibold text-muted-foreground px-1">
            <span>Account</span><span className="text-right">Debit (₦)</span><span className="text-right">Credit (₦)</span><span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_7rem_auto] gap-2 items-center">
              <Select value={l.accountId} onValueChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, accountId: v } : x))}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent className="max-h-72">{accounts.map((a) => <SelectItem key={a.id} value={a.id}><span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>{a.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input inputMode="decimal" value={l.debit} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, debit: e.target.value.replace(/[^0-9.]/g, ""), credit: "" } : x))} placeholder="0.00" />
              <Input inputMode="decimal" value={l.credit} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, credit: e.target.value.replace(/[^0-9.]/g, ""), debit: "" } : x))} placeholder="0.00" />
              <Button variant="ghost" size="icon" disabled={lines.length === 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, { accountId: "", debit: "", credit: "" }])}><Plus className="h-3.5 w-3.5 mr-1" />Add line</Button>
        </div>
        <div className={`rounded-md px-3 py-2 text-sm ${balanced ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"}`}>
          Debits {fmtMoney(debitTotal)} · Credits {fmtMoney(creditTotal)} {balanced ? "✓ Balanced" : `— off by ${fmtMoney(Math.abs(debitTotal - creditTotal))}`}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !balanced} onClick={() => void save()}>{busy ? "Saving…" : "Post entry"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountLedgerDrawer({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const q = useApiQuery<{
    account: { id: string; code: string; name: string; type: string };
    lines: { id: string; entryId: string; entryDate: string; memo: string | null; sourceType: string; debitCents: number; creditCents: number; fundId: string | null; balanceCents: number }[];
    endingBalanceCents: number;
  }>(["account-ledger", accountId], `/accounts/${accountId}/ledger`);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col">
        <SheetHeader>
          <SheetTitle>{q.data ? `${q.data.account.code} · ${q.data.account.name}` : "Account ledger"}</SheetTitle>
        </SheetHeader>
        {q.isLoading ? <LoadingBlock label="Loading ledger…" /> : q.isError ? <ErrorBlock error={q.error} /> : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-4 py-2 border-b flex justify-between text-sm">
              <span className="text-muted-foreground">Running balance (capitalised on natural side)</span>
              <span className="font-semibold tabular-nums">{fmtMoney(q.data?.endingBalanceCents ?? 0)}</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="px-4 py-2">
                {(q.data?.lines ?? []).length === 0 ? <EmptyState icon={BookOpenCheck} title="No movement yet" description="No journal lines have touched this account." /> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Memo</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(q.data?.lines ?? []).map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="text-xs">{fmtDate(l.entryDate)}</TableCell>
                          <TableCell className="max-w-[12rem] truncate text-xs">{l.memo ?? "—"}</TableCell>
                          <TableCell><StatusBadge status={l.sourceType} /></TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{l.debitCents ? fmtMoney(l.debitCents) : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{l.creditCents ? fmtMoney(l.creditCents) : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmtMoney(l.balanceCents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
