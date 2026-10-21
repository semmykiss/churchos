# Task 10-B — Modules Visual Redesign (finance / reports / announcements / pastoral / documents)

**Agent:** Restyler B
**Task ID:** 10-B
**Task:** Apply the new premium SaaS design system (Linear/Stripe/Notion — navy + indigo + violet, Inter font) to 5 ChurchOS modules WITHOUT changing any functionality, API calls, permissions, or data flow. Match the visual language established by Task 10-A (members / departments / attendance / visitors / events) and the redesigned `dashboard.tsx`.

## Files changed (5 modules)
1. `src/components/churchos/modules/finance.tsx` (2,263 lines)
2. `src/components/churchos/modules/reports.tsx` (803 lines)
3. `src/components/churchos/modules/announcements.tsx` (846 lines)
4. `src/components/churchos/modules/pastoral.tsx` (1,378 lines)
5. `src/components/churchos/modules/documents.tsx` (696 lines)

## Work Log

### Read-first protocol
- Read `worklog.md` foundation + Task 10-A worklog + design system files: `globals.css`, `ui.tsx`, `dashboard.tsx`, `members.tsx` (pattern reference).
- Read all 5 module files fully before editing.

### documents.tsx
- Imported shared primitives `PageHeader, EmptyState, Toolbar, SectionCard`.
- Replaced ad-hoc header with `<PageHeader eyebrow="Resources" icon={FileText} ... />`.
- Notice card → `border-primary/30 bg-primary/5` (primary-tinted, prominent like dashboard hero). Icon tile gets `ring-1 ring-inset ring-primary/20`.
- Category stat tiles: `rounded-xl p-3.5 nums`.
- Filter bar wrapped in `<Toolbar>`; inputs `h-9`.
- Error/empty states → `<EmptyState>`.
- Document grid cards: `rounded-xl hover:shadow-premium-md hover:-translate-y-0.5 transition-all`; icon tile `ring-1 ring-inset ring-primary/15`; badges `text-[10px] font-medium`.
- **Access-level colors remapped per Task 10-B spec:** public=emerald, members=sky→indigo, staff=amber→violet, leaders=violet→amber, finance=orange→teal, pastoral=rose (kept). Lock icon on finance/pastoral.
- Upload dialog: `sm:max-w-[600px]`, scroll-thin; form labels `text-sm font-medium`; inputs `h-9`; file dropzone `rounded-xl`; helper text `text-xs text-muted-foreground`. Access-level explainer card prominent.

### announcements.tsx
- Imported shared primitives `PageHeader, StatCard, EmptyState, Toolbar, StatCardSkeleton`.
- Replaced ad-hoc header with `<PageHeader eyebrow="Communications" icon={Megaphone} ... />`. Tab triggers use `gap-1.5`.
- Removed local `StatMini` helper; replaced 4 KPIs with `<StatCard>` (primary/amber/emerald/rose — Total/Pinned/Published/Drafts). Loading uses `<StatCardSkeleton />`.
- Filter bar wrapped in `<Toolbar>`; inputs `h-9`.
- Error/empty states → `<EmptyState>`.
- Announcement cards: `rounded-xl hover:shadow-premium-md hover:-translate-y-0.5 transition-all`; pinned cards get `ring-1 ring-inset ring-amber-500/20`. Badges `text-[10px] font-medium`; audience badge uses semantic colors (all=emerald, members=indigo, department=violet, leaders=amber). Added relative-time stamp on each card (`nums`).
- Notification center: list items get `bg-primary/5` for unread + left-border `w-0.5 bg-primary` accent (per Task 10-B spec for unread state); read items dimmed via `opacity-70`. Unread count badge `nums`. Skeleton loaders `rounded-lg`.

### pastoral.tsx
- Imported shared primitives `PageHeader, StatCard, EmptyState, Toolbar, SectionCard, StatCardSkeleton, TableSkeleton`.
- Replaced ad-hoc header with `<PageHeader eyebrow="Confidential" icon={HeartHandshake} ... />`. Tab triggers `gap-1.5`.
- **Privacy notice:** `border-primary/30 bg-primary/5` (primary-tinted like dashboard hero, NOT rose). Icon tile `ring-1 ring-inset ring-primary/20`. Member-submission view also uses the primary-tinted privacy card.
- Removed local `StatMini`; 5 cases-tab KPIs + 3 prayer-tab KPIs replaced with `<StatCard>` (primary/rose/amber/emerald/rose, primary/rose/violet). Loading uses `<StatCardSkeleton />`.
- Filter bar wrapped in `<Toolbar>`; inputs `h-9`.
- Cases table: header row `bg-muted/30 hover:bg-muted/30 border-border/60`, TableHead `text-xs uppercase tracking-wide text-muted-foreground font-medium`, rows `hover:bg-muted/40 border-border/60`. Type icon tile `ring-1 ring-inset ring-primary/15`; member/memberId cells `nums`; priority/status badges `text-[11px] font-medium`; created-time cell `nums`.
- **Priority colors per Task 10-B spec:** urgent=rose, high=amber, normal=indigo (was sky), low=slate (was muted).
- Error/empty states → `<EmptyState>`.
- Case detail dialog: `sm:max-w-[600px]` scroll-thin; meta badges `text-[11px] font-medium`; member block `rounded-xl bg-muted/30`; description block `rounded-xl bg-card`; private notes block `rounded-xl border-rose-500/30 bg-rose-500/5` (rose = pastoral privacy, semantic).
- Prayer request cards: `rounded-xl`; private ones get `ring-1 ring-inset ring-violet-500/20`. Status badges `text-[11px] font-medium`.
- New case / prayer form dialogs: `sm:max-w-[500px]` / `sm:max-w-[600px]` scroll-thin; form labels `text-sm font-medium`; selects `h-9`.
- Switch toggles in `rounded-xl border border-border/60 p-3` containers.

