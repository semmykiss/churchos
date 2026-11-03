# Task 11-a — Accounting ReportsTab (modernized, lazy-loaded)

## Deliverable
- **File (exactly one new file, nothing else modified):** `src/components/app/accounting/reports-tab.tsx`
- **Export:** `export function ReportsTab({ user }: { user: SessionUser })` — drop-in replacement for the inline `ReportsTab` in `AccountingModule.tsx` (wire as `<ReportsTab user={user} />` in the `reports` TabsContent).
- **Line count:** 1161 lines.

## Architecture
- **Lazy fetching:** single `useQuery<ReportData, ApiError>` keyed `["report", selected, path]` where `path = endpointFor(selected, from, to, asOf, payrollKind)`. Only the ACTIVE report's endpoint is ever fetched; switching back is served from TanStack cache. (Task allowed either `enabled` flag or keyed-query pattern; used the keyed pattern.)
- **Typing:** `ReportDataMap` maps each report key → its response interface (mirrors server shapes exactly, read from `accounting.ts` / `payroll.ts` services). One documented cast point: `dataOf<K>(data, key)` narrows the union per selected key — zero `any`.
- **UI:** `PageHeader` + print-only letterhead (`hidden print:block` shows org name/report/period); toolbar (`no-print`) with per-report period controls (from/to for flow reports, asOf for position/trial-balance/funds, extra Payroll-kind Select for payroll_register), Export CSV (client-side, `centsToNaira` values, BOM for Excel) and Print (`window.print()`); grouped sidebar catalog on ≥lg (icon + name + blurb, `bg-primary/10` selected state), grouped `Select` on <lg; `ReportFrame` Card shell handles LoadingBlock/ErrorBlock per report.
- **Balance checks:** `CheckBanner` — emerald `CheckCircle2` when `checkCents === 0`, rose `AlertTriangle` "off by fmtMoney(|checkCents|)" otherwise. Used on position, cash_flow, trial_balance.
- **Empty states:** `EmptyState` "No transactions for this period yet" whenever a report's primary dataset is empty.
- **Bars:** `MiniBar` div-width visualization (pct of max) for income-trend monthly revenue/expense cells and top-contributor lists, and functional-expenses split — no chart library.
- Long lists (payroll recent runs) wrapped in `max-h-96 overflow-y-auto`; all tables horizontal-scroll via ui/table container.

## Catalog keys → endpoints
| key | endpoint | period |
|---|---|---|
| `activities` | `/reports/statement-of-activities?from&to` | range |
| `position` | `/reports/statement-of-financial-position?asOf` | asOf |
| `cash_flow` (NEW) | `/reports/cash-flow?from&to` | range |
| `income_trend` (NEW) | `/reports/income-trend?from&to` | range |
| `trial_balance` | `/reports/trial-balance?asOf` | asOf |
| `funds` | `/reports/fund-balances?asOf` | asOf |
| `giving` | `/reports/giving-breakdown?from&to` | range |
| `receipts_payments` | `/reports/receipts-payments?from&to` | range |
| `functional` | `/reports/functional-expenses?from&to` | range |
| `remittances` | `/reports/remittances?from&to` | range |
| `payroll_register` (NEW) | `/reports/payroll-register?from&to&kind` | range |

Groups: Financial statements (activities, position, cash_flow, income_trend, trial_balance) · Giving & funds (funds, giving, receipts_payments) · Operations (functional, remittances, payroll_register). All routes confirmed present in `src/server/api/routes/accounting.ts` (permission `accounting.view`).

## Verification
- `bunx tsc --noEmit | rg "reports-tab"` → **clean** (remaining project tsc errors are pre-existing in `src/server/services/whatsapp/*`, untouched).
- `bun run lint | rg "reports-tab"` → **clean** (3 pre-existing warnings in crm virtualizer files only).
- No new dependencies; imports limited to existing ui/shared/lib modules.
- Note for wiring agent: old inline `ReportsTab` (AccountingModule.tsx ~L1209–1608) + its unused icon imports (Scale, CheckCircle2, Megaphone, HeartHandshake, Briefcase used elsewhere too — check) can be removed when wiring this in; component expects the `user` prop.
