"use client";

/**
 * MyPledgeDialog — a member pledges for THEMSELVES (personId forced server-side).
 * Simplified variant of the staff NewPledgeDialog: no donor picker, no campaign
 * management — just fund, amount, and optional frequency.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LoadingBlock, useApiQuery } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import { fmtMoney, type FundDTO } from "@/lib/types";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

export default function MyPledgeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fundsQ = useApiQuery<{ items: FundDTO[] }>(["my-giving", "funds"], "/funds");
  const funds = (fundsQ.data?.items ?? []).filter((f) => f.isActive);
  const [fundId, setFundId] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("one_time");
  const [busy, setBusy] = useState(false);

  const amountCents = Math.round(Number(amount) * 100);
  const valid = fundId && Number.isFinite(amountCents) && amountCents >= 100;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      await api.post("/pledges", {
        fundId,
        amountCents,
        frequency,
        campaign: "My pledge",
      });
      toast.success(`Pledge of ${fmtMoney(amountCents)} recorded`);
      void qc.invalidateQueries({ queryKey: ["my-giving"] });
      void qc.invalidateQueries({ queryKey: ["pledges"] });
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Make a pledge</DialogTitle>
          <DialogDescription>
            Commit an amount toward a fund. Your progress shows in Recurring &amp; Pledges.
          </DialogDescription>
        </DialogHeader>

        {fundsQ.isLoading ? (
          <LoadingBlock label="Loading funds…" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pl-fund">Fund</Label>
              <Select value={fundId} onValueChange={setFundId}>
                <SelectTrigger id="pl-fund"><SelectValue placeholder="Pick a fund" /></SelectTrigger>
                <SelectContent>
                  {funds.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.type === "tithe" ? "Tithe" : f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pl-amount">Amount</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    id="pl-amount" inputMode="decimal" className="pl-7" placeholder="500.00"
                    value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-freq">Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger id="pl-freq"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One time</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annual">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={() => void submit()}>
            {busy ? "Saving…" : "Make pledge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
