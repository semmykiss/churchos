# Task ID 5 — Finance + Reports builder

## Agent
Finance + Reports builder (Task 5 of ChurchOS)

## Task
Build two ChurchOS modules — Finance & Giving (Module 7) and Reports & Analytics (Module 14) — full CRUD UI components + REST API routes following patterns from Tasks 1/3/4.

## Files created/replaced (11)
1. `src/app/api/finance/route.ts` — GET overview (4 stats + 6-month trend + funds + top donors + recent transactions). Member role blocked (403 "contact finance office").
2. `src/app/api/finance/funds/route.ts` — GET list + POST create (finance:manage).
3. `src/app/api/finance/donations/route.ts` — GET (filters: fundId, method, status, from, to, q) + POST (member-link lookup, fund-balance reconciliation in tx).
4. `src/app/api/finance/donations/[id]/route.ts` — GET + PATCH (status/amount changes reconcile fund balance) + DELETE (finance:update for non-confirmed, finance:manage for confirmed).
5. `src/app/api/finance/expenses/route.ts` — GET (filters: status, category, from, to, q) + POST (defaults pending; high-value flag for ≥100k NGN).
6. `src/app/api/finance/expenses/[id]/route.ts` — GET + PATCH (split: `action:'approve'|'reject'` requires finance:approve and creates Approval record in tx; field update requires finance:update; status change requires finance:approve) + DELETE (finance:update for pending, finance:manage for any).
7. `src/app/api/finance/budgets/route.ts` — GET list with computed actualIncome/actualExpense per fiscal year + utilization % + POST create.
8. `src/app/api/finance/export/route.ts` — GET CSV (donations or expenses) with date range, escaped cells, Content-Disposition; audits `finance.export`.
9. `src/app/api/reports/route.ts` — GET with `type=membership|attendance|finance|visitors|departments`. Gate: reports:view. Finance type additionally requires finance:view; visitors type requires visitors:view; top-attenders requires members:view.
10. `src/components/churchos/modules/finance.tsx` — Full Finance & Giving module UI with 5 tabs (Overview/Donations/Expenses/Budgets/Approvals), recharts AreaChart, dialogs, member-role restricted view.
11. `src/components/churchos/modules/reports.tsx` — Reports & Analytics module UI with 5 report cards (Membership/Attendance/Finance/Visitors/Departments), Dialog with date-range filters, charts, tables, CSV export.

## Verification (one bundled bash call, all passed)
- finance login: 200
- GET /api/finance → 200 (incomeThisMonth 2,769,000 NGN; 66 donations; 8 pending; 4 funds; top donors; trend)
- GET /api/finance/funds → 200 (4 funds with counts)
- GET /api/finance/donations → 200 (paginated + sum)
- POST /api/finance/donations → 201 (fund balance reconciled)
- POST /api/finance/expenses → 201 (pending status, needsApproval badge for ≥100k)
- PATCH /api/finance/expenses/[id] {action:'approve'} → 200 (status→approved, Approval record created)
- GET /api/reports?type=membership → 200 (40 members, byStatus/byBranch/byGender/newByMonth)
- GET /api/reports?type=attendance → 200 (12 sessions, 264 records, 22 avg, byService with sessions+records, trend, topAttenders)
- GET /api/reports?type=finance → 200 (totals 7.85M/1.65M, monthlyTrend, byFund, byCategory, topDonors)
- GET /api/finance/export?kind=donations → 200 (CSV with header + rows)
- member GET /api/finance → 403 ("Personal giving statements...")
- pastor GET /api/finance → 403 ("Role 'pastor' cannot view on module 'finance'." from permission matrix)
- No errors in dev.log

## Lint
My 11 files lint cleanly. Pre-existing `app-shell.tsx:268` (Task 1 foundation) lint error untouched.

## Honest caveats
1. **Member role**: Task said "for member role, show an empty-ish personal view with a notice." Per verification expectation "Expect: member & pastor GET /api/finance → 403", I throw ForbiddenError for member role on all finance GET endpoints. UI shows notice card.
2. **Fund balances**: Seed sets balance=0 and never updates them. New API-created confirmed donations DO increment balance correctly, but seeded funds display 0.
3. **DELETE permission gate**: Per task spec ("DELETE only if status !== 'confirmed' OR require can('finance','manage')"), I gate DELETE with `finance:update` (which finance_officer, church_admin, super_admin all have) and check status inside (confirmed/approved/paid items need finance:manage). The matrix's `finance:delete` action is effectively unused (no role has it).
4. **Attendance report groupBy**: Prisma SQLite doesn't support `_count: { records: true }` in groupBy. Switched to findMany + in-memory aggregation.
5. **CSV export capped at 5000 rows** to protect against runaway queries.
6. **Top donors**: Only confirmed donations aggregated; non-confirmed excluded.

## Did NOT modify
schema.prisma, any lib/*, app-shell, login-screen, module-registry, dashboard, members, departments, attendance, visitors, events, page.tsx, layout.tsx, globals.css, /api/auth, /api/me, /api/dashboard, other modules' API routes.