### reports.tsx
- Imported shared primitives `PageHeader, EmptyState, Toolbar, SectionCard, TableSkeleton`.
- Replaced ad-hoc `Header` component with `<PageHeader eyebrow="Insights" icon={BarChart3} ... />`.
- Report cards grid: `rounded-xl hover:shadow-premium-md hover:-translate-y-0.5 transition-all`; icon tiles get `ring-1 ring-inset ring-{accent}-500/15`. Restricted cards (no permission) get `opacity-60`. Badges `text-[10px] font-medium`.
- CSV export button `variant="outline"` (per Task 10-B spec).
- Report dialog: `max-w-4xl lg:max-w-[1000px]` scroll-thin. Filters wrapped in `<Toolbar>`.
- Error/empty states → `<EmptyState>`.
- Report content: charts, KPI boxes, and tables wrapped in `<SectionCard>` (per Task 10-B spec).
- Local `StatBox` helper kept (different shape than `StatCard`) — refined to `rounded-xl nums`.
- Tables: header row `bg-muted/30 hover:bg-muted/30 border-border/60`, TableHead `text-xs uppercase tracking-wide text-muted-foreground font-medium`, rows `hover:bg-muted/40 border-border/60`, numeric cells `nums`.
- Removed unused `EmptyState` import and unused variables (no dead code).

### finance.tsx (largest module — 2,263 lines)
- Imported shared primitives `PageHeader, StatCard, EmptyState, Toolbar, SectionCard, StatusPill, StatCardSkeleton, TableSkeleton`.
- **Removed the local `StatCard` function** (would conflict with shared one). Now uses shared `<StatCard>` from `@/components/churchos/ui` everywhere with named accents.
- Replaced ad-hoc header with `<PageHeader eyebrow="Finance" icon={Wallet} ... />`. "Basic Tracking" notice badge kept prominent (`bg-amber-500/10 text-amber-700 border-amber-500/20` outline). Action buttons use `gap-2` (Export CSV / New Expense / New Donation).
- Tab triggers: `gap-1.5`.
- Member-only fallback: amber-tinted card with prominent `Info` icon tile (`ring-1 ring-inset ring-amber-500/20`).
- **StatusBadge helper reworked to use `<StatusPill tone="success|warning|danger|info|default">`** per Task 10-B spec. Tone map: pending=warning, confirmed/approved=success, paid=info, failed/rejected=danger, refunded=info.
- Overview tab: 4 `<StatCard>` KPIs (income=emerald, expenses=rose, net=primary/amber, pending=amber). Loading uses `<StatCardSkeleton />`.
- Trend chart + Top donors + Fund balances + Recent transactions all wrapped in `<SectionCard>` (per Task 10-B spec).
- Recent transactions: amount cells `nums`; transaction icon tiles `ring-1 ring-inset ring-{emerald,rose}-500/15`.
- Donations tab: filter bars wrapped in `<Toolbar>`; inputs `h-9`. Loading uses `<TableSkeleton rows={6} />`. Error/empty states → `<EmptyState>`.
- Donations table: header row `bg-muted/30 hover:bg-muted/30 border-border/60`, TableHead `text-xs uppercase tracking-wide text-muted-foreground font-medium`, rows `hover:bg-muted/40 border-border/60`. Date / reference / amount cells `nums`. Pagination spans `nums`.
- Donation detail dialog: `sm:max-w-[500px]`. Highlighted amount cell `text-base font-bold nums`.
- Donation form dialog: `sm:max-w-[500px]` scroll-thin; form labels `text-sm font-medium`; inputs `h-9`. Amount inputs get `nums`.
- Expenses tab: same filter/table patterns as donations.
- **Approve/Reject buttons per Task 10-B spec:** Approve = `variant="default"` `bg-emerald-600 text-white hover:bg-emerald-700` (green-ish default); Reject = `variant="outline"` `text-destructive hover:text-destructive`.
- Approve/Reject dialog: `sm:max-w-[500px]`. Approve confirm button `bg-emerald-600 text-white`; Reject confirm button `bg-destructive text-white`.
- Budgets tab: wrapped in `<SectionCard>` with header action (New Budget button). Budget cards `rounded-xl`; amounts `nums`.
- Budget form dialog: `sm:max-w-[500px]`. Inputs `h-9 nums`.
- Approvals tab: wrapped in `<SectionCard>` with prominent description. Empty state "All caught up!" uses emerald-tinted `CheckCircle2`. List items show category + high-value badges + amount (`nums`); approve/reject buttons get `gap-1` and same color treatment as expense tab.

