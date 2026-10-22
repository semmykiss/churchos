# Task 21 — Restore member-isolation + module UI fixes

Agent: Architect (main)
Task: Restore the member-scoping + module-specific features lost during the prior refactor.
Scope: member directory + self-isolation, member personal finance view, member-own tasks,
member prayer submission, SelectItem value="" fixes, profile image upload serving fix,
DB-driven nav in app-shell, scrollable sidebar, profile image upload flow in Settings.

Lib layer was already restored by prior tasks (DB-driven permissions, memberId in AuthContext,
canAsync, partner lib, /api/me with permissions snapshot). Schema has all models. This task
restored the **member-isolation + module-specific behaviors** that consumed those primitives.

## Files changed (10 files)

### API routes
1. `src/app/api/members/route.ts` — rewrote GET to provide a BASIC directory view for
   member/guest (id/firstName/lastName/preferredName/photoUrl/status/dateJoined/branch/
   departments-only-name — phone/email/address/DOB/emergency/privateNotes/notes/
   weddingAnniversary/occupation/maritalStatus/householdId STRIPPED) and a FULL view for
   staff. Added filters: `departmentId`, `maritalStatus` (single/married/divorced/widowed/
   separated), `isWorker` (true=has dept membership, false=no dept), `gender`.
   POST unchanged (staff-only).
2. `src/app/api/members/[id]/route.ts` — GET now branches on role + self-link:
   member viewing own profile (`id === ctx.memberId`) → FULL detail; member viewing
   another member → BASIC directory info (NOT 403); staff → FULL detail for all.
3. `src/app/api/finance/route.ts` — member role now returns `{ isPersonalView: true,
   myDonations: { total, count, byFund[], last6months[] }, myTithes: { total, count,
   last6months[] } }` instead of 403. Staff unchanged. Uses `resolveSelfMemberId` via
   `ctx.memberId` (fallback to `account.id` relation).
4. `src/app/api/finance/donations/route.ts` — GET: member filtered by `memberId === selfId`;
   staff: optional `memberId` param + existing filters. POST: permission relaxed from
   `finance:create` → `finance:view` so members can submit. Member-submitted donations
   have `memberId` forced to their own + `status='pending'` (staff must approve); staff
   submissions follow original flow (default status `confirmed`).
5. `src/app/api/finance/tithes/route.ts` — POST permission relaxed from `finance:create`
   → `finance:view` so members can POST tithes. Member path already forced
   `status='pending'` (Task 20 wrote it that way). GET already filtered by own for
   members.
6. `src/app/api/tasks/route.ts` — GET list: added `assigneeId === ctx.user.id` filter for
   member role (sees own assignments only). TaskListItem now includes `labels`,
   `estimatedHours`, `loggedHours`, `parentTaskId`. POST: accepts `labels`,
   `estimatedHours`, `parentTaskId` (subtask support).
7. `src/app/api/tasks/[id]/route.ts` — full rewrite. `getScopedTask` now scopes members
   to `assigneeId === ctx.user.id` (404 if they try to access someone else's task, NOT
   403 — same pattern as member directory). GET response now includes `subtasks[]` (with
   resolved `assigneeName`) and `comments[]` (with `authorName`). PATCH accepts `labels`,
   `estimatedHours`, `loggedHours`.
8. `src/app/api/pastoral/prayer/route.ts` — full rewrite. Permission check now allows
   `pastoral:view` OR `pastoral:create` (members have only `create`). Members see own
   prayers + public (non-private) ones (`OR: [{ memberId: selfId }, { private: false }]`).
   Staff see all. Uses `ctx.memberId` (fallback to `account.id` relation).
9. `src/app/upload/[file]/route.ts` — changed `export const dynamic = 'force-static'`
   → `'force-dynamic'`. force-static 404s newly uploaded files because Next.js
   precompiles the route at build time and doesn't know about new files.

