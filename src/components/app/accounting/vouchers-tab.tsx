"use client";
/**
 * Expenses, Vouchers & Bills tab — the full church outflow surface.
 * Sub-tabs: 1) Payment Vouchers (request → approve → confirm → pay)  2) Bills & Vendors (AP)
 *           3) Petty Cash / Imprest  4) Stipends, Payroll & Honoraria
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, FileText, Wallet, Landmark, ClipboardList, CheckCircle2, Undo2, Ban, Coins, RefreshCw, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fmtMoney, fmtDate, type SessionUser } from "@/lib/types";
import { canDo } from "@/lib/types";
import { Section, EmptyState, LoadingBlock, ErrorBlock, useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  KpiRow, StatusPill, MoneyField, MoneyInput,
  AccountSelect, FundSelect, BankAccountSelect,
  NGN_METHOD_LABELS, PV_STATUS_LABELS, PV_METHODS, DEPARTMENTS, bpsToPct, pctToBps,
} from "./accounting-shared";
import { BillsVendorsTab } from "./AccountingModule";

type SubTab = "vouchers" | "bills" | "petty" | "stipends";

const SUB_TABS: { id: SubTab; label: string; icon: any }[] = [
  { id: "vouchers", label: "Payment Vouchers", icon: FileText },
  { id: "bills", label: "Bills & Vendors (AP)", icon: ClipboardList },
  { id: "petty", label: "Petty Cash / Imprest", icon: Wallet },
  { id: "stipends", label: "Stipends, Payroll & Honoraria", icon: Landmark },
];

export function VouchersTab({ user }: { user: SessionUser }) {
  const [sub, setSub] = useState<SubTab>("vouchers");
  const canManage = canDo(user, "accounting.manage");
  const canRequest = canDo(user, "accounting.vouchers.request") || canManage;
  const canApprove = canDo(user, "accounting.vouchers.approve") || canManage;
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
      {sub === "vouchers" && <PaymentVouchers user={user} canRequest={canRequest} canApprove={canApprove} canManage={canManage} />}
      {sub === "bills" && <BillsVendorsTab canManage={canManage} />}
      {sub === "petty" && <PettyCash canManage={canManage} />}
      {sub === "stipends" && <Stipends canManage={canManage} />}
    </div>
  );
}

// ── 1. Payment Vouchers ───────────────────────────────────────────────────────

function PaymentVouchers({ user, canRequest, canApprove, canManage }: { user: SessionUser; canRequest: boolean; canApprove: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { data, isLoading, error } = useApiQuery<{ items: any[] }>(["payment-vouchers", statusFilter], statusFilter ? `/payment-vouchers?status=${statusFilter}` : "/payment-vouchers");
  const [createOpen, setCreateOpen] = useState(false);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [paying, setPaying] = useState<any | null>(null);

  // create form state
  const [department, setDepartment] = useState<string>("Pastoral");
  const [payeeName, setPayeeName] = useState("");
  const [payeeBankName, setPayeeBankName] = useState("");
  const [payeeAccountNumber, setPayeeAccountNumber] = useState("");
  const [purpose, setPurpose] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState<string | undefined>();
  const [fundId, setFundId] = useState<string | undefined>();
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [whtPct, setWhtPct] = useState<string>("");
  const whtBps = pctToBps(whtPct);
  const whtCents = amountCents ? Math.round((amountCents * whtBps) / 10000) : 0;
  const netCents = (amountCents ?? 0) - whtCents;

  // pay form state
  const [payBankId, setPayBankId] = useState<string | undefined>();
  const [payMethod, setPayMethod] = useState<string>("bank_transfer");
  const [payRef, setPayRef] = useState("");

  const refresh = () => { qc.invalidateQueries({ queryKey: ["payment-vouchers"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["journal-entries"] }); };

  async function submitCreate() {
    if (!payeeName.trim()) { toast.error("Payee name is required."); return; }
    if (!amountCents || amountCents <= 0) { toast.error("Enter a valid amount."); return; }
    if (!expenseAccountId) { toast.error("Select an expense account."); return; }
    try {
      await api.post("/payment-vouchers", { department, payeeName, payeeBankName, payeeAccountNumber, purpose, expenseAccountId, fundId, amountCents, whtRateBps: whtBps });
      toast.success("Payment voucher raised — awaiting approval.");
      setCreateOpen(false); setPayeeName(""); setPayeeBankName(""); setPayeeAccountNumber(""); setPurpose(""); setAmountCents(null); setWhtPct(""); setExpenseAccountId(undefined); setFundId(undefined);
      refresh();
    } catch (e) { toast.error((e as ApiError).message || "Failed to raise voucher."); }
  }
  async function approve(id: string) {
    try { await api.post(`/payment-vouchers/${id}/approve`, {}); toast.success("Voucher approved — awaiting accountant confirmation."); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to approve."); }
  }
  async function doConfirm(id: string) {
    try { await api.post(`/payment-vouchers/${id}/confirm`, {}); toast.success("Voucher confirmed — ready for disbursement."); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to confirm voucher."); }
  }
  async function doReject() {
    if (!rejecting || !rejectNote.trim()) return;
    try { await api.post(`/payment-vouchers/${rejecting.id}/reject`, { note: rejectNote.trim() }); toast.success("Voucher rejected."); setRejecting(null); setRejectNote(""); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to reject."); }
  }
  async function doPay() {
    if (!paying) return;
    try { await api.post(`/payment-vouchers/${paying.id}/pay`, { bankAccountId: payBankId, paymentMethod: payMethod, paymentRef: payRef }); toast.success("Voucher disbursed & posted to the GL."); setPaying(null); setPayRef(""); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to disburse."); }
  }
  async function doVoid(id: string) {
    try { await api.post(`/payment-vouchers/${id}/void`, {}); toast.success("Voucher voided."); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to void."); }
  }

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} />;
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <KpiRow items={[
        { label: "Pending Approval", value: String(items.filter((v) => v.status === "pending_approval").length), tone: "warning" },
        { label: "Approved — awaiting confirm", value: String(items.filter((v) => v.status === "approved").length) },
        { label: "Confirmed — ready to pay", value: String(items.filter((v) => v.status === "confirmed").length), tone: "violet" },
        { label: "Paid (this view)", value: String(items.filter((v) => v.status === "paid").length), tone: "positive" },
        { label: "Rejected", value: String(items.filter((v) => v.status === "rejected").length), tone: "negative" },
        { label: "Void", value: String(items.filter((v) => v.status === "void").length) },
      ]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Filter</Label>
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(PV_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {canRequest && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Raise Payment Voucher</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Raise Payment Voucher (Requisition)</DialogTitle><DialogDescription>Request a church expense. A Senior Pastor / Treasurer approves, the Accountant confirms, then disburses — the GL entry posts automatically on payment.</DialogDescription></DialogHeader>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5"><Label>Department</Label><Select value={department} onValueChange={setDepartment}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-1.5"><Label htmlFor="pv-payee">Payee name</Label><Input id="pv-payee" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="e.g. Chigozie Sound Systems" /></div>
                <div className="grid gap-1.5"><Label htmlFor="pv-bank">Payee bank name</Label><Input id="pv-bank" value={payeeBankName} onChange={(e) => setPayeeBankName(e.target.value)} placeholder="e.g. Guaranty Trust Bank" /></div>
                <div className="grid gap-1.5"><Label htmlFor="pv-nuban">Payee NUBAN (10 digits)</Label><Input id="pv-nuban" inputMode="numeric" maxLength={10} value={payeeAccountNumber} onChange={(e) => setPayeeAccountNumber(e.target.value.replace(/\D/g, ""))} placeholder="0123456789" /></div>
              </div>
              <div className="grid gap-1.5"><Label htmlFor="pv-purpose">Purpose</Label><Textarea id="pv-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="e.g. Sound equipment repair — 2 cordless mics + mixer servicing" /></div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5"><Label>Expense GL account</Label><AccountSelect value={expenseAccountId} onValueChange={setExpenseAccountId} typeFilter="expense" placeholder="5110 Ministry & Worship" /></div>
                <div className="grid gap-1.5"><Label>Fund (optional)</Label><FundSelect value={fundId} onValueChange={setFundId} placeholder="Unrestricted" /></div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <MoneyField label="Amount" value={amountCents} onChange={setAmountCents} id="pv-amount" />
                <div className="grid gap-1.5"><Label htmlFor="pv-wht">WHT % (optional)</Label><Input id="pv-wht" inputMode="decimal" value={whtPct} onChange={(e) => setWhtPct(e.target.value)} placeholder="e.g. 7.5" /></div>
                <div className="text-xs text-muted-foreground pb-2">WHT: <span className="font-mono">{fmtMoney(whtCents)}</span> · Net: <span className="font-mono">{fmtMoney(netCents)}</span></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={submitCreate}>Submit for approval</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Section title="Payment Vouchers" icon={FileText}>
        {items.length === 0 ? <EmptyState icon={FileText} title="No payment vouchers" description="Raise a voucher for any church expense — it routes to your approver, then to the accountant for confirmation and disbursement." /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Voucher #</TableHead><TableHead>Payee</TableHead><TableHead>Purpose</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">WHT</TableHead><TableHead className="text-right">Net</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-xs">{v.voucherNumber}</TableCell>
                <TableCell className="font-medium">{v.payeeName}<div className="text-xs text-muted-foreground">{v.payeeBankName ? `${v.payeeBankName} ••${v.payeeAccountNumber?.slice(-4) ?? ""}` : v.department ?? "—"}</div></TableCell>
                <TableCell className="max-w-[16rem] truncate text-xs">{v.purpose ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(v.amountCents)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{v.whtCents ? fmtMoney(v.whtCents) : "—"}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(v.netCents)}</TableCell>
                <TableCell><StatusPill status={v.status} map={PV_STATUS_LABELS} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5">
                    {canApprove && v.status === "pending_approval" && <>
                      <Button size="sm" onClick={() => approve(v.id)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => { setRejecting(v); setRejectNote(""); }}><Undo2 className="h-3.5 w-3.5" /></Button>
                    </>}
                    {canManage && v.status === "approved" && <Button size="sm" variant="outline" onClick={() => doConfirm(v.id)}><ShieldCheck className="h-3.5 w-3.5 mr-1" />Confirm</Button>}
                    {canManage && v.status === "confirmed" && <Button size="sm" onClick={() => { setPaying(v); setPayBankId(undefined); setPayMethod("bank_transfer"); setPayRef(""); }}>Disburse</Button>}
                    {canApprove && (v.status === "pending_approval") && <Button size="sm" variant="ghost" onClick={() => doVoid(v.id)} title="Void"><Ban className="h-3.5 w-3.5" /></Button>}
                    {v.status === "paid" && v.journalEntryId && <Badge variant="outline" className="text-xs">Posted</Badge>}
                  </div>
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></div>
        )}
      </Section>

      {/* Reject dialog */}
      <AlertDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Reject voucher {rejecting?.voucherNumber}</AlertDialogTitle><AlertDialogDescription>The voucher is returned to the requester with a note.</AlertDialogDescription></AlertDialogHeader>
          <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. Attach the vendor invoice before this can be approved." rows={3} />
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doReject}>Reject</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pay dialog */}
      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Disburse {paying?.voucherNumber}</DialogTitle><DialogDescription>Accountant-confirmed voucher. Disbursing posts the settlement GL entry: Dr Expense / Cr Bank{paying?.whtCents ? " / Cr WHT Payable (2160)" : ""}.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>Bank account</Label><BankAccountSelect value={payBankId} onValueChange={setPayBankId} /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Method</Label><Select value={payMethod} onValueChange={setPayMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PV_METHODS.map((m) => <SelectItem key={m} value={m}>{NGN_METHOD_LABELS[m] ?? m}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="pay-ref">Payment ref (NIBSS / teller)</Label><Input id="pay-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} /></div>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">Gross <span className="font-mono">{fmtMoney(paying?.amountCents ?? 0)}</span> · WHT <span className="font-mono">{fmtMoney(paying?.whtCents ?? 0)}</span> · Net payable <span className="font-mono font-semibold">{fmtMoney(paying?.netCents ?? 0)}</span></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button><Button onClick={doPay}>Disburse & Post to GL</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 3. Petty Cash / Imprest ───────────────────────────────────────────────────

function PettyCash({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data: status, isLoading: sl, error: se } = useApiQuery<{ accountId: string; balanceCents: number }>(["petty-cash-status"], "/petty-cash");
  const { data: disb, isLoading: dl, error: de } = useApiQuery<{ items: any[] }>(["petty-cash-disbursements"], "/petty-cash/disbursements");
  const [disbOpen, setDisbOpen] = useState(false);
  const [repOpen, setRepOpen] = useState(false);
  const [voucherRef, setVoucherRef] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState<string | undefined>();
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [repAmount, setRepAmount] = useState<number | null>(null);
  const [repBankId, setRepBankId] = useState<string | undefined>();

  const refresh = () => { qc.invalidateQueries({ queryKey: ["petty-cash-status"] }); qc.invalidateQueries({ queryKey: ["petty-cash-disbursements"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); };

  async function submitDisb() {
    if (!payeeName.trim() || !amountCents || amountCents <= 0 || !expenseAccountId) { toast.error("Payee, expense account and amount are required."); return; }
    try { await api.post("/petty-cash/disburse", { voucherRef, payeeName, purpose, expenseAccountId, amountCents }); toast.success("Petty cash disbursed — Dr Expense / Cr Petty Cash."); setDisbOpen(false); setVoucherRef(""); setPayeeName(""); setPurpose(""); setAmountCents(null); setExpenseAccountId(undefined); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to disburse."); }
  }
  async function submitRep() {
    if (!repAmount || repAmount <= 0) { toast.error("Enter a valid amount."); return; }
    try { await api.post("/petty-cash/replenish", { amountCents: repAmount, fromBankAccountId: repBankId }); toast.success("Float replenished — Dr Petty Cash / Cr Bank."); setRepOpen(false); setRepAmount(null); setRepBankId(undefined); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to replenish."); }
  }

  if (sl || dl) return <LoadingBlock />;
  if (se || de) return <ErrorBlock error={se ?? de} />;

  return (
    <div className="space-y-4">
      <KpiRow items={[{ label: "Petty Cash Float Balance", value: fmtMoney(status?.balanceCents ?? 0), tone: status && status.balanceCents < 5000 ? "warning" : "default" }]} />
      <div className="flex justify-end gap-2">{canManage && <>
        <Dialog open={disbOpen} onOpenChange={setDisbOpen}>
          <DialogTrigger asChild><Button variant="outline"><Coins className="h-4 w-4 mr-1" />Disburse</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Petty Cash Disbursement</DialogTitle><DialogDescription>Log a small cash expense against an expense account. Posts Dr Expense / Cr 1025 Petty Cash Float.</DialogDescription></DialogHeader>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="pv-ref">Voucher ref</Label><Input id="pv-ref" value={voucherRef} onChange={(e) => setVoucherRef(e.target.value)} placeholder="PV-2026-0001 or free ref" /></div>
              <div className="grid gap-1.5"><Label htmlFor="pc-payee">Payee</Label><Input id="pc-payee" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="pc-purpose">Purpose</Label><Input id="pc-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Fuel for generator" /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Expense account</Label><AccountSelect value={expenseAccountId} onValueChange={setExpenseAccountId} typeFilter="expense" placeholder="6100 Generator Fuel" /></div>
              <MoneyField label="Amount" value={amountCents} onChange={setAmountCents} />
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setDisbOpen(false)}>Cancel</Button><Button onClick={submitDisb}>Disburse</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={repOpen} onOpenChange={setRepOpen}>
          <DialogTrigger asChild><Button><RefreshCw className="h-4 w-4 mr-1" />Replenish Float</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Replenish Petty Cash Float</DialogTitle><DialogDescription>Top up the petty cash float from the Operating Bank. Posts Dr 1025 Petty Cash / Cr 1010 Bank.</DialogDescription></DialogHeader>
            <MoneyField label="Replenish amount" value={repAmount} onChange={setRepAmount} />
            <div className="grid gap-1.5"><Label>From bank account</Label><BankAccountSelect value={repBankId} onValueChange={setRepBankId} placeholder="Operating Bank (default)" /></div>
            <DialogFooter><Button variant="outline" onClick={() => setRepOpen(false)}>Cancel</Button><Button onClick={submitRep}>Replenish</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </>}</div>
      <Section title="Petty Cash Disbursements" icon={Wallet}>
        {disb?.items?.length ? (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Voucher</TableHead><TableHead>Payee</TableHead><TableHead>Purpose</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{disb.items.map((d) => (
              <TableRow key={d.id}><TableCell>{fmtDate(d.disbursedOn)}</TableCell><TableCell className="font-mono text-xs">{d.voucherRef ?? "—"}</TableCell><TableCell className="font-medium">{d.payeeName}</TableCell><TableCell className="text-xs">{d.purpose ?? "—"}</TableCell><TableCell className="text-right font-mono">{fmtMoney(d.amountCents)}</TableCell></TableRow>
            ))}</TableBody>
          </Table></div>
        ) : <EmptyState icon={Wallet} title="No petty cash disbursements" description="Small cash expenses (fuel, stationery, minor repairs) log here against the 1025 Petty Cash Float." />}
      </Section>
    </div>
  );
}

// ── 4. Stipends, Payroll & Honoraria ──────────────────────────────────────────

function Stipends({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useApiQuery<{ items: any[] }>(["stipend-batches"], "/stipend-batches");
  const [open, setOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(new Date().toISOString().slice(0, 7));
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<{ payeeName: string; roleLabel: string; grossCents: number | null; payeCents: number | null; pensionCents: number | null }[]>([{ payeeName: "", roleLabel: "", grossCents: null, payeCents: null, pensionCents: null }]);

  const grossTotal = lines.reduce((a, l) => a + (l.grossCents ?? 0), 0);
  const dedTotal = lines.reduce((a, l) => a + (l.payeCents ?? 0) + (l.pensionCents ?? 0), 0);
  const netTotal = grossTotal - dedTotal;

  const refresh = () => { qc.invalidateQueries({ queryKey: ["stipend-batches"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["journal-entries"] }); };

  async function submit() {
    if (!lines.length || lines.some((l) => !l.payeeName.trim() || !l.grossCents || l.grossCents <= 0)) { toast.error("Every line needs a payee and a positive gross."); return; }
    try {
      await api.post("/stipend-batches", { periodMonth, description, lines: lines.map((l) => ({ payeeName: l.payeeName, roleLabel: l.roleLabel, grossCents: l.grossCents, payeCents: l.payeCents, pensionCents: l.pensionCents })) });
      toast.success("Stipend batch created as draft.");
      setOpen(false); setLines([{ payeeName: "", roleLabel: "", grossCents: null, payeCents: null, pensionCents: null }]); setDescription("");
      refresh();
    } catch (e) { toast.error((e as ApiError).message || "Failed to create batch."); }
  }
  async function postBatch(id: string) {
    try { await api.post(`/stipend-batches/${id}/post`, {}); toast.success("Stipend batch posted to the GL."); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to post batch."); }
  }

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} />;
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />New Stipend Batch</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Stipends, Payroll & Honoraria</DialogTitle><DialogDescription>Record monthly pastoral/staff stipends or visiting minister honoraria in one batch. Posts Dr 5400 Stipends / Cr Bank (+ Cr 2160 PAYE Payable if deductions).</DialogDescription></DialogHeader>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="sb-month">Period (YYYY-MM)</Label><Input id="sb-month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} placeholder="2026-06" /></div>
              <div className="grid gap-1.5"><Label htmlFor="sb-desc">Description</Label><Input id="sb-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="June pastoral stipends" /></div>
            </div>
            <div className="space-y-2">
              <Label>Payees</Label>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1.2fr_1fr_auto_auto_auto_auto] gap-2 items-end">
                  <Input placeholder="Payee name" value={l.payeeName} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, payeeName: e.target.value } : x))} />
                  <Input placeholder="Role (e.g. Senior Pastor)" value={l.roleLabel} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, roleLabel: e.target.value } : x))} />
                  <div className="w-28"><MoneyInput value={l.grossCents} onChange={(c) => setLines(lines.map((x, j) => j === i ? { ...x, grossCents: c } : x))} placeholder="Gross" /></div>
                  <div className="w-24"><MoneyInput value={l.payeCents} onChange={(c) => setLines(lines.map((x, j) => j === i ? { ...x, payeCents: c } : x))} placeholder="PAYE" /></div>
                  <div className="w-24"><MoneyInput value={l.pensionCents} onChange={(c) => setLines(lines.map((x, j) => j === i ? { ...x, pensionCents: c } : x))} placeholder="Pension" /></div>
                  <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setLines([...lines, { payeeName: "", roleLabel: "", grossCents: null, payeCents: null, pensionCents: null }])}><Plus className="h-3.5 w-3.5 mr-1" />Add payee</Button>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm flex gap-6"><span>Gross <span className="font-mono font-semibold">{fmtMoney(grossTotal)}</span></span><span>Deductions <span className="font-mono">{fmtMoney(dedTotal)}</span></span><span>Net payable <span className="font-mono font-semibold">{fmtMoney(netTotal)}</span></span></div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit}>Create draft batch</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}</div>
      <Section title="Stipend Batches" icon={Landmark}>
        {items.length === 0 ? <EmptyState icon={Landmark} title="No stipend batches" description="Record monthly pastoral/staff stipends or visiting minister honoraria here, then post the batch to the GL in one click." /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Description</TableHead><TableHead>Lines</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Net</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.periodMonth}</TableCell>
                <TableCell className="font-medium">{b.description ?? "—"}</TableCell>
                <TableCell className="text-xs">{b.lineCount ?? 0}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(b.grossCents)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{b.deductionsCents ? fmtMoney(b.deductionsCents) : "—"}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(b.netCents)}</TableCell>
                <TableCell><Badge variant={b.status === "posted" ? "default" : "outline"}>{b.status}</Badge></TableCell>
                <TableCell className="text-right">{canManage && b.status === "draft" && <Button size="sm" onClick={() => postBatch(b.id)}>Post to GL</Button>}{b.status === "posted" && b.journalEntryId && <Badge variant="outline" className="text-xs">Posted</Badge>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></div>
        )}
      </Section>
    </div>
  );
}
