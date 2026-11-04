# Task 3-d — Partner Tenants console upgrade (security audit)

Agent: partner-tenants · Files touched: ONLY `src/components/partner/partner-tenants.tsx` (591 → 1024 lines, full rewrite in place; default export signature unchanged: `PartnerTenants({ onManage }: { onManage: (licenseId: string) => void })`).

## What was implemented

### 1. URL-synced, debounced search + filters + pagination
- State: `searchInput` (immediate) → `search` (debounced 300ms), `statusFilter` ("all"), `page` (1-based), `pageSize` (10; options 10/25/50).
- On mount a single effect reads `#/partner/tenants?search=…&status=…&page=…` (parsed via `new URLSearchParams(window.location.hash.split("?")[1] ?? "")`) into state AND registers `hashchange`/`popstate` listeners that re-read (back/forward stays the source of truth). Status values are sanitized against the known filter list; page falls back to 1 when absent/invalid.
- A `useEffect` writes state back via `window.history.replaceState(null, "", `#/partner/tenants${qs({ search: search || undefined, status: statusFilter !== "all" ? statusFilter : undefined, page: page > 1 ? page : undefined })}`)`. `replaceState` fires no hashchange → no feedback loop.
- Debounce: a `committedSearchRef` distinguishes "user typed a new query" (→ `setSearch` + `setPage(1)`) from "state was restored from the hash" (→ no page reset, so a deep link to page 3 survives).
- Status filter changes reset page to 1 at the call site; pageSize change resets to 1 too.
- Query: `useApiQuery<PartnerTenantPage>(["partner","tenants",statusFilter,search,page,pageSize], `/partner/tenants${qs({ search, status: statusFilter, page, pageSize })}`, { placeholderData: keepPreviousData })` — `status=all` is passed through per contract; `keepPreviousData` removes flicker while paging. Empty state distinguishes "No churches match" (filters active) vs "No churches yet".

