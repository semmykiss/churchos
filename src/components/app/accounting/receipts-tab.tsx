"use client";
/**
 * Receipts & Giving Sync tab — the Giving↔GL bridge surface.
 * Sub-tabs: 1) Giving Verification Queue  2) Service Offering Count Sheets
 *           3) Other Church Receipts  4) Cash Deposits (Safe → Bank)
 *           5) Fund ↔ GL Mapping
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ClipboardCheck, Receipt, Landmark, ArrowRightLeft, CheckCircle2, Undo2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fmtMoney, fmtDate, type SessionUser } from "@/lib/types";
import { canDo } from "@/lib/types";
import {
  Section, EmptyState, LoadingBlock, ErrorBlock, useApiQuery,
} from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  KpiRow, StatusPill, MoneyField, amountToCents,
  AccountSelect, FundSelect, BankAccountSelect,
  NGN_METHOD_LABELS, VERIFICATION_STATUS_LABELS, RECEIPT_CATEGORIES,
} from "./accounting-shared";

type SubTab = "queue" | "count-sheets" | "other-receipts" | "deposits" | "fund-mapping";

const SUB_TABS: { id: SubTab; label: string; icon: any }[] = [
  { id: "queue", label: "Giving Verification Queue", icon: ClipboardCheck },
  { id: "count-sheets", label: "Service Offering Count Sheets", icon: Receipt },
  { id: "other-receipts", label: "Other Church Receipts", icon: Plus },
  { id: "deposits", label: "Cash Deposits (Safe → Bank)", icon: Landmark },
  { id: "fund-mapping", label: "Fund ↔ GL Mapping", icon: ArrowRightLeft },
];

export function ReceiptsTab({ user }: { user: SessionUser }) {
  const [sub, setSub] = useState<SubTab>("queue");
  const canManage = canDo(user, "accounting.manage") || canDo(user, "giving.verify.accountant");
  const canUsher = canDo(user, "giving.verify.usher") || canManage;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {SUB_TABS.filter((t) => t.id !== "count-sheets" || canUsher).map((t) => {
          const Icon = t.icon;
          const active = sub === t.id;
          return (
            <button key={t.id} onClick={() => setSub(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>
      {sub === "queue" && <VerificationQueue user={user} canManage={canManage} />}
      {sub === "count-sheets" && <CountSheets user={user} canUsher={canUsher} canManage={canManage} />}
      {sub === "other-receipts" && <OtherReceipts canManage={canDo(user, "accounting.manage")} />}
      {sub === "deposits" && <CashDeposits canManage={canDo(user, "accounting.manage")} />}
      {sub === "fund-mapping" && <FundMapping canManage={canDo(user, "giving.funds.manage")} />}
    </div>
  );
}

// ── 1. Giving Verification Queue ──────────────────────────────────────────────

function VerificationQueue({ user, canManage }: { user: SessionUser; canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useApiQuery<{ batches: any[]; pendingGifts: any[] }>(["giving-verification-queue"], "/verification-queue");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectingGift, setRejectingGift] = useState<string | null>(null);
  const [rejectGiftNote, setRejectGiftNote] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["giving-verification-queue"] });
    qc.invalidateQueries({ queryKey: ["donations"] });
  };

  async function approveOne(id: string) {
    try { await api.post(`/batches/${id}/approve-gl`, {}); toast.success("Batch approved & posted to the GL."); refresh(); qc.invalidateQueries({ queryKey: ["journal-entries"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); }
    catch (e) { toast.error((e as ApiError).message || "Failed to approve batch."); }
  }
  async function approveBulk(ids: string[]) {
    try { const r = await api.post("/batches/approve-gl-bulk", { batchIds: ids }); toast.success(`Posted ${r.results.filter((x: any) => x.ok).length} of ${r.results.length} batches.`); refresh(); qc.invalidateQueries({ queryKey: ["journal-entries"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); }
    catch (e) { toast.error((e as ApiError).message || "Bulk approve failed."); }
  }
  async function doReject() {
    if (!rejecting || !rejectNote.trim()) return;
    try { await api.post(`/batches/${rejecting}/reject`, { note: rejectNote.trim() }); toast.success("Batch returned to the usher queue."); setRejecting(null); setRejectNote(""); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to return batch."); }
  }

  // individual pending gifts (clerk entries, member bank transfers, online giving)
  async function approveGift(id: string) {
    try { await api.post(`/donations/${id}/approve-gl`, {}); toast.success("Gift approved & posted to the GL."); refresh(); qc.invalidateQueries({ queryKey: ["journal-entries"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); }
    catch (e) { toast.error((e as ApiError).message || "Failed to approve gift."); }
  }
  async function approveGiftsBulk(ids: string[]) {
    try { const r = await api.post("/donations/approve-gl-bulk", { donationIds: ids }); const ok = r.results.filter((x: any) => x.ok).length; toast.success(`Posted ${ok} of ${r.results.length} gifts to the GL.`); refresh(); qc.invalidateQueries({ queryKey: ["journal-entries"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); }
    catch (e) { toast.error((e as ApiError).message || "Bulk approve failed."); }
  }
  async function doRejectGift() {
    if (!rejectingGift || !rejectGiftNote.trim()) return;
    try { await api.post(`/donations/${rejectingGift}/reject`, { note: rejectGiftNote.trim() }); toast.success("Gift returned with your query — it stays pending."); setRejectingGift(null); setRejectGiftNote(""); refresh(); }
    catch (e) { toast.error((e as ApiError).message || "Failed to return gift."); }
  }

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={(error as ApiError).message} />;
  const batches = data?.batches ?? [];
  const gifts = data?.pendingGifts ?? [];
  const pendingBatches = batches.filter((b) => b.verificationStatus === "usher_verified");

  return (
    <div className="space-y-4">
      <KpiRow items={[
        { label: "Pending Usher Batches", value: String(batches.filter((b) => b.verificationStatus === "usher_verified").length), tone: "amber" },
        { label: "Draft Count Sheets", value: String(batches.filter((b) => b.verificationStatus === "draft").length) },
        { label: "Pending Gifts (queue)", value: String(gifts.length), tone: "amber" },
        { label: "Returned (Query)", value: String(batches.filter((b) => b.verificationStatus === "rejected").length), tone: "rose" },
        { label: "Posted to GL (total)", value: String(batches.filter((b) => b.verificationStatus === "accountant_verified").length) },
      ]} />
      <Section title="Usher-Verified Batches — awaiting Accountant sign-off" icon={ClipboardCheck}>
        {batches.length === 0 ? <EmptyState icon={ClipboardCheck} title="No batches in the queue" description="Offering count sheets that pass usher verification will appear here for posting to the General Ledger." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Service / Date</TableHead><TableHead>Service</TableHead><TableHead className="text-right">Amount</TableHead>
                <TableHead>Counted By</TableHead><TableHead>Verification</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}<div className="text-xs text-muted-foreground">{fmtDate(b.serviceDate)}</div></TableCell>
                    <TableCell><Badge variant="outline">{b.serviceName ?? "—"}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(b.totalCents)}</TableCell>
                    <TableCell className="text-xs">{b.countedByOne ?? "—"}<div className="text-muted-foreground">+ {b.countedByTwo ?? "—"}</div></TableCell>
                    <TableCell><StatusPill status={b.verificationStatus} map={VERIFICATION_STATUS_LABELS} />{b.rejectionNote ? <div className="text-xs text-rose-600 mt-1 max-w-[16rem] truncate" title={b.rejectionNote}>⚠ {b.rejectionNote}</div> : null}</TableCell>
                    <TableCell className="text-right">
                      {canManage && b.verificationStatus === "usher_verified" && (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" onClick={() => approveOne(b.id)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve & Post</Button>
                          <Button size="sm" variant="outline" onClick={() => { setRejecting(b.id); setRejectNote(b.rejectionNote ?? ""); }}><Undo2 className="h-3.5 w-3.5 mr-1" />Query</Button>
                        </div>
                      )}
                      {b.verificationStatus === "draft" && <span className="text-xs text-muted-foreground">Awaiting usher sign-off</span>}
                      {b.verificationStatus === "rejected" && <span className="text-xs text-muted-foreground">Returned — fix & re-verify</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {canManage && pendingBatches.length > 1 && (
              <div className="mt-3 flex justify-end">
                <Button onClick={() => approveBulk(pendingBatches.map((b) => b.id))}>Bulk Approve & Post ({pendingBatches.length})</Button>
              </div>
            )}
          </div>
        )}
      </Section>

      <AlertDialog open={!!rejecting} onOpenChange={(o) => { if (!o) { setRejecting(null); setRejectNote(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Return batch with query</AlertDialogTitle>
            <AlertDialogDescription>The batch goes back to the usher queue. A mandatory note explains the discrepancy (e.g. physical cash short of count sheet, member transfer not on statement).</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. Cash counted ₦48,200 but count sheet says ₦50,000 — recount needed." rows={3} />
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doReject}>Return with Query</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Section title="Pending Gifts — clerk entries, member transfers & online giving" icon={Receipt}>
        {gifts.length === 0 ? (
          <EmptyState icon={Receipt} title="No pending gifts" description="Recorded gifts, member bank transfers and online giving land here (pending) and only post to the GL once you approve them." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Donor / Detail</TableHead><TableHead>Received</TableHead><TableHead>Method</TableHead><TableHead>Funds</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {gifts.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">
                      {g.isAnonymous ? "Anonymous" : (g.person?.name ?? "Unattributed")}
                      {g.rejectionNote ? <div className="text-xs text-rose-600 max-w-[16rem] truncate" title={g.rejectionNote}>⚠ Query: {g.rejectionNote}</div> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(g.receivedOn)}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{NGN_METHOD_LABELS[g.method] ?? g.method}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{(g.splits ?? []).map((s: any) => s.fundName).join(", ") || "—"}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{fmtMoney(g.amountCents)}</TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" onClick={() => approveGift(g.id)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve & Post</Button>
                          <Button size="sm" variant="outline" onClick={() => { setRejectingGift(g.id); setRejectGiftNote(g.rejectionNote ?? ""); }}><Undo2 className="h-3.5 w-3.5 mr-1" />Query</Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Awaiting finance</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {canManage && gifts.length > 1 && (
              <div className="mt-3 flex justify-end">
                <Button onClick={() => approveGiftsBulk(gifts.map((g: any) => g.id))}>Approve & Post All ({gifts.length})</Button>
              </div>
            )}
          </div>
        )}
      </Section>

      <AlertDialog open={!!rejectingGift} onOpenChange={(o) => { if (!o) { setRejectingGift(null); setRejectGiftNote(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Return gift with query</AlertDialogTitle>
            <AlertDialogDescription>The gift stays pending and is flagged back to the usher/clerk queue with your note (e.g. transfer not found on the bank statement). The note is mandatory.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={rejectGiftNote} onChange={(e) => setRejectGiftNote(e.target.value)} placeholder="e.g. Transfer not found on the bank statement for this date." rows={3} />
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doRejectGift}>Return with Query</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── 2. Service Offering Count Sheets ─────────────────────────────────────────

const DENOMS = [
  { key: "n1000", label: "₦1,000", unit: 100000 },
  { key: "n500", label: "₦500", unit: 50000 },
  { key: "n200", label: "₦200", unit: 20000 },
  { key: "n100", label: "₦100", unit: 10000 },
  { key: "n50", label: "₦50", unit: 5000 },
  { key: "coins", label: "Coins", unit: 100 },
];

function CountSheets({ user, canUsher, canManage }: { user: SessionUser; canUsher: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useApiQuery<{ items: any[] }>(["count-sheets"], "/count-sheets");
  const [open, setOpen] = useState(false);
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [serviceName, setServiceName] = useState("1st Service");
  const [countedByOne, setCountedByOne] = useState(user.name);
  const [denoms, setDenoms] = useState<Record<string, string>>({ n1000: "", n500: "", n200: "", n100: "", n50: "", coins: "" });
  const [posCents, setPosCents] = useState<number | null>(null);
  const [transferCents, setTransferCents] = useState<number | null>(null);
  const [chequeCents, setChequeCents] = useState<number | null>(null);
  const [splits, setSplits] = useState<{ fundId: string; amountCents: number | null }[]>([{ fundId: "", amountCents: null }]);

  const cashCents = DENOMS.reduce((a, d) => a + (amountToCents(denoms[d.key] ?? "") > 0 ? amountToCents(denoms[d.key]) * d.unit : 0), 0);
  const totalCents = cashCents + (posCents ?? 0) + (transferCents ?? 0) + (chequeCents ?? 0);
  const splitSum = splits.reduce((a, s) => a + (s.amountCents ?? 0), 0);
  const balanced = totalCents > 0 && splitSum === totalCents && splits.every((s) => s.fundId && (s.amountCents ?? 0) > 0);

  async function submit() {
    if (!balanced) { toast.error("Category splits must total the counted amount exactly."); return; }
    try {
      await api.post("/count-sheets", {
        serviceDate, serviceName, countedByOne,
        denominations: Object.fromEntries(DENOMS.map((d) => [d.key, amountToCents(denoms[d.key] ?? "") > 0 ? amountToCents(denoms[d.key]) * d.unit : 0])),
        categorySplits: splits.map((s) => ({ fundId: s.fundId, amountCents: s.amountCents })),
      });
      toast.success("Count sheet created — awaiting head-usher sign-off.");
      setOpen(false);
      setDenoms({ n1000: "", n500: "", n200: "", n100: "", n50: "", coins: "" });
      setPosCents(null); setTransferCents(null); setChequeCents(null);
      setSplits([{ fundId: "", amountCents: null }]);
      qc.invalidateQueries({ queryKey: ["count-sheets"] });
      qc.invalidateQueries({ queryKey: ["giving-verification-queue"] });
    } catch (e) { toast.error((e as ApiError).message || "Failed to create count sheet."); }
  }

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={(error as ApiError).message} />;
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canUsher && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />New Count Sheet</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Service Offering Count Sheet</DialogTitle>
                <DialogDescription>Two-person control: you record, a second usher (head usher) co-signs before the accountant posts to the GL.</DialogDescription>
              </DialogHeader>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="grid gap-1.5"><Label htmlFor="cs-date">Service date</Label><Input id="cs-date" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} /></div>
                <div className="grid gap-1.5"><Label>Service</Label>
                  <Select value={serviceName} onValueChange={setServiceName}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["1st Service", "2nd Service", "3rd Service", "Midweek Service", "Vigil", "Revival", "Special"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5"><Label htmlFor="cs-by">Counted by</Label><Input id="cs-by" value={countedByOne} onChange={(e) => setCountedByOne(e.target.value)} /></div>
              </div>
              <div>
                <Label className="mb-1.5">Cash denomination calculator</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {DENOMS.map((d) => (
                    <div key={d.key} className="grid gap-1">
                      <Label className="text-xs text-muted-foreground">{d.label} × count</Label>
                      <Input inputMode="numeric" placeholder="0" value={denoms[d.key] ?? ""} onChange={(e) => setDenoms({ ...denoms, [d.key]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">Cash subtotal: <span className="font-mono font-medium text-foreground">{fmtMoney(cashCents)}</span></div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <MoneyField label="POS slips" value={posCents} onChange={setPosCents} />
                <MoneyField label="Bank transfers" value={transferCents} onChange={setTransferCents} />
                <MoneyField label="Cheques" value={chequeCents} onChange={setChequeCents} />
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">Counted total: <span className="font-mono font-semibold">{fmtMoney(totalCents)}</span></div>
              <div>
                <Label className="mb-1.5">Category breakdown (Tithe / Offering / Thanksgiving / Seed / Children / Building / Welfare)</Label>
                <div className="space-y-2">
                  {splits.map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
                      <FundSelect value={s.fundId || undefined} onValueChange={(id) => setSplits(splits.map((x, j) => j === i ? { ...x, fundId: id } : x))} placeholder="Fund" />
                      <div className="w-36"><MoneyField label="" value={s.amountCents} onChange={(c) => setSplits(splits.map((x, j) => j === i ? { ...x, amountCents: c } : x))} /></div>
                      <Button variant="ghost" size="icon" disabled={splits.length === 1} onClick={() => setSplits(splits.filter((_, j) => j !== i))}>×</Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setSplits([...splits, { fundId: "", amountCents: null }])}><Plus className="h-3.5 w-3.5 mr-1" />Add category</Button>
                </div>
                <div className={`mt-2 text-sm rounded-md px-3 py-2 ${balanced ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : totalCents > 0 ? "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" : "bg-muted text-muted-foreground"}`}>
                  Splits total {fmtMoney(splitSum)} {balanced ? "✓ Balanced" : totalCents > 0 ? `— off by ${fmtMoney(Math.abs(totalCents - splitSum))}` : "— enter a total"}
                </div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={!balanced}>Create & send for sign-off</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Section title="Service Count Sheets" icon={Receipt}>
        {items.length === 0 ? <EmptyState icon={Receipt} title="No count sheets yet" description="Create a count sheet after each service so the head usher can co-sign and the accountant can post the offering to the GL." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Counted by</TableHead><TableHead>Verification</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}<div className="text-xs text-muted-foreground">{s.serviceName}</div></TableCell>
                    <TableCell>{fmtDate(s.serviceDate)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(s.totalCents)}</TableCell>
                    <TableCell className="text-xs">{s.countedByOne ?? "—"}{s.countedByTwo ? <div className="text-muted-foreground">+ {s.countedByTwo}</div> : null}</TableCell>
                    <TableCell><StatusPill status={s.verificationStatus} map={VERIFICATION_STATUS_LABELS} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── 3. Other Church Receipts ──────────────────────────────────────────────────

function OtherReceipts({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useApiQuery<{ items: any[] }>(["other-receipts"], "/other-receipts");
  const [open, setOpen] = useState(false);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("bookshop");
  const [description, setDescription] = useState("");
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string | undefined>();
  const [revenueAccountId, setRevenueAccountId] = useState<string | undefined>();
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentRef, setPaymentRef] = useState("");

  async function submit() {
    if (!amountCents || amountCents <= 0) { toast.error("Enter a valid amount."); return; }
    if (!revenueAccountId) { toast.error("Select a revenue account."); return; }
    try {
      await api.post("/other-receipts", { receiptDate, category, description, amountCents, bankAccountId, revenueAccountId, paymentMethod, paymentRef });
      toast.success("Receipt recorded & posted to the GL.");
      setOpen(false); setAmountCents(null); setDescription(""); setPaymentRef("");
      qc.invalidateQueries({ queryKey: ["other-receipts"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
    } catch (e) { toast.error((e as ApiError).message || "Failed to record receipt."); }
  }

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={(error as ApiError).message} />;
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Record Receipt</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Other Church Receipt</DialogTitle><DialogDescription>Bookshop/Media sales, hall rental, school/clinic subvention, grants, bank interest, refunds — posts Dr Bank/Cash / Cr Revenue.</DialogDescription></DialogHeader>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="r-date">Date</Label><Input id="r-date" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Category</Label>
                <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(RECEIPT_CATEGORIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="r-desc">Description</Label><Input id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Hall rental — Sister Adaeze wedding" /></div>
            <MoneyField label="Amount" value={amountCents} onChange={setAmountCents} />
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Revenue GL account</Label><AccountSelect value={revenueAccountId} onValueChange={setRevenueAccountId} typeFilter="revenue" placeholder="4500 Other Receipts" /></div>
              <div className="grid gap-1.5"><Label>Bank account</Label><BankAccountSelect value={bankAccountId} onValueChange={setBankAccountId} placeholder="Optional — defaults to Operating" /></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["bank_transfer", "pos", "cash", "cheque"].map((m) => <SelectItem key={m} value={m}>{NGN_METHOD_LABELS[m]}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="grid gap-1.5"><Label htmlFor="r-ref">Payment ref</Label><Input id="r-ref" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="teller / transfer ref" /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit}>Record & Post</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}</div>
      <Section title="Other Church Receipts" icon={Plus}>
        {items.length === 0 ? <EmptyState icon={Plus} title="No other receipts recorded" description="Non-donation inflows (bookshop, hall rental, grants, interest) post directly to the GL and generate a receipt number." /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Receipt #</TableHead><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.receiptNumber}</TableCell>
                <TableCell>{fmtDate(r.receiptDate)}</TableCell>
                <TableCell><Badge variant="outline">{RECEIPT_CATEGORIES[r.category] ?? r.category}</Badge></TableCell>
                <TableCell className="max-w-[20rem] truncate">{r.description ?? "—"}</TableCell>
                <TableCell className="text-xs">{NGN_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(r.amountCents)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></div>
        )}
      </Section>
    </div>
  );
}

// ── 4. Cash Deposits (Safe → Bank) ────────────────────────────────────────────

function CashDeposits({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useApiQuery<{ items: any[] }>(["cash-deposits"], "/cash-deposits");
  const [open, setOpen] = useState(false);
  const [depositDate, setDepositDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState<string | undefined>();
  const [tellerSlipNumber, setTellerSlipNumber] = useState("");
  const [totalCents, setTotalCents] = useState<number | null>(null);

  async function submit() {
    if (!totalCents || totalCents <= 0) { toast.error("Enter a valid amount."); return; }
    if (!bankAccountId) { toast.error("Select the bank account to deposit into."); return; }
    try {
      await api.post("/cash-deposits", { depositDate, bankAccountId, tellerSlipNumber, totalCents });
      toast.success("Cash deposit posted — Dr Bank / Cr Undeposited Cash.");
      setOpen(false); setTotalCents(null); setTellerSlipNumber("");
      qc.invalidateQueries({ queryKey: ["cash-deposits"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
    } catch (e) { toast.error((e as ApiError).message || "Failed to record deposit."); }
  }

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={(error as ApiError).message} />;
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Record Bank Deposit</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Bank Deposit</DialogTitle><DialogDescription>Move posted cash offerings from the Church Safe (1020) to the Operating Bank account (1010). Posts Dr Bank / Cr Undeposited Cash.</DialogDescription></DialogHeader>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="d-date">Deposit date</Label><Input id="d-date" type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="d-teller">Teller / slip #</Label><Input id="d-teller" value={tellerSlipNumber} onChange={(e) => setTellerSlipNumber(e.target.value)} /></div>
            </div>
            <div className="grid gap-1.5"><Label>Bank account</Label><BankAccountSelect value={bankAccountId} onValueChange={setBankAccountId} /></div>
            <MoneyField label="Deposit amount" value={totalCents} onChange={setTotalCents} />
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit}>Post Deposit</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}</div>
      <Section title="Cash Deposits — Safe → Bank" icon={Landmark}>
        {items.length === 0 ? <EmptyState icon={Landmark} title="No deposits recorded" description="Cash offerings sit in 1020 Undeposited Cash after posting. Record each bank deposit here to move it to 1010 Operating Bank." /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Teller #</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{fmtDate(d.depositDate)}</TableCell>
                <TableCell className="font-mono text-xs">{d.tellerSlipNumber ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(d.totalCents)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></div>
        )}
      </Section>
    </div>
  );
}

// ── 5. Fund ↔ GL Mapping ──────────────────────────────────────────────────────

function FundMapping({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useApiQuery<{ items: any[] }>(["funds"], "/funds");
  const [editing, setEditing] = useState<any | null>(null);
  const [revId, setRevId] = useState<string | undefined>();
  const [cashId, setCashId] = useState<string | undefined>();
  const [restriction, setRestriction] = useState("unrestricted");

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={(error as ApiError).message} />;
  const funds = data?.items ?? [];

  async function save() {
    if (!editing) return;
    try {
      await api.patch(`/funds/${editing.id}/gl-mapping`, { revenueAccountId: revId || null, defaultCashAccountId: cashId || null, restriction });
      toast.success(`${editing.name} GL mapping updated.`);
      setEditing(null); qc.invalidateQueries({ queryKey: ["funds"] });
    } catch (e) { toast.error((e as ApiError).message || "Failed to update mapping."); }
  }

  return (
    <div className="space-y-4">
      <Section title="Fund ↔ GL Account Mapping" icon={ArrowRightLeft}>
        <p className="text-sm text-muted-foreground max-w-3xl">When the Accountant approves & posts a gift, the server debits the fund's <strong>default cash account</strong> (e.g. 1020 Safe for cash, 1010 Bank for transfers) and credits the fund's <strong>revenue account</strong>. Funds with active remittance rules accrue the statutory percentage on posting.</p>
        <div className="overflow-x-auto mt-2"><Table>
          <TableHeader><TableRow><TableHead>Fund</TableHead><TableHead>Code</TableHead><TableHead>Type</TableHead><TableHead>Revenue account</TableHead><TableHead>Cash/Bank account</TableHead><TableHead>Restriction</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{funds.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="font-medium">{f.name}</TableCell>
              <TableCell className="font-mono text-xs">{f.code}</TableCell>
              <TableCell><Badge variant="outline">{f.type}</Badge></TableCell>
              <TableCell className="text-xs">{f.revenueAccountId ? <span className="text-emerald-600">mapped</span> : <span className="text-amber-600">unmapped</span>}</TableCell>
              <TableCell className="text-xs">{f.defaultCashAccountId ? <span className="text-emerald-600">mapped</span> : <span className="text-amber-600">default 1000</span>}</TableCell>
              <TableCell className="text-xs capitalize">{f.restriction ?? "unrestricted"}</TableCell>
              <TableCell className="text-right">{canManage && <Button size="sm" variant="outline" onClick={() => { setEditing(f); setRevId(f.revenueAccountId || undefined); setCashId(f.defaultCashAccountId || undefined); setRestriction(f.restriction || "unrestricted"); }}>Edit mapping</Button>}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></div>
      </Section>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.name} — GL mapping</DialogTitle><DialogDescription>Choose the revenue account this fund credits and the cash/bank account it debits when a gift is posted.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>Revenue GL account</Label><AccountSelect value={revId} onValueChange={setRevId} typeFilter="revenue" placeholder="4010 Tithes Revenue" /></div>
            <div className="grid gap-1.5"><Label>Default cash/bank account</Label><AccountSelect value={cashId} onValueChange={setCashId} typeFilter="asset" placeholder="1020 Undeposited Cash" /></div>
            <div className="grid gap-1.5"><Label>Restriction</Label>
              <Select value={restriction} onValueChange={setRestriction}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["unrestricted", "temp_restricted", "perm_restricted"].map((r) => <SelectItem key={r} value={r}><span className="capitalize">{r.replace("_", " ")}</span></SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save mapping</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
