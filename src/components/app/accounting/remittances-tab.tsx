"use client";
/**
 * Remittances tab — statutory church remittances to Area / Province / National HQ.
 * Sub-tabs: 1) Monthly Remittance Schedule  2) Remittance Rules & HQ Accounts
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Send, Landmark, Settings2, Calculator, CheckCircle2, CreditCard } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  KpiRow, StatusPill, MoneyField,
  AccountSelect, FundSelect, BankAccountSelect,
  NGN_METHOD_LABELS, REMITTANCE_TIERS, bpsToPct, pctToBps,
} from "./accounting-shared";

type SubTab = "schedule" | "rules";
const SUB_TABS: { id: SubTab; label: string; icon: any }[] = [
  { id: "schedule", label: "Monthly Remittance Schedule", icon: Send },
  { id: "rules", label: "Remittance Rules & HQ Accounts", icon: Settings2 },
];

export function RemittancesTab({ user }: { user: SessionUser }) {
  const [sub, setSub] = useState<SubTab>("schedule");
  const canManage = canDo(user, "accounting.manage");
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
      {sub === "schedule" && <MonthlySchedule canManage={canManage} />}
      {sub === "rules" && <RulesAndAccounts canManage={canManage} />}
    </div>
  );
}

// ── 1. Monthly Remittance Schedule ────────────────────────────────────────────

const SCHED_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-muted text-muted-foreground" },
  approved: { label: "Approved", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  part_paid: { label: "Part-paid", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  paid: { label: "Paid", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
};

function MonthlySchedule({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, isLoading, error } = useApiQuery<{ month: string; items: any[] }>(["remittance-schedule", month], `/remittance-schedule?month=${month}`);
  const [paying, setPaying] = useState<any | null>(null);
  const [payBankId, setPayBankId] = useState<string | undefined>();
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [payRef, setPayRef] = useState("");

  const refresh = () => { qc.invalidateQueries({ queryKey: ["remittance-schedule"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["journal-entries"] }); };

  async function compute() {
    try { await api.post("/remittance-schedule/compute", { periodMonth: month }); toast.success(`Schedule computed for ${month}.`); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to compute schedule."); }
  }
  async function approve() {
    try { const r = await api.post("/remittance-schedule/approve", { periodMonth: month }); toast.success(`Approved — accrual posted for ${r.posted} destination(s).`); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to approve."); }
  }
  async function doPay() {
    if (!paying) return;
    try { await api.post(`/remittance-schedule/${paying.id}/payment`, { bankAccountId: payBankId, amountCents: payAmount, paymentMethod: payMethod, paymentRef }); toast.success("Remittance payment posted — Dr Remittance Payable / Cr Bank."); setPaying(null); setPayRef(""); setPayAmount(null); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to record payment."); }
  }

  const items = data?.items ?? [];
  const totalDue = items.reduce((a, s) => a + s.balanceCents, 0);
  const totalPaid = items.reduce((a, s) => a + s.paidCents, 0);
  const hasDraft = items.some((s) => s.status === "draft");

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={(error as ApiError).message} />;

  return (
    <div className="space-y-4">
      <KpiRow items={[
        { label: "Total Unpaid Remittance", value: fmtMoney(totalDue), tone: "amber" },
        { label: "Paid (this month)", value: fmtMoney(totalPaid) },
        { label: "Destinations", value: String(items.length) },
        { label: "Month", value: month },
      ]} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5"><Label htmlFor="rm-month">Month</Label><Input id="rm-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" /></div>
        <Button variant="outline" onClick={compute}><Calculator className="h-4 w-4 mr-1" />Compute / Refresh</Button>
        {canManage && hasDraft && <Button onClick={approve}><CheckCircle2 className="h-4 w-4 mr-1" />Approve Schedule (post accrual)</Button>}
      </div>
      <Section title="Remittance Schedule" icon={Send}>
        {items.length === 0 ? <EmptyState icon={Send} title="No schedule for this month" description="Pick the month and click Compute to sum posted giving by fund and apply the active remittance rules." /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Destination</TableHead><TableHead>Tier</TableHead><TableHead>Bank</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Due</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.destinationName ?? s.destinationId}</TableCell>
                <TableCell className="text-xs">{s.tier ? REMITTANCE_TIERS[s.tier] ?? s.tier : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.bankName ? `${s.bankName} ••${(s.accountNumberNuban ?? "").slice(-4)}` : "—"}</TableCell>
                <TableCell className="text-right font-mono text-xs">{fmtMoney(s.grossBaseCents)}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(s.netDueCents)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{fmtMoney(s.paidCents)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{fmtMoney(s.balanceCents)}</TableCell>
                <TableCell><StatusPill status={s.status} map={SCHED_STATUS} /></TableCell>
                <TableCell className="text-right">{canManage && s.balanceCents > 0 && (s.status === "approved" || s.status === "part_paid") && <Button size="sm" variant="outline" onClick={() => { setPaying(s); setPayBankId(undefined); setPayAmount(s.balanceCents); setPayMethod("bank_transfer"); setPayRef(""); }}><CreditCard className="h-3.5 w-3.5 mr-1" />Pay</Button>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></div>
        )}
      </Section>
      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Remittance Payment</DialogTitle><DialogDescription>Settle the HQ payable. Posts Dr 2150 Remittance Payable / Cr 1010 Operating Bank.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>Bank account</Label><BankAccountSelect value={payBankId} onValueChange={setPayBankId} /></div>
            <MoneyField label="Payment amount" value={payAmount} onChange={setPayAmount} />
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Method</Label><Select value={payMethod} onValueChange={setPayMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["bank_transfer", "cheque"].map((m) => <SelectItem key={m} value={m}>{NGN_METHOD_LABELS[m] ?? m}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="rm-ref">NIBSS session / teller ref</Label><Input id="rm-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button><Button onClick={doPay}>Record Payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 2. Remittance Rules & HQ Accounts ────────────────────────────────────────

function RulesAndAccounts({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data: destData, isLoading: dl, error: de } = useApiQuery<{ items: any[] }>(["remittance-destinations"], "/remittance-destinations");
  const { data: ruleData, isLoading: rl, error: re } = useApiQuery<{ items: any[] }>(["remittance-rules"], "/remittance-rules");

  const [destOpen, setDestOpen] = useState(false);
  const [dest, setDest] = useState({ name: "", tier: "national", bankName: "", accountNumberNuban: "", accountName: "", liabilityAccountId: undefined as string | undefined, expenseAccountId: undefined as string | undefined });
  const [ruleOpen, setRuleOpen] = useState(false);
  const [rule, setRule] = useState({ name: "", destinationId: undefined as string | undefined, sourceType: "fund_percentage", fundId: undefined as string | undefined, percentageBps: "", fixedAmountCents: null as number | null, accrueOnPosting: false, isActive: true });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["remittance-destinations"] }); qc.invalidateQueries({ queryKey: ["remittance-rules"] }); };

  async function submitDest() {
    if (!dest.name.trim()) { toast.error("Destination name is required."); return; }
    try { await api.post("/remittance-destinations", dest); toast.success("HQ destination added."); setDestOpen(false); setDest({ name: "", tier: "national", bankName: "", accountNumberNuban: "", accountName: "", liabilityAccountId: undefined, expenseAccountId: undefined }); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to add destination."); }
  }
  async function submitRule() {
    if (!rule.name.trim() || !rule.destinationId) { toast.error("Rule name and destination are required."); return; }
    const bps = pctToBps(rule.percentageBps);
    try { await api.post("/remittance-rules", { ...rule, percentageBps: bps }); toast.success("Remittance rule added."); setRuleOpen(false); setRule({ name: "", destinationId: undefined, sourceType: "fund_percentage", fundId: undefined, percentageBps: "", fixedAmountCents: null, accrueOnPosting: false, isActive: true }); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to add rule."); }
  }
  async function toggleRule(r: any, active: boolean) {
    try { await api.patch(`/remittance-rules/${r.id}`, { isActive: active }); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to toggle rule."); }
  }

  if (dl || rl) return <LoadingBlock />;
  if (de || re) return <ErrorBlock message={(de || re || {} as any).message} />;
  const dests = destData?.items ?? [];
  const rules = ruleData?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Landmark className="h-4 w-4" />HQ / Diocesan Destinations</h3>
          {canManage && (
            <Dialog open={destOpen} onOpenChange={setDestOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add destination</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Remittance Destination</DialogTitle><DialogDescription>The Area, Province, Diocese or National Headquarters you remit to.</DialogDescription></DialogHeader>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5"><Label htmlFor="d-name">Name</Label><Input id="d-name" value={dest.name} onChange={(e) => setDest({ ...dest, name: e.target.value })} placeholder="National Headquarters" /></div>
                  <div className="grid gap-1.5"><Label>Tier</Label><Select value={dest.tier} onValueChange={(v) => setDest({ ...dest, tier: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(REMITTANCE_TIERS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
                  <div className="grid gap-1.5"><Label htmlFor="d-bank">Bank name</Label><Input id="d-bank" value={dest.bankName} onChange={(e) => setDest({ ...dest, bankName: e.target.value })} placeholder="GTBank" /></div>
                  <div className="grid gap-1.5"><Label htmlFor="d-nuban">NUBAN (10 digits)</Label><Input id="d-nuban" inputMode="numeric" maxLength={10} value={dest.accountNumberNuban} onChange={(e) => setDest({ ...dest, accountNumberNuban: e.target.value.replace(/\D/g, "") })} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="d-acct">Account name</Label><Input id="d-acct" value={dest.accountName} onChange={(e) => setDest({ ...dest, accountName: e.target.value })} /></div>
                  <div className="grid gap-1.5"><Label>Liability account (2150)</Label><AccountSelect value={dest.liabilityAccountId} onValueChange={(v) => setDest({ ...dest, liabilityAccountId: v })} typeFilter="liability" placeholder="2150 Remittance Payable" /></div>
                  <div className="grid gap-1.5"><Label>Expense account (5800)</Label><AccountSelect value={dest.expenseAccountId} onValueChange={(v) => setDest({ ...dest, expenseAccountId: v })} typeFilter="expense" placeholder="5800 Statutory Remittances" /></div>
                </div>
                <DialogFooter><Button variant="outline" onClick={() => setDestOpen(false)}>Cancel</Button><Button onClick={submitDest}>Add destination</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {dests.length === 0 ? <EmptyState icon={Landmark} title="No destinations configured" description="Add your National HQ, Province or Area/District HQ bank accounts so remittance rules can target them." /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Tier</TableHead><TableHead>Bank</TableHead><TableHead>NUBAN</TableHead><TableHead>Accounts</TableHead></TableRow></TableHeader>
            <TableBody>{dests.map((d) => (
              <TableRow key={d.id}><TableCell className="font-medium">{d.name}</TableCell><TableCell className="text-xs">{REMITTANCE_TIERS[d.tier] ?? d.tier}</TableCell><TableCell className="text-xs">{d.bankName ?? "—"}</TableCell><TableCell className="font-mono text-xs">{d.accountNumberNuban ?? "—"}</TableCell><TableCell className="text-xs text-muted-foreground">{d.liabilityAccountId && d.expenseAccountId ? "mapped" : "⚠ map accounts"}</TableCell></TableRow>
            ))}</TableBody>
          </Table></div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4" />Remittance Rules</h3>
          {canManage && (
            <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add rule</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Remittance Rule</DialogTitle><DialogDescription>Percentage of a fund (or total unrestricted income), or a fixed monthly amount. "Accrue on posting" books the liability every time a gift is posted.</DialogDescription></DialogHeader>
                <div className="grid gap-3">
                  <div className="grid gap-1.5"><Label htmlFor="r-name">Rule name</Label><Input id="r-name" value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} placeholder="National Tithe Remittance (20%)" /></div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="grid gap-1.5"><Label>Destination</Label>
                      <Select value={rule.destinationId} onValueChange={(v) => setRule({ ...rule, destinationId: v })}><SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger><SelectContent>{dests.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select>
                    </div>
                    <div className="grid gap-1.5"><Label>Source</Label>
                      <Select value={rule.sourceType} onValueChange={(v) => setRule({ ...rule, sourceType: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                        <SelectItem value="fund_percentage">% of a fund</SelectItem>
                        <SelectItem value="total_unrestricted_percentage">% of total unrestricted</SelectItem>
                        <SelectItem value="fixed_monthly">Fixed monthly amount</SelectItem>
                      </SelectContent></Select>
                    </div>
                  </div>
                  {rule.sourceType === "fund_percentage" && (
                    <div className="grid gap-1.5"><Label>Fund</Label><FundSelect value={rule.fundId} onValueChange={(v) => setRule({ ...rule, fundId: v })} placeholder="All funds" /></div>
                  )}
                  {rule.sourceType !== "fixed_monthly" ? (
                    <div className="grid gap-1.5"><Label htmlFor="r-pct">Percentage</Label><Input id="r-pct" inputMode="decimal" value={rule.percentageBps} onChange={(e) => setRule({ ...rule, percentageBps: e.target.value })} placeholder="e.g. 20" /></div>
                  ) : (
                    <MoneyField label="Fixed monthly amount" value={rule.fixedAmountCents} onChange={(c) => setRule({ ...rule, fixedAmountCents: c })} />
                  )}
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div><Label htmlFor="r-accrue" className="cursor-pointer">Accrue on posting</Label><p className="text-xs text-muted-foreground">Book the statutory payable every time a gift is posted (vs. monthly schedule).</p></div>
                    <Switch id="r-accrue" checked={rule.accrueOnPosting} onCheckedChange={(c) => setRule({ ...rule, accrueOnPosting: c })} />
                  </div>
                </div>
                <DialogFooter><Button variant="outline" onClick={() => setRuleOpen(false)}>Cancel</Button><Button onClick={submitRule}>Add rule</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {rules.length === 0 ? <EmptyState icon={Settings2} title="No remittance rules" description="e.g. Tithe → 20% to National, 5% to Province; Sunday Offering → 10% to District; Welfare → 0% exempt." /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Destination</TableHead><TableHead>Source</TableHead><TableHead>Fund</TableHead><TableHead className="text-right">Rate / Amount</TableHead><TableHead>Accrue</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
            <TableBody>{rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-xs">{r.destinationName ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.sourceType.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-xs">{r.fundName ?? (r.sourceType === "fund_percentage" ? "All funds" : "—")}</TableCell>
                <TableCell className="text-right font-mono text-xs">{r.sourceType === "fixed_monthly" ? fmtMoney(r.fixedAmountCents ?? 0) : bpsToPct(r.percentageBps)}</TableCell>
                <TableCell>{r.accrueOnPosting ? <Badge variant="default" className="text-xs">on posting</Badge> : <Badge variant="outline" className="text-xs">monthly</Badge>}</TableCell>
                <TableCell>{canManage ? <Switch checked={r.isActive} onCheckedChange={(c) => toggleRule(r, c)} /> : <Badge variant="outline" className="text-xs">{r.isActive ? "active" : "off"}</Badge>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></div>
        )}
      </div>
    </div>
  );
}