### 2. Table (md+) / stacked cards (<md)
- Table wrapper `hidden md:block` with `max-h-[62vh] overflow-auto scroll-slim`; columns Church / License / Seats / People / Expires / Status / Actions. Rows are NOT clickable (audit #20) — the church name is a real `<button type="button" className="text-left font-medium hover:underline focus-visible:ring-2 …">` opening the detail dialog; slug stays mono below it.
- License cell: `LicenseStatusBadge` + plan label + masked key line (`LicenseKeyLine`): mono masked `t.licenseKey` plus a small ghost icon Button (Copy) that POSTs `/partner/licenses/:licenseId/reveal-key`, copies the full key to the clipboard and toasts "Full key copied — reveal recorded on the audit trail." (clipboard failure fallback shows the key once in an info toast; 4xx → `err.message`). When there is no license (`!licenseKey && !licenseId`) the prior behavior is kept: a ghost "No license" affordance toasts info "No license yet — issue one from the tenant detail view."
- Actions cell: `TenantActionsMenu` (shared by table + cards) — DropdownMenu with MoreHorizontal trigger `aria-label="Actions for {name}"`: "Manage license" (disabled without `t.licenseId`, else `onManage(t.licenseId)` — the old two-request `onManageDetail` helper is deleted), "View details", separator, "Reactivate…" when suspended else "Suspend…", separator, "Delete…" (`text-danger focus:bg-danger-bg focus:text-danger`).
- Below md: stacked cards (`md:hidden`) with name button → detail, badges, seats/people, expiry + `DaysLeftBadge`, masked key line, and the same `TenantActionsMenu`.

### 3. Suspend/Reactivate — one shared ConfirmActionDialog
- Parent-level state `statusAction { id, name, mode }` renders `TenantStatusConfirmDialog` as a SIBLING of the detail dialog (stacks on top, closing it never closes the detail).
- Suspend: tone "destructive", title `Suspend {name}?`, description "Suspends the license and blocks all church sign-in until reactivated.", impacts ["Every user at this church loses access immediately", "The reason is stored on the partner and organization audit trails"], confirmLabel "Suspend church", reason { label: "Reason for suspension", minLength: 10, placeholder: "e.g. Invoice unpaid after 60 days" }. Reactivate: tone "default", "Restores sign-in and license validity.", reason minLength 10.
- `onConfirm` PATCHes `/partner/tenants/:id/status` with `{ status: "suspended"|"active", reason }`, toasts, `await qc.invalidateQueries({ queryKey: ["partner"] })`, closes. Errors toast `err.message`; dialog stays open for retry (ConfirmActionDialog blocks dismissal while busy).

### 4. CreateTenantDialog (no-password onboarding)
- `ownerPassword` removed entirely. `INITIAL_TENANT_FORM = { name, slug, plan: "growth", seats: "250", termMonths: "12", licenseStatus: "trial", ownerName, ownerEmail, notes }`.
- Plan Select is driven by `useApiQuery<{ plans: PartnerPlan[] }>(["partner","plans"], "/partner/plans")` — options `{label} — {fmtMoney(monthlyPriceCents)}/mo` (₦, kobo; no hardcoded prices). On plan change, if the seats field is untouched (`seatsTouchedRef`), the plan's `defaultSeats` is suggested.
- Seats number input 1..10000 with the project Input's `error` prop (aria-invalid + inline message); term Select 1/12/24/36; license-starts trial/active; owner name (autoComplete="name") + owner email (type email, autoComplete="email", both required); notes Textarea rows 2 maxLength 500; slug keeps the "Leave blank to auto-generate from the church name." helper and is lowercased/trimmed on submit.
- `const idemKey = useRef<string>(crypto.randomUUID())`; submit guarded by `if (busy) return;`; POST `/partner/tenants` with header `{ "Idempotency-Key": idemKey.current }` and body `{ name, slug?, plan, seats, termMonths, licenseStatus, notes?, owner: { name, email } }` (NO password).
- Success: toast `${name} onboarded — an invite link is ready to share.` with description `License key (shown once): {licenseKey}`, duration 15000, single action "Copy invite link" → `navigator.clipboard.writeText(window.location.origin + created.inviteLink)`. Then regenerate the idempotency key, reset the form, close, invalidate `["partner"]`.

### 5. DeleteTenantDialog — soft delete (was name-typed hard delete)
- `DeleteTenantDialog({ row, onClosed })` (row now non-null; mounted conditionally) queries `/partner/tenants/:id/delete-preview` (TenantDeletePreview imported from `@/lib/types`, local redeclaration removed; `enabled` no longer needed).
- Impacts: "Calculating impact…" while loading, then the five mandated lines (people/giving/users/documents + `{slug}.churchos.app released after the recovery window`).
- ConfirmActionDialog tone "destructive", title "Delete church tenant", JSX description `<b>{row.name}</b> is scheduled for permanent deletion…`, confirmLabel "Schedule deletion", `typedConfirm={{ expected: row.slug, label: `Type "${row.slug}" to confirm` }}`, reason minLength 10, busy-gated; `onConfirm` POSTs `/partner/tenants/:id/delete` body `{ confirmSlug: row.slug, reason }` → success toast `{name} scheduled for deletion. Recoverable until {fmtDateShort(recoverUntil)}.`, invalidate `["partner"]`, onClosed().

### 6. TenantDetailDialog (kept, adapted)
- Query/users/audit rendering kept (audit list + `scroll-slim` added to its scroll areas). License card shows `maskLicenseKey(data.license.key)` (masked even if the detail ever returned a full key); "Manage license" calls `onManage(data.license.id)` directly.
- Footer suspend/reactivate buttons now open the SHARED `TenantStatusConfirmDialog` via a new `onRequestStatus` prop (reason-gated, audited) instead of the old one-click `toggleStatus` PATCH; the pending-verification hint now uses semantic `text-warning` (was raw `text-amber-700`).

## Deviations + why
1. **Removed the page-out-of-bounds clamp effect** I initially added: the new `react-hooks/set-state-in-effect` rule (React Compiler lint) errors on synchronous `setState` in an effect body. The server contract clamps pagination; Prev stays enabled so an out-of-range page is always recoverable.
2. **`placeholderData: keepPreviousData`** on the list query (spec didn't mention it) — standard TanStack v5 pattern via the shared `useApiQuery` options passthrough; prevents the table flashing into `LoadingBlock` on every page/search change.
3. **No-license affordance rendered as a compact ghost button in the License cell** — the spec said "keep prior behavior: if no license, the License button toasts info…". Since the old inline "License" button no longer exists in the menu-driven design, the toast lives on the equivalent affordance in the same cell (and only in the `!licenseKey && !licenseId` case).
4. **Clipboard-failure fallback** on reveal (info toast showing the key once) — `navigator.clipboard` rejects in insecure contexts; without a fallback the reveal would be silently lost after being audited.
5. Hash restore is effect-based (per spec) rather than lazy `useState` initializers — avoids SSR/hydration questions entirely. `replaceState` writes happen before restore lands on the very first commit, but self-correct within the same frame.
6. Status-change toasts keep the previous copy ("… suspended — sign-ins blocked." / "… reactivated."); spec required a toast but not exact wording.

## Validation
- `bun run lint` → **0 errors, 5 warnings — all 5 pre-existing** (scripts/test-bootstrap.ts, crm-cards.tsx, crm-table.tsx, detail-sheet.tsx, upload-dialog.tsx). Zero findings in partner-tenants.tsx.
- `bunx tsc --noEmit` filtered → **no type errors in partner-tenants.tsx / confirm-action-dialog.tsx** (pre-existing repo errors are in unrelated scripts/accounting/examples files, untouched).
- `confirm-action-dialog.tsx` (parallel agent 3-a/3-b) landed mid-task; my usage matches its real contract exactly (`description: ReactNode`, trimmed reason to `onConfirm`, busy blocks dismissal, no auto-close → I close via `onClosed()` on success only).
- Dev server compiles clean (`dev.log`: Ready, GET / 200, no build errors). Dev server NOT run/relaunched by this agent.

## How to test
1. Open the Partner Console → Church tenants tab. Confirm the list renders from `GET /partner/tenants?search=&status=all&page=1&pageSize=10` and the URL hash becomes `#/partner/tenants` (no params on defaults).
2. Type in the search box → network request fires ~300ms after typing stops, page resets to 1, hash gains `?search=…`. Change status filter → same, with `?status=…`. Reload the page with `#/partner/tenants?search=new&page=2` → state restores from the hash (input filled, page 2), and back/forward updates the view.
3. Click a church NAME (not the row) → detail dialog opens; Tab-focus it — the button is keyboard reachable. Click the ⋯ menu: "Manage license" disabled iff the row has no licenseId (no extra request when enabled — license dialog opens straight away).
4. Copy-icon next to a masked key → clipboard gets the full key, toast "Full key copied — reveal recorded on the audit trail."; a `POST /partner/licenses/:id/reveal-key` audit row appears in the tenant's Recent activity.
5. ⋯ → Suspend… → confirm dialog demands a ≥10-char reason (counter shown); confirm → PATCH with reason, row badge flips to Suspended, entry appears in both audit trails. ⋯ → Reactivate… → same with tone=default.
6. Detail dialog footer: Suspend/Reactivate open the same reason-gated dialog on top of the open detail; closing the confirm keeps the detail open and its status badge updates after invalidation.
7. Onboard church: plans load from `GET /partner/plans` with ₦ prices (no $99/$249/$499 anywhere); picking a plan suggests its defaultSeats until you edit seats; seats outside 1–10000 show an inline error and block submit; there is NO password field. Submit → success toast with the one-time license key + "Copy invite link" action (copies `origin + inviteLink`); re-submitting after a simulated failure reuses the same `Idempotency-Key` (server dedupes); a new submission generates a fresh key.
8. ⋯ → Delete… → impacts list first shows "Calculating impact…", then the five concrete impact lines; confirm requires typing the SLUG (not the name) + a ≥10-char reason; success toast names the recovery date and the row disappears from the list (soft-deleted tenant detail now 404s; subdomain released after the window).
9. Resize below `md:` → rows render as stacked cards with the same actions and badges; pagination footer (total count, rows-per-page 10/25/50, Prev/Next) stays usable.
