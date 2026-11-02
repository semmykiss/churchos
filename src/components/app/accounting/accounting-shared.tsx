"use client";
/**
 * Shared helpers for the Enterprise Accounting UI (Nigerian).
 *  • integer-kobo money conversion (no floats in storage; the input shows ₦, the
 *    DTO carries kobo — exactly like giving-module.tsx's amountToCents).
 *  • reusable Selects backed by the existing ["accounts"] / ["funds"] / ["bank-accounts"] queries
 *  • Nigerian payment-method + department + status label maps
 */
import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { StatCard, useApiQuery } from "@/components/app/shared";
import type { AccountDTO, FundDTO } from "@/lib/types";

export const NGN_PAYMENT_METHODS = ["bank_transfer", "pos", "cash", "cheque", "online"] as const;
export const NGN_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  pos: "POS",
  cash: "Cash",
  cheque: "Cheque",
  online: "Online",
  // legacy values still surfacing from existing rows
  card: "Card",
  ach: "ACH",
  check: "Cheque",
  other: "Other",
  petty_cash: "Petty Cash",
};

export const PV_METHODS = ["bank_transfer", "cash", "petty_cash", "cheque", "pos"] as const;

export const DEPARTMENTS = ["Music", "Media", "Maintenance", "Children", "Welfare", "Pastoral", "Admin", "Other"] as const;

export const PV_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-muted text-muted-foreground" },
  pending_approval: { label: "Pending Approval", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  approved: { label: "Approved", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  paid: { label: "Paid", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  rejected: { label: "Rejected", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
  void: { label: "Void", tone: "bg-muted text-muted-foreground line-through" },
};

export const VERIFICATION_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft count sheet", tone: "bg-muted text-muted-foreground" },
  pending_verification: { label: "Pending verification", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  usher_verified: { label: "Usher verified", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  accountant_verified: { label: "Posted to GL", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  rejected: { label: "Returned with query", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
};

export const REMITTANCE_TIERS: Record<string, string> = {
  area: "Area / District HQ",
  province: "Province",
  region: "Region",
  national: "National HQ",
};

export const RECEIPT_CATEGORIES: Record<string, string> = {
  bookshop: "Bookshop / Media sales",
  media: "Media / Content sales",
  hall_rental: "Hall / Facility rental",
  school: "School / Academy subvention",
  clinic: "Clinic subvention",
  grant: "Grant from HQ",
  interest: "Bank interest",
  refund: "Refund",
  other: "Other receipt",
};

/** Parse a naira string ("1,500.00", "₦2500", "1500") into integer kobo. NaN if invalid. */
export function amountToCents(s: string | number | null | undefined): number {
  if (typeof s === "number") return Math.round(s * 100);
  if (!s) return NaN;
  const cleaned = String(s).replace(/[₦,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Format integer kobo as a naira display string (no ₦ prefix; uses fmtMoney elsewhere for ₦). */
export function centsToNaira(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Convert a basis-points rate (750 = 7.50%) to a percentage string. */
export function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Convert a percentage string ("20", "7.5%") to basis points (integer). */
export function pctToBps(s: string | number | null | undefined): number {
  if (typeof s === "number") return Math.round(s * 100);
  if (!s) return 0;
  const cleaned = String(s).replace(/%/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ── account / fund / bank selects ─────────────────────────────────────────────

export function useAccounts() {
  return useApiQuery<{ items: AccountDTO[] }>(["accounts"], "/accounts");
}

/** Select listing GL accounts, optionally filtered by type. */
export function AccountSelect({
  value, onValueChange, typeFilter, placeholder = "Select account", disabled, className,
}: {
  value: string | undefined;
  onValueChange: (id: string) => void;
  typeFilter?: string | string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useAccounts();
  const items = useMemo(() => {
    const all = (data?.items ?? []) as AccountDTO[];
    if (!typeFilter) return all;
    const types = Array.isArray(typeFilter) ? typeFilter : [typeFilter];
    return all.filter((a) => types.includes(a.type));
  }, [data, typeFilter]);
  return (
    <Select value={value ?? ""} onValueChange={onValueChange} disabled={disabled || isLoading}>
      <SelectTrigger className={className}><SelectValue placeholder={isLoading ? "Loading…" : placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {items.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>{a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Select listing giving funds. */
export function FundSelect({
  value, onValueChange, placeholder = "Select fund", disabled, className,
}: {
  value: string | undefined;
  onValueChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useApiQuery<{ items: FundDTO[] }>(["funds"], "/funds");
  const items = (data?.items ?? []) as FundDTO[];
  return (
    <Select value={value ?? ""} onValueChange={onValueChange} disabled={disabled || isLoading}>
      <SelectTrigger className={className}><SelectValue placeholder={isLoading ? "Loading…" : placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {items.map((f) => (
          <SelectItem key={f.id} value={f.id}>{f.name} <span className="text-xs text-muted-foreground">({f.code})</span></SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Select listing bank accounts (linked GL asset accounts). */
export function BankAccountSelect({
  value, onValueChange, placeholder = "Select bank account", disabled, className,
}: {
  value: string | undefined;
  onValueChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useApiQuery<{ items: { id: string; name: string; glAccountCode: string | null }[] }>(["bank-accounts"], "/bank-accounts");
  const items = (data?.items ?? []) as { id: string; name: string; glAccountCode: string | null }[];
  return (
    <Select value={value ?? ""} onValueChange={onValueChange} disabled={disabled || isLoading}>
      <SelectTrigger className={className}><SelectValue placeholder={isLoading ? "Loading…" : placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {items.map((b) => (
          <SelectItem key={b.id} value={b.id}>{b.name}{b.glAccountCode ? ` (${b.glAccountCode})` : ""}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Controlled money input — shows ₦, emits integer kobo via onChange(cents). */
export function MoneyInput({
  value, onChange, placeholder, id, disabled, className,
}: {
  value: number | null | undefined; // cents
  onChange: (cents: number) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const display = value == null || Number.isNaN(value) ? "" : centsToNaira(value);
  return (
    <Input
      id={id}
      inputMode="decimal"
      disabled={disabled}
      className={className}
      placeholder={placeholder ?? "0.00"}
      value={display}
      onChange={(e) => onChange(amountToCents(e.target.value))}
    />
  );
}

/** A labelled money field (label + MoneyInput). */
export function MoneyField({
  label, value, onChange, placeholder, id, disabled,
}: {
  label: string; value: number | null | undefined; onChange: (cents: number) => void;
  placeholder?: string; id?: string; disabled?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₦</span>
        <MoneyInput id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} className="pl-7" />
      </div>
    </div>
  );
}

/** Row of StatCards for KPI strips. */
export function KpiRow({ items }: { items: { label: string; value: string; tone?: string }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((it) => (
        <StatCard key={it.label} label={it.label} value={it.value} tone={it.tone} />
      ))}
    </div>
  );
}

/** Small status pill used by voucher / batch rows. */
export function StatusPill({ status, map }: { status: string; map: Record<string, { label: string; tone: string }> }) {
  const v = map[status] ?? { label: status, tone: "bg-muted text-muted-foreground" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${v.tone}`}>{v.label}</span>;
}
