"use client";

/**
 * AddPaymentMethodDialog — tokenized method entry (Stripe Elements stand-in).
 * Production integration: replace the save() body with a Stripe SetupIntent
 * confirmation via Stripe.js — the browser receives a token (pm_…) and only
 * THAT is posted; full card/bank numbers never reach the application server.
 * The demo provider accepts display metadata + last4 to mint a token.
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

export default function AddPaymentMethodDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"card" | "ach">("card");
  const [brand, setBrand] = useState("visa");
  const [number, setNumber] = useState("");
  const [exp, setExp] = useState("");
  const [bankName, setBankName] = useState("");
  const [busy, setBusy] = useState(false);
  const digits = number.replace(/\D/g, "");
  const last4 = digits.slice(-4);

  // "11/29" → month 11, year 2029 (2-digit years expand into this century)
  function parseExpiry(): { month: number; year: number } | null {
    const [mm, yy] = exp.split("/").map((p) => Number(p.trim()));
    if (!Number.isFinite(mm) || mm < 1 || mm > 12) return null;
    let year = Number(yy);
    if (!Number.isFinite(year)) return null;
    if (year < 100) year += 2000;
    return { month: mm, year };
  }

  async function save() {
    setBusy(true);
    try {
      const expiry = type === "card" ? parseExpiry() : null;
      await api.post("/giving/me/payment-methods", {
        type,
        brand: type === "card" ? brand : bankName.trim().toLowerCase() || "bank",
        last4: type === "card" ? last4 : last4 || "0000",
        expMonth: expiry?.month,
        expYear: expiry?.year,
        makeDefault: false,
      });
      toast.success("Payment method saved");
      void qc.invalidateQueries({ queryKey: ["my-giving"] });
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const canSave = type === "card" ? last4.length === 4 && parseExpiry() != null : bankName.trim().length >= 2 && digits.length === 4;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add payment method</DialogTitle>
          <DialogDescription>
            Card details are tokenized in your browser — full numbers are never sent to the church.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup value={type} onValueChange={(v) => setType(v as "card" | "ach")} className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm" htmlFor="pm-type-card">
              <RadioGroupItem value="card" id="pm-type-card" /> Card
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm" htmlFor="pm-type-ach">
              <RadioGroupItem value="ach" id="pm-type-ach" /> Bank account
            </label>
          </RadioGroup>

          {type === "card" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pm-number">Card number (only the last 4 is kept)</Label>
                <Input
                  id="pm-number" inputMode="numeric" placeholder="4242 4242 4242 4242"
                  value={number} onChange={(e) => setNumber(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pm-brand">Brand</Label>
                  <Select value={brand} onValueChange={setBrand}>
                    <SelectTrigger id="pm-brand"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["visa", "mastercard", "amex", "discover"].map((b) => (
                        <SelectItem key={b} value={b} className="capitalize">{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pm-exp">Expiry (MM/YY)</Label>
                  <Input id="pm-exp" placeholder="12/28" value={exp} onChange={(e) => setExp(e.target.value)} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pm-bank">Bank name</Label>
                <Input id="pm-bank" placeholder="Bank of America" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-last4">Account last 4</Label>
                <Input
                  id="pm-last4" inputMode="numeric" maxLength={4} placeholder="0000"
                  value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !canSave} onClick={() => void save()}>
            {busy ? "Saving…" : "Save method"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
