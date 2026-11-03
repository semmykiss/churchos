# Task 9-a — GLTab (General Ledger tab)

## Deliverable
- **File created:** `/home/z/my-project/src/components/app/accounting/gl-tab.tsx` (1152 lines) — the ONLY file touched.
- **Exported symbol:** `export function GLTab({ user, canManage }: { user: SessionUser; canManage: boolean })` (line 184). `SessionUser` imported from `@/lib/types`.
- **Style:** starts with `"use client"` (mirrors `vouchers-tab.tsx` line 1).

## Structure
| Component | Purpose |
|---|---|
| `GLTab` | Chart of Accounts section (search, show-archived Switch, per-type counts strip, 5 Card groups asset→expense, rows with restriction/class pills, edit/archive/restore/delete) + hosts dialogs |
| `JournalSection` | Journal KPIs (entries count, debits, credits, balanced check), JE table w/ chevron row expansion, reversal AlertDialog |
| `JournalRow` | Row + expandable line detail (account code+name w/ fallback lookup, fund name, debit/credit) |
| `ManualEntryDialog` | Date + memo + dynamic AccountSelect/MoneyInput line rows, Add line, live balanced totals strip, submit gated on balanced & ≥2 non-zero lines |
| `AccountDialog` | New/Edit account (code immutable on edit, functionalClass only for expense type) |
| `LedgerDrawer` | Sheet (sm:max-w-2xl), from/to date filters, opening/ending strip, running-balance table with JE reference column |
| Helpers | `errMsg`, `safeCents` (NaN-guard for MoneyInput emissions) |

## Endpoint wiring (all under /api/v1)
- `GET /accounts` — query key `["accounts"]` (via `useAccounts`-equivalent `useApiQuery`)
- `POST /accounts` `{ code, name, type, fundRestriction?, functionalClass? }`
- `PATCH /accounts/:id` — edit `{ name, type, fundRestriction, functionalClass?, description? }`; archive/restore `{ isActive: false|true }`; server ApiError (e.g. type-change rejection) surfaced via `toast.error(errMsg(e))`
- `DELETE /accounts/:id` — AlertDialog confirm; 409 server message shown in toast
- `GET /accounts/:id/ledger?from&to` — key `["account-ledger", accountId, from, to]`, built with `qs()`
- `GET /journal-entries?take=50` — key `["journal-entries"]`; `reference` rendered mono-prominent, `null → "—"`
- `POST /journal-entries/manual` — success toast: `Journal entry posted — balanced double entry recorded.`; invalidates `["journal-entries"]`, `["accounts"]`
- `POST /journal-entries/:id/reverse` `{ reason }` — mandatory Textarea; disabled when `reversedByEntryId` set or `sourceType === "reversal"`; invalidates both keys
- Extra display lookups: `["funds"]` (fund names in expanded lines), `["accounts"]` (account code/name fallback for lines lacking them)

## Helpers reused (accounting-shared.tsx)
`MoneyInput` (cents), `AccountSelect`, `KpiRow` (tones: default/positive/negative only), `StatusPill` (maps: SOURCE_PILL, JE_STATUS_PILL, ACCOUNT_STATUS_PILL, RESTRICTION_PILL, FUNC_CLASS_PILL). Also shared.tsx: `Section, EmptyState, LoadingBlock, ErrorBlock, useApiQuery`; lib: `api, ApiError, qs, fmtMoney, fmtDate`.

## UX details
- Toolbar counts per type; archived rows `opacity-60` + Restore, hidden unless "Show archived" Switch on
- Scroll containers: group tables & journal table `max-h` + `overflow-y-auto scroll-slim` (project's custom scrollbar utility), sticky `<TableHeader className="sticky top-0 bg-card">`
- Journal colSpan dynamic (9 with manage actions / 8 view-only); "(you)" marker in Created-by using `user.name`
- Reversal/delete use `ev.preventDefault()` on AlertDialogAction so the async completes before closing

## Verification
- `bunx tsc --noEmit | rg "gl-tab"` → **no matches (zero errors in this file)**; only pre-existing errors elsewhere (src/server/services/whatsapp/*)
- `bunx eslint src/components/app/accounting/gl-tab.tsx` → **clean, zero warnings**
- No blue/indigo primaries; pills use existing emerald/amber/sky/violet/rose/muted maps consistent with accounting-shared
