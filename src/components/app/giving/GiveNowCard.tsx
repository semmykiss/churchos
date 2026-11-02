"use client";

/**
 * GiveNowCard — the member-facing hero give form.
 * Tithe is the default fund with a quick calculator (income × %).
 * Card/bank data NEVER reaches this server: only display metadata +
 * a processor token (SetupIntent equivalent) — see AddPaymentMethodDialog.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HandCoins, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LoadingBlock, useApiQuery } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import { fmtMoney, type FundDTO } from "@/lib/types";
import { processorFeeCents } from "@/lib/giving-fees";
import { getStripePromise } from "@/lib/stripe";
import AddPaymentMethodDialog from "./AddPaymentMethodDialog";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly",
};

export default function GiveNowCard({ prefillRecurring }: { prefillRecurring?: boolean }) {
  const qc = useQueryClient();
  const fundsQ = useApiQuery<{ items: FundDTO[] }>(["my-giving", "funds"], "/funds");
  const methodsQ = useApiQuery<{ items: { id: string; type: string; brand: string | null; last4: string | null; isDefault: boolean }[] }>(
    ["my-giving", "methods"], "/giving/me/payment-methods",
  );
  // member's tithe covenant — prefills the calculator percent (10 stays the fallback)
  const commitmentQ = useApiQuery<{ commitment: { commitmentType: string; percent: number | null; fixedAmountCents: number | null } | null }>(
    ["my-giving", "commitment"], "/giving/me/commitment",
  );

  const funds = fundsQ.data?.items ?? [];
  const methods = methodsQ.data?.items ?? [];
  const titheFund = useMemo(() => funds.find((f) => f.type === "tithe"), [funds]);

  const [fundId, setFundId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"one_time" | "recurring">(prefillRecurring ? "recurring" : "one_time");
  const [frequency, setFrequency] = useState("monthly");
  const [methodId, setMethodId] = useState<string>("");
  const [coverFee, setCoverFee] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // tithe calculator
  const [calcOpen, setCalcOpen] = useState(false);
  const [income, setIncome] = useState("");
  const [percent, setPercent] = useState("10");

  // adopt the member's committed tithe percent once the covenant loads
  useEffect(() => {
    const c = commitmentQ.data?.commitment;
    if (c?.commitmentType === "tithe_percent" && c.percent && Number.isFinite(c.percent)) {
      setPercent(String(c.percent));
    }
  }, [commitmentQ.data]);

  useEffect(() => {
    if (!fundId && funds.length) {
      setFundId(titheFund?.id ?? funds[0].id);
    }
  }, [funds, titheFund, fundId]);
  useEffect(() => {
    if (!methodId && methods.length) {
      setMethodId((methods.find((m) => m.isDefault) ?? methods[0]).id);
    }
  }, [methods, methodId]);

  const amountCents = Math.round(Number(amount) * 100);
  const validAmount = Number.isFinite(amountCents) && amountCents >= 100;
  const feeCents = validAmount ? processorFeeCents(amountCents) : 0;
  const totalCents = validAmount ? amountCents + (coverFee ? feeCents : 0) : 0;
  const selectedMethod = methods.find((m) => m.id === methodId);
  const selectedFund = funds.find((f) => f.id === fundId);

  const calcResult = useMemo(() => {
    const inc = Number(income);
    const pct = Number(percent);
    if (!Number.isFinite(inc) || inc <= 0 || !Number.isFinite(pct) || pct <= 0) return null;
    return Math.round(inc * 100 * (pct / 100));
  }, [income, percent]);

  async function give() {
    if (!validAmount || !fundId || !methodId) return;
    setBusy(true);
    try {
      const res = await api.post<{
        status: string; amountCents: number; donationId: string | null;
        provider: string; clientSecret?: string;
      }>("/giving/me/give", {
        amountCents,
        splits: [{ fundId, amountCents }],
        paymentMethodId: methodId,
        coverFee,
        idempotencyKey: `give-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        recurring: mode === "recurring" ? { frequency } : null,
      });

      // Real Stripe SCA / ACH mandate: finish the confirmation in-browser.
      // The webhook settles the ledger once Stripe reports success.
      if (res.status === "requires_action" && res.clientSecret) {
        const stripe = await getStripePromise();
        if (!stripe) throw new Error("Stripe is not available in this browser.");
        const confirmed = await stripe.confirmCardPayment(res.clientSecret);
        if (confirmed.error) {
          toast.error(confirmed.error.message ?? "Your bank could not confirm the payment — nothing was charged.");
          return;
        }
        if (confirmed.paymentIntent?.status === "succeeded") {
          toast.success(
            mode === "recurring"
              ? `First gift confirmed — ${FREQ_LABELS[frequency] ?? frequency} recurring gift is now active`
              : `Thank you for your gift of ${fmtMoney(amountCents)}! It's awaiting the finance team's confirmation.`,
          );
          setAmount("");
          void qc.invalidateQueries({ queryKey: ["my-giving"] });
          void qc.invalidateQueries({ queryKey: ["donations"] });
          return;
        }
        // ACH: processing can take days; the webhook settles it later.
        toast.info("Payment submitted — your bank will process it, and it will appear in your history once it settles.");
        setAmount("");
        void qc.invalidateQueries({ queryKey: ["my-giving"] });
        return;
      }

      // synchronous settlement (demo processor or off-session card)
      toast.success(
        mode === "recurring"
          ? `First gift given — ${FREQ_LABELS[frequency] ?? frequency} recurring gift is now active`
          : `Thank you for your gift of ${fmtMoney(amountCents)}! It's awaiting the finance team's confirmation.`,
      );
      setAmount("");
      void qc.invalidateQueries({ queryKey: ["my-giving"] });
      void qc.invalidateQueries({ queryKey: ["donations"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <HandCoins className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Give today</h2>
            <p className="text-xs text-muted-foreground">Secure — confirmed by the church finance team before it posts to the books.</p>
          </div>
        </div>

        {fundsQ.isLoading || methodsQ.isLoading ? (
          <div className="mt-4"><LoadingBlock label="Preparing the give form…" /></div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_auto_auto]">
            {/* fund */}
            <div className="space-y-1.5">
              <Label htmlFor="give-fund">Fund</Label>
              <Select value={fundId} onValueChange={setFundId}>
                <SelectTrigger id="give-fund" aria-label="Fund">
                  <SelectValue placeholder="Pick a fund" />
                </SelectTrigger>
                <SelectContent>
                  {funds.filter((f) => f.isActive).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.type === "tithe" ? "Tithe" : f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* amount */}
            <div className="space-y-1.5">
              <Label htmlFor="give-amount">Amount</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₦</span>
                <Input
                  id="give-amount" inputMode="decimal" className="pl-7 text-lg font-semibold"
                  placeholder="125.00" value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>
              {selectedFund?.type === "tithe" ? (
                <button
                  type="button" onClick={() => setCalcOpen((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Sparkles className="h-3 w-3" /> {calcOpen ? "Hide" : "Calculate from income"}
                </button>
              ) : null}
            </div>

            {/* payment method */}
            <div className="space-y-1.5">
              <Label htmlFor="give-method">Payment method</Label>
              <div className="flex gap-1.5">
                <Select value={methodId} onValueChange={setMethodId}>
                  <SelectTrigger id="give-method" className="min-w-40" aria-label="Payment method">
                    <SelectValue placeholder={methods.length ? "Pick one" : "None saved"} />
                  </SelectTrigger>
                  <SelectContent>
                    {methods.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.type === "ach" ? "Bank" : m.brand ?? "Card"} •••• {m.last4}{m.isDefault ? " · default" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={() => setAddOpen(true)} aria-label="Add payment method">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* cadence */}
            <div className="space-y-1.5">
              <Label>Cadence</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "one_time" | "recurring")} className="flex gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-sm" htmlFor="mode-one">
                  <RadioGroupItem value="one_time" id="mode-one" /> One time
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm" htmlFor="mode-rec">
                  <RadioGroupItem value="recurring" id="mode-rec" /> Recurring
                </label>
              </RadioGroup>
              {mode === "recurring" ? (
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger aria-label="Recurring frequency" className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FREQ_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>
        )}

        {/* tithe calculator */}
        {calcOpen && selectedFund?.type === "tithe" ? (
          <div className="mt-4 rounded-lg border border-dashed p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="calc-income" className="text-xs">Income</Label>
                <Input id="calc-income" inputMode="decimal" className="w-32" placeholder="1000" value={income} onChange={(e) => setIncome(e.target.value.replace(/[^0-9.]/g, ""))} />
              </div>
              <span className="pb-2 text-sm text-muted-foreground">×</span>
              <div className="space-y-1">
                <Label htmlFor="calc-percent" className="text-xs">Percent</Label>
                <Input id="calc-percent" inputMode="decimal" className="w-20" placeholder="10" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, ""))} />
              </div>
              <span className="pb-2 text-sm text-muted-foreground">=</span>
              <span className="pb-2 text-base font-semibold tabular-nums">{calcResult != null ? fmtMoney(calcResult) : "—"}</span>
              <Button
                type="button" size="sm" variant="secondary" className="ml-auto"
                disabled={calcResult == null || calcResult < 100}
                onClick={() => { if (calcResult) { setAmount((calcResult / 100).toFixed(2)); setCalcOpen(false); } }}
              >
                Use this amount
              </Button>
            </div>
          </div>
        ) : null}

        {/* fee + submit */}
        <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Switch id="cover-fee" checked={coverFee} onCheckedChange={setCoverFee} aria-label="Cover the processing fee" />
            <Label htmlFor="cover-fee" className="text-sm text-muted-foreground">
              Cover the {validAmount ? fmtMoney(feeCents) : ""} processing fee
              <span className="block text-xs">100% of your gift reaches the church</span>
            </Label>
          </div>
          <Button size="lg" className="min-w-44" disabled={busy || !validAmount || !fundId || !methodId} onClick={() => void give()}>
            {busy ? "Processing…" : `Give ${validAmount ? fmtMoney(totalCents) : "₦0"} →`}
          </Button>
        </div>
      </div>

      {addOpen ? <AddPaymentMethodDialog onClose={() => setAddOpen(false)} /> : null}
    </div>
  );
}