### UI components
10. `src/components/churchos/app-shell.tsx` — Sidebar now reads from
    `useAuth().permissions?.modules` (the DB-driven snapshot returned by /api/me),
    falling back to `visibleModules(user.role)` if the snapshot hasn't loaded yet.
    Sidebar nav switched from `<ScrollArea>` to native `overflow-y-auto` (so it
    scrolls naturally when the module list exceeds the viewport height — Radix
    ScrollArea has known issues with long lists inside fixed sidebars).
    TopBar dropdown now uses `canClient('settings','view')` and `canClient('audit','view')`
    (DB-driven) instead of `can(user.role, ...)` (code-matrix only). Removed the
    `ScrollArea` import + the `can` import.
11. `src/components/churchos/modules/pastoral.tsx` — fixed two `SelectItem value=""`
    occurrences (Radix Select rejects empty-string values → runtime crash):
    - Case detail dialog assignee Select: `value=""` → `value="__none"`, with the
      onValueChange handler mapping `__none` back to empty (which `updateAssignee`
      converts to null).
    - Case create dialog assignee Select: same fix.
    - Defensive: added `|| '?'` fallback to the member initials avatar in the case
      detail dialog (`data.member.name.split(' ').map(...).join('')` → `|| '?'`).
12. `src/components/churchos/modules/settings.tsx` — MyAccountSection now has a
    proper profile image upload flow:
    - Hidden `<input type="file">` + an "Upload photo" button.
    - On file select: client-side validate (image type, ≤5MB), show a local preview
      via `URL.createObjectURL` (instant, no network round-trip), then POST to
      `/api/profile/upload`. Returned URL is held in `pendingUploadUrl` state.
    - The "Save profile" button persists the avatar URL via PATCH `/api/profile`
      (no auto-save race: avatar URL is only written to the DB when the user clicks
      Save, not when the file is uploaded).
    - Reset button clears the pending upload + restores the persisted URL.
    - Avatar fallback uses `localPreview ?? avatarUrl` so the preview is shown
      immediately.
    - Imported `Upload` + `Loader2` icons from lucide-react and added `useRef`.

## What was restored
- **Member directory with PII isolation**: members see all org members' basic info
  (directory) but never phone/email/address/DOB/emergency/privateNotes/etc. — they
  no longer 403, they just get a restricted view.
- **Member self-detail**: members viewing their own profile get full detail
  (family, giving, tithes, etc.). Members viewing others get the directory view.
- **Member personal finance view**: `/api/finance` for members now returns
  `{ isPersonalView, myDonations: { total, count, byFund, last6months }, myTithes:
  { total, count, last6months } }` — no org-wide totals exposed.
- **Member own donations list + pending submission**: GET filtered to own; POST
  allowed with status forced to `pending`.
- **Member own tithes list + pending submission**: GET filtered to own (already
  done in Task 20); POST now allowed (was 403 — required `finance:create` which
  members lack).
- **Member own tasks**: GET `/api/tasks` filtered by `assigneeId === ctx.user.id`.
- **Task detail with subtasks + comments**: GET `/api/tasks/[id]` now includes
  `subtasks[]` (with resolved `assigneeName`) and `comments[]` (with `authorName`).
- **Member prayer submission + visibility**: GET `/api/pastoral/prayer` allows
  members (via `pastoral:create` permission); members see own prayers + public ones.
- **SelectItem value="" crash fix** in pastoral.tsx (two occurrences).
- **Uploaded file serving**: changed `force-static` → `force-dynamic` so newly
  uploaded profile images don't 404.
- **DB-driven nav visibility**: sidebar prefers `permissions?.modules` snapshot
  returned by /api/me (reflects custom roles + DB-edited permissions) over the
  code MATRIX.
- **DB-driven topbar dropdown gates**: uses `canClient('settings','view')` +
  `canClient('audit','view')` instead of the code-matrix `can(user.role, ...)`.
- **Scrollable sidebar**: replaced `<ScrollArea>` with native `overflow-y-auto`
  so the sidebar scrolls when the module list exceeds viewport height.
- **Profile image upload flow**: Settings → My Account now has an "Upload photo"
  button that previews locally + persists on Save profile (no auto-save race).

## Verification results

### Lint
`bun run lint` → **0 errors**.

