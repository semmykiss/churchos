"use client";

/**
 * PaymentMethodsTab — the member's saved card/bank methods.
 * Tokens + display metadata only; removal is a soft archive server-side.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, Landmark, Plus, Star, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBlock, LoadingBlock, Section, useApiQuery } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import AddPaymentMethodDialog from "./AddPaymentMethodDialog";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

interface MethodDTO {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  isDefault: boolean;
}

export function PaymentMethodsSection() {
  const qc = useQueryClient();
  const q = useApiQuery<{ items: MethodDTO[] }>(["my-giving", "methods"], "/giving/me/payment-methods");
  const [confirmRemove, setConfirmRemove] = useState<MethodDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const items = q.data?.items ?? [];

  async function setDefault(m: MethodDTO) {
    setBusy(true);
    try {
      await api.post(`/giving/me/payment-methods/${m.id}/default`, {});
      toast.success("Default updated");
      void qc.invalidateQueries({ queryKey: ["my-giving"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirmRemove) return;
    setBusy(true);
    try {
      await api.del(`/giving/me/payment-methods/${confirmRemove.id}`);
      toast.success("Payment method removed");
      setConfirmRemove(null);
      void qc.invalidateQueries({ queryKey: ["my-giving"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Payment methods"
      description="Saved securely with the payment processor — the church never sees full card or account numbers."
      actions={
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> Add method
        </Button>
      }
    >
      {q.isLoading ? (
        <LoadingBlock label="Loading…" />
      ) : q.isError ? (
        <ErrorBlock error={q.error} />
      ) : items.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payment methods" description="Add a card or bank account to give in a tap." />
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                {m.type === "ach" ? <Landmark className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {m.type === "ach" ? "Bank account" : (m.brand ?? "Card").replace(/^./, (c) => c.toUpperCase())} •••• {m.last4}
                </p>
                {m.isDefault ? <p className="text-xs text-primary">Default</p> : null}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {!m.isDefault ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void setDefault(m)} aria-label="Set as default">
                    <Star className="h-3.5 w-3.5" /> Make default
                  </Button>
                ) : null}
                <Button
                  size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                  disabled={busy} onClick={() => setConfirmRemove(m)} aria-label="Remove payment method"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm ? <AddPaymentMethodDialog onClose={() => setShowForm(false)} /> : null}

      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payment method?</AlertDialogTitle>
            <AlertDialogDescription>
              Any recurring gifts using it will fail until you pick another method. Past gifts are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={(e) => { e.preventDefault(); void remove(); }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

