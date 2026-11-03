"use client";

/**
 * ReportsTab — modernized Accounting Reports (Nigerian church SaaS).
 *
 * Design goals:
 *  • Lazy fetching — ONLY the selected report is ever fetched: a single
 *    useQuery keyed ["report", key, from, to, (kind)] whose `path` points at
 *    the active report's endpoint. Switching reports swaps the key (new fetch),
 *    switching back is served from TanStack cache.
 *  • Grouped catalog — sidebar list on ≥lg (name + tiny description), a
 *    grouped Select on mobile.
 *  • Board-ready presentation — KPI strips, right-aligned tabular amounts,
 *    bold totals footers, emerald/rose balance-check banners (trial balance,
 *    financial position, cash flow), CSV export + print/PDF.
 *
 * Reports (11): activities, position, cash_flow*, income_trend*, trial_balance,
 * funds, giving, receipts_payments, functional, remittances, payroll_register*
 * (* = new in this modernization).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, BarChart3, BookOpenCheck, Briefcase, CheckCircle2, Coins, Download,
  HeartHandshake, Landmark, Megaphone, Printer, Scale, Send, Users, Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, StatCard } from "@/components/app/shared";
import { PAYROLL_KIND_LABELS, centsToNaira } from "./accounting-shared";
import { api, qs, ApiError } from "@/lib/api";
import { fmtDate, fmtMoney, type SessionUser } from "@/lib/types";

// ── report payload shapes (mirror src/server/services/accounting.ts & payroll.ts) ──

interface ActivitiesData {
  revenue: { fundId: string; fundName: string; fundType: string; amountCents: number }[];
  expenses: { fundId: string; fundName: string; amountCents: number }[];
  byFunctional: Record<string, number>;
  totalRevenueCents: number;
  totalExpenseCents: number;
  netCents: number;
}

interface PositionData {
  assets: { code: string; name: string; balanceCents: number }[];
  liabilities: { code: string; name: string; balanceCents: number }[];
  netAssets: { code: string; name: string; restriction: string; balanceCents: number }[];
  undesignatedSurplusCents: number;
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalNetAssetsCents: number;
  checkCents: number;
}

interface CashFlowData {
  openingCents: number;
  months: { month: string; inflowsCents: number; outflowsCents: number; netCents: number }[];
  categories: { label: string; inflowsCents: number; outflowsCents: number }[];
  closingCents: number;
  checkCents: number;
}

interface IncomeTrendData {
  months: { month: string; revenueCents: number; expenseCents: number; netCents: number }[];
  topRevenue: { account: string; cents: number }[];
  topExpense: { account: string; cents: number }[];
  totalRevenueCents: number;
  totalExpenseCents: number;
  netCents: number;
}

interface TrialBalanceData {
  items: { code: string; name: string; type: string; debitCents: number; creditCents: number }[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  checkCents: number;
}

interface FundsData {
  items: { fundId: string; name: string; type: string; revenueCents: number; expenseCents: number; balanceCents: number }[];
}

interface GivingData {
  items: { type: string; amountCents: number; count: number }[];
  totalCents: number;
  giftCount: number;
}

interface ReceiptsPaymentsData {
  openingBalanceCents: number;
  receipts: { category: string; amountCents: number }[];
  payments: { category: string; amountCents: number }[];
  totalReceiptsCents: number;
  totalPaymentsCents: number;
  closingBalanceCents: number;
}

interface FunctionalData {
  byFunctional: Record<string, number>;
  totalCents: number;
}

interface RemittancesData {
  destinations: { id: string | null; name: string | null; tier: string | null; grossBaseCents: number; accruedCents: number; paidCents: number; outstandingCents: number }[];
  totalAccruedCents: number;
  totalPaidCents: number;
  totalOutstandingCents: number;
}

interface PayrollRegisterRun {
  id: string;
  periodMonth: string;
  kind: string;
  kindLabel: string;
  description: string | null;
  status: string;
  grossCents: number;
  allowancesCents: number;
  bonusCents: number;
  payeCents: number;
  pensionCents: number;
  netCents: number;
  postedByName: string | null;
  postedAt: string | Date | null;
  lineCount?: number;
}

interface PayrollRegisterData {
  kinds: {
    kind: string; kindLabel: string; runs: number; payees: number;
    grossCents: number; allowancesCents: number; bonusCents: number;
    payeCents: number; pensionCents: number; netCents: number;
  }[];
  runs: PayrollRegisterRun[];
  totals: {
    grossCents: number; allowancesCents: number; bonusCents: number;
    payeCents: number; pensionCents: number; netCents: number;
  };
}

interface ReportDataMap {
  activities: ActivitiesData;
  position: PositionData;
  cash_flow: CashFlowData;
  income_trend: IncomeTrendData;
  trial_balance: TrialBalanceData;
  funds: FundsData;
  giving: GivingData;
  receipts_payments: ReceiptsPaymentsData;
  functional: FunctionalData;
  remittances: RemittancesData;
  payroll_register: PayrollRegisterData;
}

type ReportKey = keyof ReportDataMap;
type ReportData = ReportDataMap[ReportKey];

/**
 * Narrow the active report's union payload to its concrete shape.
 * Safe by construction: the endpoint (and therefore the server's response
 * shape) is chosen by `key`, and the query only ever holds the active report's
 * payload — this is the one cast point in the file.
 */