### Cross-cutting design tokens applied (matched Task 10-A baseline)
- Card border `border-border/60`; card radius `rounded-xl`.
- Icon tiles: `bg-primary/10 text-primary` + `ring-1 ring-inset ring-primary/15` (primary) or `ring-1 ring-inset ring-{accent}-500/15` (colored).
- Clickable card hover: `hover:shadow-premium-md hover:-translate-y-0.5 transition-all`.
- Table header row: `bg-muted/30 hover:bg-muted/30 border-border/60`; TableHead `text-xs uppercase tracking-wide text-muted-foreground font-medium`; rows `hover:bg-muted/40 border-border/60`.
- Numeric cells: `nums` (tabular-nums).
- Status badges: `text-[10px]` or `text-[11px]` `font-medium`, semantic colors (emerald=success, rose=danger, amber=warning, indigo/violet/teal/slate for categorical).
- `<StatusPill>` used in finance for donation/expense statuses (success/warning/danger/info tones).
- Buttons with icons: `gap-2` (replaced `mr-1.5` pattern).
- Stat card accents (named): `primary | indigo | violet | teal | amber | rose | emerald`.
- Dialogs: `sm:max-w-[500px]` / `sm:max-w-[600px]` / `lg:max-w-[1000px]`; `max-h-[90vh] overflow-y-auto scroll-thin`; form labels `text-sm font-medium`; inputs `h-9`.
- Tabs: icon + `gap-1.5`.
- Loading states: shared `<StatCardSkeleton>` and `<TableSkeleton rows={6} />`.
- Error/empty states: shared `<EmptyState>` with optional retry action button.
- Privacy/confidential notices use `border-primary/30 bg-primary/5` (matches dashboard hero); provider/disclaimer notices use amber (`border-amber-500/30 bg-amber-500/5`).

### Hard rules respected
- No `fetch()` URL changed.
- No request/response payload shape changed.
- No permission checks (`can(role, ...)`) or role-based logic touched.
- No `useQuery`/`useMutation` keys or logic changed.
- No features removed (filters, search, pagination, CSV export, dialogs, CRUD, approve/reject, private notes, file upload/validation, notification center, tabs all intact).
- No new heavy libraries imported — only the already-existing `@/components/churchos/ui` shared primitives + `StatusPill` (already in ui.tsx).
- TypeScript types preserved verbatim.
- Did NOT modify: any API routes, `src/lib/*`, `prisma/*`, app-shell, registry, login, dashboard, providers, layout, globals.css, or any module outside the 5-file list.

## Stage Summary (verification results)
- `bun run lint` → **0 errors** (eslint exits clean).
- Dev server starts: "Ready in 646ms".
- Admin login → Dashboard renders, no errors.
- **Finance module:** heading "Finance & Giving" renders, 0 console errors, `/api/finance` 200.
- **Reports module:** heading "Reports & Analytics" renders, 0 console errors. Report dialog opens, "Membership Report" title renders, `/api/reports?type=membership` 200.
- **Announcements module:** heading "Communications" renders, 0 console errors, `/api/announcements?pageSize=100` 200.
- **Pastoral Care module:** heading "Pastoral Care" renders, 0 console errors, `/api/pastoral?pageSize=100` 200.
- **Documents module:** heading "Document Library" renders, 0 console errors, `/api/documents?pageSize=100` 200.
- Donations tab in finance loads with `/api/finance/donations?...` 200, no console errors.
- Mobile viewport (resized): responsive rendering, 0 console errors.
- Full-page + mobile screenshots saved to `/tmp/shots/modules-b.png` and `/tmp/shots/modules-b-mobile.png`.
- Final browser errors: **0**.
- dev.log: no warnings, no compile errors, all API calls 200.

## Result
All 5 modules now match the new premium Linear/Stripe/Notion-inspired design system: navy sidebar shell, indigo/violet brand accent, consistent `PageHeader` / `StatCard` / `EmptyState` / `Toolbar` / `SectionCard` / `StatusPill` primitives, clean tabular-nums tables, premium card hover shadows, semantic access-level badges (emerald/indigo/violet/amber/teal/rose), prominent privacy/notice cards, and accessible icon-button spacing — with zero impact on functionality, APIs, permissions, or data flow.
