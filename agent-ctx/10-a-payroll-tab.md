# Task 10-a — PayrollTab (new) + Vouchers-tab accountant CONFIRM gate (edit)

## Deliverables
- **File created:** `/home/z/my-project/src/components/app/accounting/payroll-tab.tsx` (873 lines)
- **File edited:** `/home/z/my-project/src/components/app/accounting/vouchers-tab.tsx` (404 lines, +21/−15 vs HEAD — includes a prior agent's pre-existing `ErrorBlock error=` fixes which I kept)
- No other files touched.

## A) payroll-tab.tsx
- **Exported symbol (exact per spec):** `export function PayrollTab({ user, canManage, canApprove }: { user: SessionUser; canManage: boolean; canApprove: boolean })`
- **Style:** NO `'use client'` directive (per task spec) — file is only imported from client components (AccountingModule graph). Same layout language as sibling tabs (pill sub-tabs, Section/EmptyState/LoadingBlock/ErrorBlock, overflow-x-auto tables).
- No `user`-unused lint issue: `user.name` powers the SoD hint in the run detail ("You submitted this run — separation of duties requires a different approver").

### Structure
| Component | Purpose |
|---|---|
| `PayrollTab` | Sub-tab pills **Runs** / **Staff profiles** + kind filter state |
| `RunsView` | KPI strip (Net payable this month · Pending approval · Approved awaiting post · Posted this year, computed over current kind filter), kind filter pills (All/Staff Payroll/Stipends/Honoraria), runs table (Period, Kind pill, Description, Gross, Allow., Bonus, Deductions=PAYE+Pension, **Net bold**, StatusPill via `PAYROLL_RUN_STATUS_LABELS`, compact Submitted/Approved/Posted names+dates, Actions), hosts detail/reject/post dialogs |
| `RunDetailDialog` | `["payroll-run", id]` query; lines table (payee, role, basic, allow., bonus, PAYE, pension, net, bank+••NUBAN) in `max-h-72 overflow-y-auto`; totals strip; timeline chips (Submitted/Approved/Posted — emerald done w/ name·`fmtDateTime`, dashed pending); rejectionNote banner; `JE {id}` badge when posted; per-status footer actions |
| `CreateRunDialog` | canManage only; `sm:max-w-3xl max-h-[85vh] overflow-y-auto`; month Input (`type="month"`, default YYYY-MM), kind Select, description, optional pay-from `BankAccountSelect`; "Load from staff profiles" checkbox list (query `["payroll-profiles"]` with `enabled: open`, filtered `isActive && category === kind`, toggling adds/removes prefilled rows); manual line editor (payee, role, MoneyFields Basic/Allowances/Bonus/PAYE/Pension, per-row Gross/Net, remove, Add row); live totals strip (Gross/Allowances/Bonus/PAYE/Pension/Net); submit disabled unless ≥1 line + month; NUBAN 10-digit guard |
| `ProfilesView` | `["payroll-profiles"]` table sorted by category→name: Payee(+bank ••nuban), Role, Category pill, Basic/Allow./Bonus/Deductions/Net, Active/Archived pill, Edit + Archive(PATCH `isActive:false`)/Restore actions (canManage) |
| `ProfileFormDialog`/`ProfileFormBody` | create/edit payee record (**no user creation**, personId omitted from UI): payeeName*, roleLabel, category Select, 5 MoneyFields, bankName, NUBAN (10-digit validation), active Switch; state initialized from props at mount via keyed inner body (React-compiler lint clean, no setState-in-effect) |
| Helpers | `n0` NaN→0 guard for MoneyInput emissions, `jePreview`, `KIND_DR_CODES` (payroll→5410/5420/5430, stipend→5400, honoraria→5300), `KIND_TONES`, `PROFILE_STATUS`, `TimelineChip` |

### Endpoint wiring (all under /api/v1, keys per spec)
- `GET /payroll/runs?kind={kind}` — `["payroll-runs", kind]` (key omitted when filter=All)
- `GET /payroll/runs/:id` — `["payroll-run", id]`, `enabled: !!id`
- `POST /payroll/runs` — lines `{payeeName, roleLabel?, basicCents, allowancesCents, bonusCents, payeCents, pensionCents, bankName?, nuban?}`; **409 month+kind duplicate surfaces server message** via `toast.error((e as ApiError).message || …)`; invalidates `["payroll-runs"]`
- `POST /payroll/runs/:id/submit` (canManage) — toast "Submitted for approval — approvers notified."
- `POST /payroll/runs/:id/approve` (canApprove) — server SoD error surfaced in toast
- `POST /payroll/runs/:id/reject` `{ note }` (canApprove) — mandatory-note AlertDialog ("Return run")
- `POST /payroll/runs/:id/post` `{ bankAccountId?, paymentRef? }` (canManage) — dialog shows JE preview text `Dr {5410/5420/5430|5400|5300} · Cr PAYE 2160 · Cr Pension 2165 · Cr Bank (net)` (Cr PAYE/Pension segments shown only when those totals > 0) + net payable + payee count
- `GET /payroll/profiles`, `POST /payroll/profiles`, `PATCH /payroll/profiles/:id` (edit & isActive archive/restore)
- All mutations invalidate `["payroll-runs"]`/`["payroll-run"]` (+ `["accounts"]`, `["journal-entries"]` on post); every mutation wrapped in try/catch + toast.error fallback

## B) vouchers-tab.tsx diff summary (minimal)
1. Header comment → "request → approve → **confirm** → pay".
2. Import: added `ShieldCheck`.
3. New `doConfirm(id)` → `POST /payment-vouchers/:id/confirm`, toast exactly **"Voucher confirmed — ready for disbursement."**, invalidates `["payment-vouchers"]` via existing `refresh()`.
4. Actions cell: `approved` + canManage → **Confirm** (outline, ShieldCheck); `confirmed` + canManage → **Disburse** (moved off `approved`). Approve/Reject/Void still gated to `pending_approval` + canApprove; all existing paths (reject, void, pay dialog, posted badge) untouched.
5. Copy updated to 3-gate flow: approve toast ("awaiting accountant confirmation"), create-dialog description, EmptyState description, pay-dialog description ("Accountant-confirmed voucher…"). Status pills already render "Confirmed — ready to pay" via `PV_STATUS_LABELS`.
6. KPI strip: relabelled "Approved — awaiting confirm", added "Confirmed — ready to pay" tile; tones normalized to valid `KpiRow` values (warning/default/violet/positive/negative) incl. pre-existing invalid `"amber"` in PettyCash fixed → `"warning"` (behavior identical, fixes a pre-existing TS error in this file).
7. `ErrorBlock` usages kept as `error=` prop (prior fix preserved).

## Verification
- `bunx tsc --noEmit 2>&1 | rg "payroll-tab|vouchers-tab"` → **no matches (both files strict-clean)**
- `bunx eslint src/components/app/accounting/payroll-tab.tsx src/components/app/accounting/vouchers-tab.tsx` → **clean** (one `react-hooks/set-state-in-effect` found and fixed by switching ProfileFormDialog to a keyed mount body)
- `bun run lint` (whole repo) → only pre-existing errors/warnings in `src/components/app/modules/people/crm/*` (not mine, untouched)
- Dev server: `dev.log` shows `✓ Compiled`, no errors
- No blue/indigo primary; money everywhere integer-kobo via MoneyField/n0 + `fmtMoney` display

## Note for integrators
`PayrollTab` is not yet imported anywhere (out of my scope). Wire it in AccountingModule's Payroll tab with:
`<PayrollTab user={user} canManage={canDo(user, "accounting.manage")} canApprove={canDo(user, "accounting.payroll.approve") || canDo(user, "accounting.manage")} />` (adjust permission keys to the backend's payroll approve permission).