function dataOf<K extends ReportKey>(data: ReportData | undefined, key: K): ReportDataMap[K] | undefined {
  return data === undefined ? undefined : (data as ReportDataMap[K]);
}

// ── catalog ──────────────────────────────────────────────────────────────────

const REPORTS: Record<ReportKey, { label: string; blurb: string; icon: LucideIcon; period: "range" | "asOf" }> = {
  activities: { label: "Statement of Activities", blurb: "Revenue & expense by fund", icon: Scale, period: "range" },
  position: { label: "Statement of Financial Position", blurb: "Assets = Liabilities + Net assets", icon: Landmark, period: "asOf" },
  cash_flow: { label: "Cash Flow Statement", blurb: "Monthly cash in / out & closing", icon: Wallet, period: "range" },
  income_trend: { label: "Income Statement Trend", blurb: "Monthly performance & top accounts", icon: BarChart3, period: "range" },
  trial_balance: { label: "Trial Balance", blurb: "Debits vs credits across the GL", icon: BookOpenCheck, period: "asOf" },
  funds: { label: "Fund Balances", blurb: "Net position per restricted fund", icon: Coins, period: "asOf" },
  giving: { label: "Giving Breakdown", blurb: "Gifts by fund type (donations ledger)", icon: HeartHandshake, period: "range" },
  receipts_payments: { label: "Receipts & Payments", blurb: "Cash-basis opening → closing summary", icon: Briefcase, period: "range" },
  functional: { label: "Functional Expenses", blurb: "Program / admin / fundraising split", icon: Megaphone, period: "range" },
  remittances: { label: "Remittances", blurb: "Accrued, paid & outstanding per HQ tier", icon: Send, period: "range" },
  payroll_register: { label: "Payroll Register", blurb: "Posted payroll runs by kind", icon: Users, period: "range" },
};

const REPORT_GROUPS: { label: string; keys: ReportKey[] }[] = [
  { label: "Financial statements", keys: ["activities", "position", "cash_flow", "income_trend", "trial_balance"] },
  { label: "Giving & funds", keys: ["funds", "giving", "receipts_payments"] },
  { label: "Operations", keys: ["functional", "remittances", "payroll_register"] },
];

const FLOW_ENDPOINTS = {
  activities: "statement-of-activities",
  cash_flow: "cash-flow",
  income_trend: "income-trend",
  giving: "giving-breakdown",
  receipts_payments: "receipts-payments",
  functional: "functional-expenses",
  remittances: "remittances",
} as const satisfies Record<Exclude<ReportKey, "position" | "trial_balance" | "funds" | "payroll_register">, string>;