### API (curl, member login as `member@gracechapel.org`):
- admin login: **200**
- member login: **200**
- member GET `/api/members?page=1`: **200** — 10 items / 78 total,
  `isDirectory=true`, first item has `phone=None` (stripped) + `email=None`
  (stripped), `firstName="Aisha"` (kept). ✅
- member GET `/api/finance`: **200** — `{ role:'member', isPersonalView:true,
  myDonations:{ total:146000, count:7, byFund:[...], last6months:[...] },
  myTithes:{...} }`. NOT 403. ✅
- member GET `/api/tasks`: **200** — 0 items / 0 total (member has no assigned
  tasks; correctly scoped to own assignments). ✅
- member GET `/api/pastoral/prayer`: **200** — returns prayer list (own + public). ✅
- member POST `/api/pastoral/prayer` `{request:'Pray for healing'}`: **201**. ✅
- member POST `/api/members` `{firstName:'X'}`: **403** ("Role 'member' cannot
  create on module 'members'."). ✅
- admin GET `/api/finance`: **200** — full aggregate (incomeThisMonth etc.). ✅

### Profile upload serving
- POST `/api/profile/upload` (test PNG): **201**, returns `{ url:'/upload/...',
  ok:true, size:70 }`.
- GET `/upload/profile-...-...png`: **200** (NOT 404 — force-dynamic fix works). ✅

### Member permission snapshot
`/api/me` for member role returns `permissions.modules` =
`['dashboard','members','departments','attendance','events','finance','announcements',
  'pastoral','tasks','documents','settings','search','celebrations','townhall']` —
DB-driven snapshot correctly populated.

### Browser sweep (admin)
All 8 modules render with **0 console errors** and **0 page errors**:
- Members | h1="Members" | errs=0
- Finance | h1="Finance & Giving" | errs=0
- Tasks | h1="Tasks & Approvals" | errs=0
- Pastoral Care | h1="Pastoral Care" | errs=0
- Access Control | h1="Access Control" | errs=0
- Settings | h1="Settings" | errs=0
- Celebrations | h1="Celebrations" | errs=0
- Town Hall | h1="Town Hall" | errs=0

### Browser sweep (member)
All 7 member-visible modules render with **0 console errors**:
- Members | h1="Members" | errs=0
- Finance | h1="Finance & Giving" | errs=0
- Tasks | h1="Tasks & Approvals" | errs=0
- Pastoral Care | h1="Pastoral Care" | errs=0
- Settings | h1="Settings" | errs=0
- Celebrations | h1="Celebrations" | errs=0
- Town Hall | h1="Town Hall" | errs=0

### dev.log
No errors, no warnings, no `⨯`, no `TypeError`. All API calls 200/201/403 as expected.

## Honest caveats
- Did NOT modify schema, lib/* (api.ts, permissions.ts, auth-store.ts, session.ts,
  partner.ts, db.ts, format.ts, password.ts, nav.ts), module-registry.tsx, or any
  module UI other than pastoral.tsx + settings.tsx (both listed in the task spec
  as in-scope).
- The `/api/access` route still uses the code MATRIX for the matrix viewer — that's
  intentional (the Access Control module surfaces the code MATRIX as the source of
  truth). DB-driven effective matrix is enforced server-side via `canAsync` in
  `requirePermission` (lib/api.ts).
- Member-scoped tasks list returns 0 items for the demo `member@gracechapel.org`
  because no Task has been assigned to that user — this is correct behavior (the
  scoping filter is `assigneeId === ctx.user.id`). To verify with data, an admin
  would need to assign a task to the member user.
- The pastoral cases GET route (`/api/pastoral`) still uses `requirePermission(
  'pastoral','view')` which 403s members — this is intentional. Members submit
  pastoral care requests via POST (`/api/pastoral`, `pastoral:create`) and prayer
  requests via `/api/pastoral/prayer` (which now allows view OR create). Members
  do NOT see the cases list (only pastors + super_admin do).
- Member marital-status / occupation / weddingAnniversary are surfaced to staff
  (in the full projection) but stripped from the member directory view — this is
  the intended scoping.
- The `tasks` API still requires `tasks:create` for POST (members lack it). The
  task spec didn't request member task creation, so this is unchanged.
