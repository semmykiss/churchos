# Task 10-A — Modules A Restyle (members / departments / attendance / visitors / events)

## Agent
Restyler A (visual redesign)

## Task
Apply the new premium SaaS design system (Linear/Stripe/Notion — navy + indigo + violet, Inter font) to 5 ChurchOS modules WITHOUT changing any functionality, API calls, permissions, or data flow. Use the shared primitives from `src/components/churchos/ui.tsx` (`PageHeader`, `StatCard`, `EmptyState`, `Toolbar`, `StatusPill`, `TableSkeleton`, `StatCardSkeleton`, `SectionCard`) and match the visual language of the redesigned `dashboard.tsx`.

## Files Changed (ONLY these 5)
- `src/components/churchos/modules/members.tsx`
- `src/components/churchos/modules/departments.tsx`
- `src/components/churchos/modules/attendance.tsx`
- `src/components/churchos/modules/visitors.tsx`
- `src/components/churchos/modules/events.tsx`

## Work Log — Per module

### members.tsx
- Imported shared primitives: `PageHeader`, `StatCard`, `EmptyState`, `Toolbar`, `TableSkeleton`, `StatCardSkeleton`.
- Replaced ad-hoc page header (icon tile + title + description + action buttons) with `<PageHeader eyebrow="People" icon={Users} ... />`. Buttons converted to `gap-2` icon pattern.
- Replaced 4 ad-hoc `StatMini` KPI tiles with `<StatCard>` using brand-aligned accents: `primary` (Total), `emerald` (Active), `violet` (Visitors — was `sky`, mapped to violet to match dashboard), `amber` (Follow-up). Loading state uses `<StatCardSkeleton />`.
- Wrapped filter bar contents in `<Toolbar>` (Card + CardContent p-4 outer preserved).
- Replaced table loading state with `<TableSkeleton rows={6} />`.
- Replaced error and empty states with `<EmptyState icon=... title=... description=... action=... />`.
- Refined table headers: `bg-muted/30 hover:bg-muted/30 border-border/60`, headers `text-xs uppercase tracking-wide text-muted-foreground font-medium`, row `hover:bg-muted/40 border-border/60`.
- Added `nums` (tabular-nums) to: Joined date cell, pagination "Showing X–Y of Z members" spans.
- Refined `StatusBadge` text: `text-[11px] font-medium` (was `text-[10px] uppercase tracking-wide`).
- Removed unused `StatMini` local helper.
- Refined `StatBox` (used in detail dialog): `rounded-xl`, `p-3.5`, `nums` on values.
- Updated `Edit` button + form submit button to `gap-2` icon pattern.

### departments.tsx
- Imported shared primitives; added `RefreshCw` to lucide imports (used by retry button).
- Replaced ad-hoc header with `<PageHeader eyebrow="People" icon={Network} ... />`.
- Wrapped search bar in `<Toolbar>`.
- Replaced error/empty states with `<EmptyState>`.
- Department cards: `rounded-xl`, `hover:shadow-premium-md hover:-translate-y-0.5 transition-all`. Icon tile gets `ring-1 ring-inset ring-black/5 dark:ring-white/10`. Brand color fallback changed from `#0d9488` (teal) → `#6366f1` (indigo) where a department has no `color` set.
- Manage dialog: dept icon tile gets `rounded-xl` + ring inset; dept color fallback indigo; stats grid uses `MiniStat` (rounded-xl, nums); `Edit` button + `Add` button use `gap-2`. Roster table headers `text-xs uppercase tracking-wide`, rows `hover:bg-muted/40`, role badge `text-[11px] font-medium`, Joined column `nums`. Recent task rows: `rounded-lg hover:bg-muted/30 transition-colors`, status badge `text-[10px]`.
- MiniStat helper: `rounded-xl`, added `nums` on value.
- Form dialog: `sm:max-w-[500px]` (was `sm:max-w-lg`). Submit button uses `gap-2`.

### attendance.tsx
- Imported shared primitives.
- Replaced ad-hoc header with `<PageHeader eyebrow="Ministry" icon={CalendarCheck} ... />`. "New Session" + "Record Attendance" buttons use `gap-2`.
- Tab triggers use `gap-1.5` (icon + label).
- Sessions tab: wrapped filter in `<Toolbar>`; replaced loading/error/empty with `<TableSkeleton>` / `<EmptyState>`.
- Sessions table: header row `text-xs uppercase tracking-wide`, `bg-muted/30 hover:bg-muted/30 border-border/60`; rows `hover:bg-muted/40 border-border/60`; service icon tile gets `ring-1 ring-inset ring-primary/15`; Date cell `nums`; Records badge `nums`.
- Trends tab: replaced 3 ad-hoc `StatMini` with `<StatCard>` (primary/emerald/amber); chart card padding `p-5`; Refresh button `gap-2`.
- Services tab: card padding `p-5`; loading skeletons `rounded-xl`; empty state `<EmptyState>`; service cards `rounded-xl hover:shadow-premium transition-shadow`; service-active badge `text-[11px] font-medium`; time/sessions count `nums`.
- Session detail dialog: register table headers `text-xs uppercase tracking-wide`, rows `hover:bg-muted/40`.
- Removed unused `StatMini` local helper.
- New Session dialog submit button uses `gap-2`.