const FUNCTIONAL_LABELS: Record<string, string> = {
  program: "Program services",
  admin: "Management & general",
  fundraising: "Fundraising",
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-03" → "Mar 2025" (no Date object → no TZ/hydration surprises). */
function fmtMonth(month: string): string {
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_ABBR[idx] ?? m} ${y}`;
}

function endpointFor(key: ReportKey, from: string, to: string, asOf: string, payrollKind: string): string {
  if (key === "position") return `/reports/statement-of-financial-position${qs({ asOf })}`;
  if (key === "trial_balance") return `/reports/trial-balance${qs({ asOf })}`;
  if (key === "funds") return `/reports/fund-balances${qs({ asOf })}`;
  if (key === "payroll_register") {
    return `/reports/payroll-register${qs({ from, to, kind: payrollKind === "all" ? undefined : payrollKind })}`;
  }
  return `/reports/${FLOW_ENDPOINTS[key]}${qs({ from, to })}`;
}

// ── small presentational helpers ─────────────────────────────────────────────

/** Emerald when the book balances, rose with the exact gap when it doesn't. */
function CheckBanner({ okLabel, checkCents }: { okLabel: string; checkCents: number }) {
  if (checkCents === 0) {
    return (
      <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 p-2.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> {okLabel}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 rounded-md bg-rose-50 p-2.5 text-xs font-medium text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {okLabel.replace(/\s*✓$/, "")} — off by {fmtMoney(Math.abs(checkCents))}. Check for unbalanced or partial entries.
    </p>
  );
}

/** Thin proportion bar (pure div widths — no chart library). */
function MiniBar({ pct, tone }: { pct: number; tone: "positive" | "negative" }) {
  const width = Math.min(100, Math.max(pct > 0 ? 2 : 0, pct));
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={`h-full rounded-full ${tone === "positive" ? "bg-success" : "bg-danger"}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function EmptyPeriod() {
  return <EmptyState title="No transactions for this period yet" description="Try widening the date range, or post some receipts, vouchers or journal entries first." />;
}

/** Shared Card shell: title + period subtitle, loading / error / content. */
function ReportFrame({ title, meta, isLoading, isError, error, children }: {
  title: string; meta: string; isLoading: boolean; isError: boolean; error: unknown; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </CardHeader>
      <CardContent>
        {isLoading ? <LoadingBlock /> : isError ? <ErrorBlock error={error} /> : children}
      </CardContent>
    </Card>
  );
}

/** Right-aligned money cell. */
function Money({ cents, strong = false }: { cents: number; strong?: boolean }) {
  return <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{fmtMoney(cents)}</span>;
}

// ── report bodies ────────────────────────────────────────────────────────────

function ActivitiesBody({ data }: { data: ActivitiesData | undefined }) {
  if (!data) return null;
  if (!data.revenue.length && !data.expenses.length) return <EmptyPeriod />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total revenue" value={fmtMoney(data.totalRevenueCents)} icon={Scale} tone="positive" />
        <StatCard label="Total expenses" value={fmtMoney(data.totalExpenseCents)} icon={Wallet} tone="warning" />
        <StatCard label="Net surplus / (deficit)" value={fmtMoney(data.netCents)} icon={CheckCircle2} tone={data.netCents >= 0 ? "positive" : "negative"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Revenue by fund</h4>
          <ul className="divide-y rounded-lg border text-sm">
            {data.revenue.map((r) => (
              <li key={r.fundId} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">{r.fundName} <span className="text-xs capitalize text-muted-foreground">({r.fundType})</span></span>
                <Money cents={r.amountCents} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Expenses by fund</h4>
          <ul className="divide-y rounded-lg border text-sm">
            {data.expenses.map((e) => (
              <li key={e.fundId} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">{e.fundName}</span>
                <Money cents={e.amountCents} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function PositionBody({ data }: { data: PositionData | undefined }) {
  if (!data) return null;
  const columns: [string, PositionData["assets"]][] = [
    ["Assets", data.assets],
    ["Liabilities", data.liabilities],
    ["Net Assets", data.netAssets],
  ];
  if (!data.assets.length && !data.liabilities.length && !data.netAssets.length) return <EmptyPeriod />;
  return (
    <div className="space-y-4">
      <CheckBanner okLabel="Assets = Liabilities + Net Assets ✓" checkCents={data.checkCents} />
      <div className="grid gap-4 lg:grid-cols-3">
        {columns.map(([label, list]) => (
          <div key={label}>
            <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{label}</h4>
            <ul className="divide-y rounded-lg border text-sm">
              {list.map((x) => (
                <li key={x.code} className="flex justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">{x.code} · {x.name}</span>
                  <Money cents={x.balanceCents} />
                </li>
              ))}
              {label === "Net Assets" && data.undesignatedSurplusCents !== 0 ? (
                <li className="flex justify-between gap-3 px-3 py-1.5 font-medium">
                  <span>Undesignated surplus (unclosed)</span>
                  <Money cents={data.undesignatedSurplusCents} />
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
      <div className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-3">
        <div className="flex justify-between"><span className="text-muted-foreground">Total assets</span><Money cents={data.totalAssetsCents} strong /></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Total liabilities</span><Money cents={data.totalLiabilitiesCents} strong /></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Total net assets</span><Money cents={data.totalNetAssetsCents} strong /></div>
      </div>
    </div>
  );
}

function CashFlowBody({ data }: { data: CashFlowData | undefined }) {
  if (!data) return null;
  if (!data.months.length) return <EmptyPeriod />;
  const totalIn = data.months.reduce((a, m) => a + m.inflowsCents, 0);
  const totalOut = data.months.reduce((a, m) => a + m.outflowsCents, 0);
  return (
    <div className="space-y-4">
      <CheckBanner okLabel="Opening + Net movement = Closing ✓" checkCents={data.checkCents} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Opening balance" value={fmtMoney(data.openingCents)} icon={Wallet} />
        <StatCard label="Total inflows" value={fmtMoney(totalIn)} icon={HeartHandshake} tone="positive" />
        <StatCard label="Total outflows" value={fmtMoney(totalOut)} icon={Briefcase} tone="warning" />
        <StatCard label="Closing balance" value={fmtMoney(data.closingCents)} icon={CheckCircle2} tone={data.closingCents >= 0 ? "positive" : "negative"} />
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Monthly cash movement</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Inflows</TableHead>
              <TableHead className="text-right">Outflows</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="font-medium">{fmtMonth(m.month)}</TableCell>
                <TableCell className="text-right"><Money cents={m.inflowsCents} /></TableCell>
                <TableCell className="text-right"><Money cents={m.outflowsCents} /></TableCell>
                <TableCell className="text-right"><Money cents={m.netCents} strong /></TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-right"><Money cents={totalIn} strong /></TableCell>
              <TableCell className="text-right"><Money cents={totalOut} strong /></TableCell>
              <TableCell className="text-right"><Money cents={totalIn - totalOut} strong /></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {data.categories.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">What moved the cash</h4>
            <ul className="divide-y rounded-lg border text-sm">
              {data.categories.map((c) => (
                <li key={c.label} className="flex justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">{c.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {c.inflowsCents ? <span className="text-success">+{fmtMoney(c.inflowsCents)}</span> : null}
                    {c.inflowsCents && c.outflowsCents ? " · " : null}
                    {c.outflowsCents ? <span className="text-danger">−{fmtMoney(c.outflowsCents)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IncomeTrendBody({ data }: { data: IncomeTrendData | undefined }) {
  if (!data) return null;
  if (!data.months.length) return <EmptyPeriod />;
  const maxFlow = Math.max(1, ...data.months.map((m) => Math.max(m.revenueCents, m.expenseCents)));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total revenue" value={fmtMoney(data.totalRevenueCents)} icon={Scale} tone="positive" />
        <StatCard label="Total expenses" value={fmtMoney(data.totalExpenseCents)} icon={Wallet} tone="warning" />
        <StatCard label="Net surplus / (deficit)" value={fmtMoney(data.netCents)} icon={CheckCircle2} tone={data.netCents >= 0 ? "positive" : "negative"} />
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Monthly performance</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="font-medium">{fmtMonth(m.month)}</TableCell>
                <TableCell className="text-right">
                  <Money cents={m.revenueCents} />
                  <MiniBar tone="positive" pct={(m.revenueCents / maxFlow) * 100} />
                </TableCell>
                <TableCell className="text-right">
                  <Money cents={m.expenseCents} />
                  <MiniBar tone="negative" pct={(m.expenseCents / maxFlow) * 100} />
                </TableCell>
                <TableCell className="text-right"><Money cents={m.netCents} strong /></TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-right"><Money cents={data.totalRevenueCents} strong /></TableCell>
              <TableCell className="text-right"><Money cents={data.totalExpenseCents} strong /></TableCell>
              <TableCell className="text-right"><Money cents={data.netCents} strong /></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TopAccounts title="Top revenue contributors" items={data.topRevenue} tone="positive" />
        <TopAccounts title="Top expense drivers" items={data.topExpense} tone="negative" />
      </div>
    </div>
  );
}

function TopAccounts({ title, items, tone }: { title: string; items: { account: string; cents: number }[]; tone: "positive" | "negative" }) {
  const max = Math.max(1, ...items.map((i) => i.cents));
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</h4>
      {items.length === 0 ? (
        <p className="rounded-lg border px-3 py-4 text-center text-xs text-muted-foreground">None in this period.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {items.map((i) => (
            <li key={i.account} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{i.account}</span>
                <span className="shrink-0 font-medium tabular-nums">{fmtMoney(i.cents)}</span>
              </div>
              <MiniBar tone={tone} pct={(i.cents / max) * 100} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrialBalanceBody({ data }: { data: TrialBalanceData | undefined }) {
  if (!data) return null;
  if (!data.items.length) return <EmptyPeriod />;
  return (
    <div className="space-y-4">
      <CheckBanner okLabel="Total Debits = Total Credits ✓" checkCents={data.checkCents} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((t) => (
            <TableRow key={t.code}>
              <TableCell className="font-mono text-xs">{t.code}</TableCell>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell className="text-xs capitalize text-muted-foreground">{t.type}</TableCell>
              <TableCell className="text-right"><Money cents={t.debitCents} /></TableCell>
              <TableCell className="text-right"><Money cents={t.creditCents} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="font-semibold">Total</TableCell>
            <TableCell className="text-right"><Money cents={data.totalDebitsCents} strong /></TableCell>
            <TableCell className="text-right"><Money cents={data.totalCreditsCents} strong /></TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function FundsBody({ data }: { data: FundsData | undefined }) {
  if (!data) return null;
  if (!data.items.length) return <EmptyPeriod />;
  const totalRev = data.items.reduce((a, f) => a + f.revenueCents, 0);
  const totalExp = data.items.reduce((a, f) => a + f.expenseCents, 0);
  const totalBal = data.items.reduce((a, f) => a + f.balanceCents, 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fund</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">Expenses</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.items.map((f) => (
          <TableRow key={f.fundId}>
            <TableCell className="font-medium">{f.name}</TableCell>
            <TableCell className="capitalize text-muted-foreground">{f.type}</TableCell>
            <TableCell className="text-right"><Money cents={f.revenueCents} /></TableCell>
            <TableCell className="text-right"><Money cents={f.expenseCents} /></TableCell>
            <TableCell className="text-right"><Money cents={f.balanceCents} strong /></TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2} className="font-semibold">Total</TableCell>
          <TableCell className="text-right"><Money cents={totalRev} strong /></TableCell>
          <TableCell className="text-right"><Money cents={totalExp} strong /></TableCell>
          <TableCell className="text-right"><Money cents={totalBal} strong /></TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function GivingBody({ data }: { data: GivingData | undefined }) {
  if (!data) return null;
  if (!data.items.length) return <EmptyPeriod />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total given" value={fmtMoney(data.totalCents)} icon={HeartHandshake} tone="positive" />
        <StatCard label="Gifts" value={data.giftCount} icon={Download} />
      </div>
      <ul className="divide-y rounded-lg border text-sm">
        {data.items.map((g) => (
          <li key={g.type} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 capitalize">{g.type}</span>
            <span className="text-xs text-muted-foreground">{g.count} gifts</span>
            <span className="font-medium tabular-nums">{fmtMoney(g.amountCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReceiptsPaymentsBody({ data }: { data: ReceiptsPaymentsData | undefined }) {
  if (!data) return null;
  if (!data.receipts.length && !data.payments.length) return <EmptyPeriod />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Cash-basis summary — Opening Cash/Bank + Receipts − Payments = Closing. The #1 report Nigerian church boards and AGM members request.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Opening balance" value={fmtMoney(data.openingBalanceCents)} icon={Wallet} />
        <StatCard label="Total receipts" value={fmtMoney(data.totalReceiptsCents)} icon={HeartHandshake} tone="positive" />
        <StatCard label="Total payments" value={fmtMoney(data.totalPaymentsCents)} icon={Briefcase} tone="warning" />
        <StatCard label="Closing balance" value={fmtMoney(data.closingBalanceCents)} icon={CheckCircle2} tone={data.closingBalanceCents >= 0 ? "positive" : "negative"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Receipts</h4>
          <ul className="divide-y rounded-lg border text-sm">
            {data.receipts.map((r) => (
              <li key={r.category} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">{r.category}</span>
                <Money cents={r.amountCents} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Payments</h4>
          <ul className="divide-y rounded-lg border text-sm">
            {data.payments.map((p) => (
              <li key={p.category} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">{p.category}</span>
                <Money cents={p.amountCents} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function FunctionalBody({ data }: { data: FunctionalData | undefined }) {
  if (!data) return null;
  if (data.totalCents <= 0) return <EmptyPeriod />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Expense allocation by functional class — the Program / Admin / Fundraising split required for Charity &amp; CAC Incorporated Trustees governance reporting.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {["program", "admin", "fundraising"].map((k) => (
          <StatCard
            key={k}
            label={FUNCTIONAL_LABELS[k]}
            value={fmtMoney(data.byFunctional[k] ?? 0)}
            icon={k === "program" ? HeartHandshake : k === "admin" ? Briefcase : Megaphone}
            tone={k === "program" ? "positive" : "default"}
          />
        ))}
      </div>
      <ul className="divide-y rounded-lg border text-sm">
        {["program", "admin", "fundraising"].map((k) => {
          const v = data.byFunctional[k] ?? 0;
          const pct = data.totalCents > 0 ? Math.round((v / data.totalCents) * 100) : 0;
          return (
            <li key={k} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span>{FUNCTIONAL_LABELS[k]}</span>
                <span className="font-medium tabular-nums">{fmtMoney(v)} · {pct}%</span>
              </div>
              <MiniBar tone={k === "program" ? "positive" : "negative"} pct={pct} />
            </li>
          );
        })}
        <li className="flex justify-between px-3 py-2 font-semibold">
          <span>Total expenses</span>
          <span className="tabular-nums">{fmtMoney(data.totalCents)}</span>
        </li>
      </ul>
    </div>
  );
}

function RemittancesBody({ data }: { data: RemittancesData | undefined }) {
  if (!data) return null;
  if (!data.destinations.length) return <EmptyPeriod />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Period breakdown of gross income by fund, statutory % accrued, amount paid, and outstanding balance per HQ tier.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total accrued" value={fmtMoney(data.totalAccruedCents)} icon={Send} />
        <StatCard label="Total paid" value={fmtMoney(data.totalPaidCents)} icon={CheckCircle2} tone="positive" />
        <StatCard label="Outstanding" value={fmtMoney(data.totalOutstandingCents)} icon={Landmark} tone="warning" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Destination</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead className="text-right">Gross base</TableHead>
            <TableHead className="text-right">Accrued</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.destinations.map((d, i) => (
            <TableRow key={d.id ?? i}>
              <TableCell className="font-medium">{d.name}</TableCell>
              <TableCell className="text-xs capitalize text-muted-foreground">{d.tier}</TableCell>
              <TableCell className="text-right"><Money cents={d.grossBaseCents} /></TableCell>
              <TableCell className="text-right"><Money cents={d.accruedCents} /></TableCell>
              <TableCell className="text-right"><Money cents={d.paidCents} /></TableCell>
              <TableCell className="text-right"><Money cents={d.outstandingCents} strong /></TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2} className="font-semibold">Total</TableCell>
            <TableCell className="text-right">—</TableCell>
            <TableCell className="text-right"><Money cents={data.totalAccruedCents} strong /></TableCell>
            <TableCell className="text-right"><Money cents={data.totalPaidCents} strong /></TableCell>
            <TableCell className="text-right"><Money cents={data.totalOutstandingCents} strong /></TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function PayrollRegisterBody({ data }: { data: PayrollRegisterData | undefined }) {
  if (!data) return null;
  if (!data.kinds.length) return <EmptyPeriod />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Posted payroll runs for the period, separated by kind — Stipends, Staff Payroll and Honoraria each hit different GL expense accounts (5400 / 5410–5430 / 5300).
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kind</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">Payees</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Allowances</TableHead>
            <TableHead className="text-right">Bonus</TableHead>
            <TableHead className="text-right">PAYE</TableHead>
            <TableHead className="text-right">Pension</TableHead>
            <TableHead className="text-right">Net paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.kinds.map((k) => (
            <TableRow key={k.kind}>
              <TableCell className="font-medium">{k.kindLabel}</TableCell>
              <TableCell className="text-right tabular-nums">{k.runs}</TableCell>
              <TableCell className="text-right tabular-nums">{k.payees}</TableCell>
              <TableCell className="text-right"><Money cents={k.grossCents} /></TableCell>
              <TableCell className="text-right"><Money cents={k.allowancesCents} /></TableCell>
              <TableCell className="text-right"><Money cents={k.bonusCents} /></TableCell>
              <TableCell className="text-right"><Money cents={k.payeCents} /></TableCell>
              <TableCell className="text-right"><Money cents={k.pensionCents} /></TableCell>
              <TableCell className="text-right"><Money cents={k.netCents} strong /></TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell colSpan={2} />
            <TableCell className="text-right"><Money cents={data.totals.grossCents} strong /></TableCell>
            <TableCell className="text-right"><Money cents={data.totals.allowancesCents} strong /></TableCell>
            <TableCell className="text-right"><Money cents={data.totals.bonusCents} strong /></TableCell>
            <TableCell className="text-right"><Money cents={data.totals.payeCents} strong /></TableCell>
            <TableCell className="text-right"><Money cents={data.totals.pensionCents} strong /></TableCell>
            <TableCell className="text-right"><Money cents={data.totals.netCents} strong /></TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {data.runs.length ? (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Recent posted runs</h4>
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Payees</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{fmtMonth(r.periodMonth)}{r.description ? <span className="block text-xs text-muted-foreground">{r.description}</span> : null}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.kindLabel}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.lineCount ?? "—"}</TableCell>
                    <TableCell className="text-right"><Money cents={r.grossCents} /></TableCell>
                    <TableCell className="text-right"><Money cents={r.netCents} strong /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(r.postedAt)}{r.postedByName ? ` · ${r.postedByName}` : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── CSV export (client-side, one primary table per report) ───────────────────

function csvRows(selected: ReportKey, data: ReportData | undefined): string[][] | null {
  const n = (cents: number) => centsToNaira(cents);
  switch (selected) {
    case "activities": {
      const d = dataOf(data, "activities");
      if (!d) return null;
      return [
        ["Section", "Fund", "Fund type", "Amount (₦)"],
        ...d.revenue.map((r) => ["Revenue", r.fundName, r.fundType, n(r.amountCents)]),
        ...d.expenses.map((e) => ["Expense", e.fundName, "", n(e.amountCents)]),
        ["Net surplus / (deficit)", "", "", n(d.netCents)],
      ];
    }
    case "position": {
      const d = dataOf(data, "position");
      if (!d) return null;
      return [
        ["Section", "Code", "Account", "Amount (₦)"],
        ...d.assets.map((a) => ["Asset", a.code, a.name, n(a.balanceCents)]),
        ...d.liabilities.map((l) => ["Liability", l.code, l.name, n(l.balanceCents)]),
        ...d.netAssets.map((x) => ["Net asset", x.code, x.name, n(x.balanceCents)]),
        ["Undesignated surplus (unclosed)", "", "", n(d.undesignatedSurplusCents)],
        ["Total assets", "", "", n(d.totalAssetsCents)],
        ["Total liabilities", "", "", n(d.totalLiabilitiesCents)],
        ["Total net assets", "", "", n(d.totalNetAssetsCents)],
      ];
    }
    case "cash_flow": {
      const d = dataOf(data, "cash_flow");
      if (!d) return null;
      const totalIn = d.months.reduce((a, m) => a + m.inflowsCents, 0);
      const totalOut = d.months.reduce((a, m) => a + m.outflowsCents, 0);
      return [
        ["Month", "Inflows (₦)", "Outflows (₦)", "Net (₦)"],
        ["Opening balance", "", "", n(d.openingCents)],
        ...d.months.map((m) => [fmtMonth(m.month), n(m.inflowsCents), n(m.outflowsCents), n(m.netCents)]),
        ["Total movement", n(totalIn), n(totalOut), n(totalIn - totalOut)],
        ["Closing balance", "", "", n(d.closingCents)],
      ];
    }
    case "income_trend": {
      const d = dataOf(data, "income_trend");
      if (!d) return null;
      return [
        ["Month", "Revenue (₦)", "Expenses (₦)", "Net (₦)"],
        ...d.months.map((m) => [fmtMonth(m.month), n(m.revenueCents), n(m.expenseCents), n(m.netCents)]),
        ["Total", n(d.totalRevenueCents), n(d.totalExpenseCents), n(d.netCents)],
      ];
    }
    case "trial_balance": {
      const d = dataOf(data, "trial_balance");
      if (!d) return null;
      return [
        ["Code", "Account", "Type", "Debit (₦)", "Credit (₦)"],
        ...d.items.map((t) => [t.code, t.name, t.type, n(t.debitCents), n(t.creditCents)]),
        ["Total", "", "", n(d.totalDebitsCents), n(d.totalCreditsCents)],
      ];
    }
    case "funds": {
      const d = dataOf(data, "funds");
      if (!d) return null;
      return [
        ["Fund", "Type", "Revenue (₦)", "Expenses (₦)", "Balance (₦)"],
        ...d.items.map((f) => [f.name, f.type, n(f.revenueCents), n(f.expenseCents), n(f.balanceCents)]),
      ];
    }
    case "giving": {
      const d = dataOf(data, "giving");
      if (!d) return null;
      return [
        ["Fund type", "Amount (₦)", "Gifts"],
        ...d.items.map((g) => [g.type, n(g.amountCents), String(g.count)]),
        ["Total", n(d.totalCents), String(d.giftCount)],
      ];
    }
    case "receipts_payments": {
      const d = dataOf(data, "receipts_payments");
      if (!d) return null;
      return [
        ["Section", "Category", "Amount (₦)"],
        ["Opening balance", "", n(d.openingBalanceCents)],
        ...d.receipts.map((r) => ["Receipt", r.category, n(r.amountCents)]),
        ...d.payments.map((p) => ["Payment", p.category, n(p.amountCents)]),
        ["Closing balance", "", n(d.closingBalanceCents)],
      ];
    }
    case "functional": {
      const d = dataOf(data, "functional");
      if (!d) return null;
      const entries = ["program", "admin", "fundraising"].map((k) => [FUNCTIONAL_LABELS[k], n(d.byFunctional[k] ?? 0)] as string[]);
      return [["Functional class", "Amount (₦)"], ...entries, ["Total expenses", n(d.totalCents)]];
    }
    case "remittances": {
      const d = dataOf(data, "remittances");
      if (!d) return null;
      return [
        ["Destination", "Tier", "Gross base (₦)", "Accrued (₦)", "Paid (₦)", "Outstanding (₦)"],
        ...d.destinations.map((x) => [x.name ?? "", x.tier ?? "", n(x.grossBaseCents), n(x.accruedCents), n(x.paidCents), n(x.outstandingCents)]),
        ["Total", "", "", n(d.totalAccruedCents), n(d.totalPaidCents), n(d.totalOutstandingCents)],
      ];
    }
    case "payroll_register": {
      const d = dataOf(data, "payroll_register");
      if (!d) return null;
      return [
        ["Kind", "Runs", "Payees", "Gross (₦)", "Allowances (₦)", "Bonus (₦)", "PAYE (₦)", "Pension (₦)", "Net (₦)"],
        ...d.kinds.map((k) => [k.kindLabel, String(k.runs), String(k.payees), n(k.grossCents), n(k.allowancesCents), n(k.bonusCents), n(k.payeCents), n(k.pensionCents), n(k.netCents)]),
        ["Total", "", "", n(d.totals.grossCents), n(d.totals.allowancesCents), n(d.totals.bonusCents), n(d.totals.payeCents), n(d.totals.pensionCents), n(d.totals.netCents)],
      ];
    }
  }
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  // BOM so Excel renders ₦ and unicode correctly
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── main component ───────────────────────────────────────────────────────────

export function ReportsTab({ user }: { user: SessionUser }) {
  const year = new Date().getUTCFullYear();
  const [selected, setSelected] = useState<ReportKey>("activities");
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [payrollKind, setPayrollKind] = useState("all");

  const active = REPORTS[selected];
  const pointInTime = active.period === "asOf";
  const path = endpointFor(selected, from, to, asOf, payrollKind);
  const periodLabel = pointInTime ? `As of ${fmtDate(asOf)}` : `${fmtDate(from)} — ${fmtDate(to)}`;

  // Lazy fetching: the query key includes the selected report + its exact
  // params, so only the ACTIVE report is ever fetched; visiting another report
  // and coming back is served from TanStack cache (stale-while-revalidate).
  const reportQ = useQuery<ReportData, ApiError>({
    queryKey: ["report", selected, path],
    queryFn: () => api.get<ReportData>(path),
  });

  function exportCsv() {
    const rows = csvRows(selected, reportQ.data);
    if (!rows) return;
    const suffix = pointInTime ? asOf : `${from}_to_${to}`;
    downloadCsv(`${selected}-${suffix}.csv`, rows);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description="Board-ready financial statements and operational reports, generated live from the general ledger. Pick a report, set the period, then export to CSV or print to PDF."
      />

      {/* print-only letterhead (screen UI keeps its own chrome) */}
      <div className="hidden print:block">
        <p className="font-display text-xl font-bold">{user.orgName}</p>
        <p className="text-sm text-muted-foreground">{active.label} · {periodLabel}</p>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-end gap-3 no-print">
        {pointInTime ? (
          <div className="space-y-1.5">
            <Label htmlFor="rep-asof">As of</Label>
            <Input id="rep-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="rep-from">From</Label>
              <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-to">To</Label>
              <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
          </>
        )}
        {selected === "payroll_register" ? (
          <div className="space-y-1.5">
            <Label htmlFor="rep-kind">Payroll kind</Label>
            <Select value={payrollKind} onValueChange={setPayrollKind}>
              <SelectTrigger id="rep-kind" className="w-44" aria-label="Payroll kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                {Object.entries(PAYROLL_KIND_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!reportQ.data}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print / PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* catalog sidebar (desktop) */}
        <nav aria-label="Report catalog" className="hidden lg:block no-print">
          <div className="space-y-4">
            {REPORT_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.keys.map((key) => {
                    const r = REPORTS[key];
                    const isSel = selected === key;
                    const Icon = r.icon;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setSelected(key)}
                          aria-current={isSel ? "true" : undefined}
                          className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                            isSel ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isSel ? "" : "text-muted-foreground"}`} aria-hidden />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium leading-snug">{r.label}</span>
                            <span className="block text-xs leading-snug text-muted-foreground">{r.blurb}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/* report picker (mobile) + active report */}
        <div className="space-y-4">
          <div className="lg:hidden no-print">
            <Label htmlFor="rep-select" className="sr-only">Report</Label>
            <Select value={selected} onValueChange={(v) => setSelected(v as ReportKey)}>
              <SelectTrigger id="rep-select" className="w-full" aria-label="Report"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPORT_GROUPS.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.keys.map((key) => (
                      <SelectItem key={key} value={key}>{REPORTS[key].label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected === "activities" ? (
            <ReportFrame title={REPORTS.activities.label} meta={`${periodLabel} · Revenue and expense by fund`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <ActivitiesBody data={dataOf(reportQ.data, "activities")} />
            </ReportFrame>
          ) : null}
          {selected === "position" ? (
            <ReportFrame title={REPORTS.position.label} meta={`${periodLabel} · Snapshots assets, liabilities and net assets`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <PositionBody data={dataOf(reportQ.data, "position")} />
            </ReportFrame>
          ) : null}
          {selected === "cash_flow" ? (
            <ReportFrame title={REPORTS.cash_flow.label} meta={`${periodLabel} · Cash & bank movement per month`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <CashFlowBody data={dataOf(reportQ.data, "cash_flow")} />
            </ReportFrame>
          ) : null}
          {selected === "income_trend" ? (
            <ReportFrame title={REPORTS.income_trend.label} meta={`${periodLabel} · Monthly performance with top accounts`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <IncomeTrendBody data={dataOf(reportQ.data, "income_trend")} />
            </ReportFrame>
          ) : null}
          {selected === "trial_balance" ? (
            <ReportFrame title={REPORTS.trial_balance.label} meta={`${periodLabel} · Every active GL account, debits vs credits`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <TrialBalanceBody data={dataOf(reportQ.data, "trial_balance")} />
            </ReportFrame>
          ) : null}
          {selected === "funds" ? (
            <ReportFrame title={REPORTS.funds.label} meta={`${periodLabel} · Net position per fund`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <FundsBody data={dataOf(reportQ.data, "funds")} />
            </ReportFrame>
          ) : null}
          {selected === "giving" ? (
            <ReportFrame title={REPORTS.giving.label} meta={`${periodLabel} · From the donations ledger (authoritative for giving)`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <GivingBody data={dataOf(reportQ.data, "giving")} />
            </ReportFrame>
          ) : null}
          {selected === "receipts_payments" ? (
            <ReportFrame title={REPORTS.receipts_payments.label} meta={`${periodLabel} · Cash-basis receipts and payments`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <ReceiptsPaymentsBody data={dataOf(reportQ.data, "receipts_payments")} />
            </ReportFrame>
          ) : null}
          {selected === "functional" ? (
            <ReportFrame title={REPORTS.functional.label} meta={`${periodLabel} · Program / admin / fundraising allocation`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <FunctionalBody data={dataOf(reportQ.data, "functional")} />
            </ReportFrame>
          ) : null}
          {selected === "remittances" ? (
            <ReportFrame title={REPORTS.remittances.label} meta={`${periodLabel} · National / HQ remittance position`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <RemittancesBody data={dataOf(reportQ.data, "remittances")} />
            </ReportFrame>
          ) : null}
          {selected === "payroll_register" ? (
            <ReportFrame title={REPORTS.payroll_register.label} meta={`${periodLabel} · Posted payroll runs by kind`} isLoading={reportQ.isLoading} isError={reportQ.isError} error={reportQ.error}>
              <PayrollRegisterBody data={dataOf(reportQ.data, "payroll_register")} />
            </ReportFrame>
          ) : null}
        </div>
      </div>
    </div>
  );
}