### visitors.tsx
- Imported shared primitives.
- Replaced ad-hoc header with `<PageHeader eyebrow="People" icon={UserPlus} ... />`; Register Visitor button `gap-2`.
- Tab triggers `gap-1.5`.
- Visitors tab: replaced 4 `StatMini` with `<StatCard>` (primary/indigo/amber/emerald — Active changed from `sky` → `indigo`); wrapped search filter in `<Toolbar>`; replaced loading/error/empty with `<TableSkeleton>` / `<EmptyState>`.
- Visitors table: header row `text-xs uppercase tracking-wide`, rows `hover:bg-muted/40`; First Visit cell `nums`; Follow-up status badge `text-[11px] font-medium`; pagination spans `nums`.
- Follow-ups board: replaced 4 `StatMini` with `<StatCard>` (primary/amber/indigo/emerald — In Progress changed from `sky` → `indigo`); wrapped filter bar in `<Toolbar>` with `md:ml-auto` on action group; loading skeletons `rounded-xl`; error/empty `<EmptyState>`.
- List view table: header row + row hover polished, Due cell `nums`, Interactions cell `nums`, status badges `text-[11px] font-medium`.
- BoardColumn: cards `rounded-xl`, follow-up task cards `rounded-xl hover:border-primary/40 hover:shadow-premium transition-all`; count badge `text-[11px] nums`; due date `nums`; interactions `nums`; Log button `gap-1`; in-progress/done icon buttons get `aria-label`.
- Follow-up detail dialog: action buttons use `gap-2`.
- Visitor form + Log interaction dialog submit buttons use `gap-2`.
- Removed unused `StatMini` local helper.

### events.tsx
- Imported shared primitives.
- Replaced ad-hoc header with `<PageHeader eyebrow="Ministry" icon={CalendarDays} ... />`; New Event button `gap-2`.
- Wrapped search filter in `<Toolbar>`.
- EventsList: loading skeletons `rounded-xl`; error/empty states `<EmptyState>`.
- Event cards: `rounded-xl hover:shadow-premium-md hover:-translate-y-0.5 transition-all`. Event type/status badges `text-[10px] font-medium`. Times `nums`. Capacity/registrations `nums` (with full-state amber emphasis). View button `gap-2`.
- Calendar view: card padding `p-5`; weekday header `font-medium`; tile `rounded-lg`; day number `nums`; event time `nums`; "+N more" `nums`; prev/next buttons get `aria-label`.
- Event form dialog: submit button `gap-2`.
- Event detail dialog: Edit button `gap-2`; description block `rounded-xl`; Registrations header count `nums`; registrations table header row `text-xs uppercase tracking-wide`, rows `hover:bg-muted/40`; When column `nums`; Add registration button `gap-2`.
- Cancel event action button uses `gap-2`. Register sub-dialog submit button uses `gap-2`.

## Cross-cutting design tokens applied
- Card border: `border-border/60`.
- Card radius: `rounded-xl` on cards / tiles.
- Icon tiles: `bg-primary/10 text-primary` + `ring-1 ring-inset ring-primary/15` (where primary) or `ring-1 ring-inset ring-black/5 dark:ring-white/10` (where colored).
- Clickable card hover: `hover:shadow-premium-md hover:-translate-y-0.5 transition-all`.
- Table header row: `text-xs uppercase tracking-wide text-muted-foreground font-medium`.
- Table body row hover: `hover:bg-muted/40`.
- Numeric cells: `nums` (tabular-nums).
- Status badges: `text-[11px] font-medium` (semantically colored — emerald/amber/rose/indigo/violet preserved as status colors).
- Buttons with icons: `gap-2` (replaced `mr-1.5` pattern).
- Brand fallback color: indigo `#6366f1` (replaced previous teal `#0d9488`).
- Stat card accents (named): `primary | indigo | violet | teal | amber | rose | emerald`. Mapped legacy sky → indigo / violet for non-status accents.

## Hard rules respected
- No `fetch()` URL changed.
- No request/response payload shape changed.
- No permission checks (`can(role, ...)`) or role-based logic touched.
- No `useQuery`/`useMutation` keys or logic changed.
- No features removed (filters, search, pagination, CSV export, dialogs, CRUD all intact).
- No new heavy libraries imported (only the already-existing `@/components/churchos/ui` shared primitives).
- TypeScript types preserved verbatim.
- Did NOT modify: any API routes, `src/lib/*`, `prisma/*`, app-shell, registry, login, dashboard, providers, layout, globals.css, or any module outside the 5-file list.

## Stage Summary (verification)
- `bun run lint` → **0 errors** (eslint exits clean).
- Dev server starts (Ready in 1022ms).
- Admin login → Dashboard renders, no errors.
- Members module: heading "Members" renders, 0 console errors, `/api/members` 200.
- Departments module: heading "Departments & Units" renders, 0 console errors, `/api/departments` 200.
- Attendance module: heading "Attendance & Services" renders, 0 console errors, `/api/attendance` 200.
- Visitors module: heading "Visitors & Follow-up" renders, 0 console errors, `/api/visitors` 200.
- Events module: heading "Church Calendar" renders, 0 console errors, `/api/events` 200.
- Mobile viewport 390×844: Members module renders responsively, 0 console errors.
- Full-page + mobile screenshots saved to `/tmp/shots/modules-a.png` and `/tmp/shots/modules-a-mobile.png`.
- Final browser errors: **0**.
- dev.log: no warnings, no compile errors, all API calls 200.

## Result
All 5 modules now match the new premium Linear/Stripe/Notion-inspired design system: navy sidebar shell, indigo/violet brand accent, consistent PageHeader / StatCard / EmptyState / Toolbar primitives, clean tabular-nums tables, premium card hover shadows, and accessible icon-button spacing — with zero impact on functionality, APIs, permissions, or data flow.
