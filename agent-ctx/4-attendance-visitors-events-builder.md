# Task 4 — Attendance + Visitors/Follow-up + Events builder

## Scope
Three ChurchOS modules — Attendance, Visitors & Follow-up, Events — full CRUD UI components + REST API routes. Follows established patterns from Task 3 (Members + Departments).

## Files created/replaced (12 total)

| File | Purpose |
|------|---------|
| `src/app/api/attendance/route.ts` | GET sessions list (filter by serviceId/from/to) + stats endpoint (?stats=1) + POST create session OR check-in (action: 'session' \| 'checkin') |
| `src/app/api/attendance/[id]/route.ts` | GET session with records (member names) + DELETE session (cascade records) |
| `src/app/api/visitors/route.ts` | GET list (search + pagination + follow-up summary + stats) + POST create (optional initial follow-up) |
| `src/app/api/visitors/[id]/route.ts` | GET with follow-ups + PATCH (fields OR {action:'convert'} → creates member) + DELETE |
| `src/app/api/followups/route.ts` | GET list (filter by status/owner, owners side-channel) + POST create |
| `src/app/api/followups/[id]/route.ts` | GET with interactions + PATCH (fields OR {addInteraction:{method,notes}}) + DELETE |
| `src/app/api/events/route.ts` | GET list (filter by date range + department) + POST create (scoped dept_head forced to own departmentId) |
| `src/app/api/events/[id]/route.ts` | GET with registrations + PATCH + DELETE (cascade) |
| `src/app/api/events/[id]/register/route.ts` | POST register (capacity + duplicate-email guards) |
| `src/components/churchos/modules/attendance.tsx` | REPLACED placeholder — Sessions / Services / Trends tabs, session detail with check-in register (member/visitor/QR modes), recharts bar chart |
| `src/components/churchos/modules/visitors.tsx` | REPLACED placeholder — Visitors table + Follow-up Kanban board (Pending/In Progress/Done columns) + convert-to-member + log-interaction dialogs |
| `src/components/churchos/modules/events.tsx` | REPLACED placeholder — Upcoming / Calendar (date-fns month grid) / Past tabs, event cards with type+status badges, detail dialog with registrations + register sub-dialog |

## API endpoints (all require auth + permission via `requirePermission`, all wrapped in `apiHandler`, writes audited)

| Method | Path | Permission |
|--------|------|-----------|
| GET    | `/api/attendance?serviceId=&from=&to=&page=&pageSize=` | attendance:view |
| GET    | `/api/attendance?stats=1[&serviceId=]` | attendance:view (returns totals + trend for chart) |
| POST   | `/api/attendance` {action:'session', serviceId, date, notes?} | attendance:create (201) |
| POST   | `/api/attendance` {action:'checkin', sessionId, memberId?, visitorName?, checkInMethod} | attendance:create (201) — handles `@@unique([sessionId, memberId])` gracefully |
| GET    | `/api/attendance/[id]` | attendance:view (records with member names) |
| DELETE | `/api/attendance/[id]` | attendance:delete |
| GET    | `/api/visitors?q=&page=&pageSize=` | visitors:view (stats + follow-up summary) |
| POST   | `/api/visitors` {firstName, lastName, phone?, email?, referralSource?, createFollowUp?, ownerId?, dueDate?} | visitors:create (201) |
| GET    | `/api/visitors/[id]` | visitors:view (with follow-ups; notes role-gated) |
| PATCH  | `/api/visitors/[id]` {action:'convert'} | visitors:update → creates member (status 'new_convert'), or links if email already exists |
| PATCH  | `/api/visitors/[id]` {firstName?, lastName?, phone?, email?, address?, referralSource?, ...} | visitors:update |
| DELETE | `/api/visitors/[id]` | visitors:delete |
| GET    | `/api/followups?status=&ownerId=&page=&pageSize=` | followups:view (stats + owners list) |
| POST   | `/api/followups` {visitorId\|memberId, ownerId?, status?, dueDate?, notes?} | followups:create (201) |
| GET    | `/api/followups/[id]` | followups:view (interactions + visitor + member) |
| PATCH  | `/api/followups/[id]` {addInteraction:{method,notes}} | followups:update → logs interaction (auto-moves to in_progress if pending) |
| PATCH  | `/api/followups/[id]` {status?, ownerId?, dueDate?, notes?, outcome?} | followups:update |
| DELETE | `/api/followups/[id]` | followups:delete |
| GET    | `/api/events?from=&to=&departmentId=&status=&page=&pageSize=` | events:view (scoped dept_head sees only own) |
| POST   | `/api/events` {title, startDate, eventType?, venue?, capacity?, endDate?, status?, departmentId?} | events:create (201; scoped dept_head forced to own departmentId) |
| GET    | `/api/events/[id]` | events:view (with registrations) |
| PATCH  | `/api/events/[id]` | events:update (scoped dept_head verifies ownership) |
| DELETE | `/api/events/[id]` | events:delete |
| POST   | `/api/events/[id]/register` {name, email?, phone?} | events:view (handles `@@unique([eventId, email])` + capacity) |

## Key design decisions
1. **Single POST endpoint for attendance** with `action: 'session' | 'checkin'` discriminator — kept file count within allowed list.
2. **Check-in duplicate prevention** — server-side check using `findFirst` before insert + P2002 try/catch fallback. Returns 409 with `{error: 'Already checked in', duplicate: true}`. UI shows toast and does NOT crash.
3. **QR check-in** simulated via text input — frontend interprets token as memberId/email/name and looks up via `/api/members?q=`, picks exact memberId match (or first result), submits with `checkInMethod: 'qr'`. Server validates member belongs to org.
4. **Visitor → Member conversion** (`PATCH /api/visitors/[id]` with `{action:'convert'}`):
   - If visitor has email and a member with that email exists, **links** `convertedMemberId` instead of duplicating (audits `visitors.convert` with `linked: true`).
   - Otherwise creates new Member with `status: 'new_convert'`, auto-generates memberId (GCI/1000+N pattern), creates initial `MemberStatusHistory`. Double audit: `members.create` + `visitors.convert`.
5. **Follow-up interactions** — since `/api/followups/[id]/interactions` was NOT in allowed files, interactions are added via `PATCH /api/followups/[id]` with `{addInteraction: {method, notes}}`. Auto-promotes pending → in_progress when interaction is logged.
6. **Follow-up owner** — schema has no FK relation on `FollowUpTask.ownerId`, so I fetch the owner User separately (or via the side-channel `owners` list in the collection GET). The list endpoint returns `owner` resolved from a parallel `db.user.findMany` lookup.
7. **Sensitive notes restriction** — `FollowUpTask.notes` only returned when `can(role,'followups','update')`. `Visitor` notes inside follow-ups also gated.
8. **Scoped department_head for events** — POST forces `departmentId = ctx.departmentId` (ignores body); PATCH/DELETE verify ownership and return 403 otherwise. The events GET uses `OR: [{departmentId}, {departmentId: null}]` for scoped roles so they also see undepartmented events.
9. **Calendar tab** uses `date-fns` (`startOfMonth`, `endOfMonth`, `eachDayOfInterval`, `isSameDay`, `isSameMonth`, `addMonths`, `subMonths`) to render a 7-column month grid with events color-coded by type. Includes Today/prev/next navigation.
10. **Trends tab** uses `recharts` `BarChart` (single Bar colored via `var(--primary)`), 3 stat cards (total / avg / last session), data fetched from `/api/attendance?stats=1`.
11. **Events tab** filter — when searching with text, removes date filters to allow free text search across all events.

## Verification results (HTTP codes)

All from one bundled bash call:

- admin login: **200**
- GET /api/attendance → **200** (real seeded sessions: 4 services, ~12 sessions, 263 records)
- GET /api/attendance?stats=1 → **200** (totals: totalRecords=263, avgPerSession=22, lastSessionCount=22, trend[12])
- GET /api/visitors → **200** (8 seeded visitors with follow-up summary)
- GET /api/followups → **200** (8 tasks, owners resolved, stats: pending=2 / in_progress=3 / done=3)
- GET /api/events → **200** (5+ events with registration counts)
- POST /api/events (admin) → **201** (Test Event created)
- PATCH /api/followups/[id] {addInteraction:{method:'call',notes:'...'}} → **200** (interaction created)
- PATCH /api/visitors/[id] {action:'convert'} → **200** (memberId returned: GCI/1040)
- POST /api/events/[id]/register → **201** (registration created)
- POST /api/events/[id]/register (duplicate email) → **409** ✓ (correctly rejected)
- POST /api/attendance {action:'checkin', sessionId, memberId} → **201** (check-in recorded)
- POST /api/attendance {action:'checkin', sessionId, memberId} (duplicate) → **409** ✓ "Already checked in"
- POST /api/events (member role, body `{title:"X"}`) → **403** ✓ "Role 'member' cannot create on module 'events'."
- Home page (/) → **200** (22KB rendered with title "ChurchOS — Church Management System")
- No errors/warnings in dev.log

## Lint

All 12 files lint cleanly with zero errors via `bunx eslint`.

NOTE: There is a pre-existing lint error in `src/components/churchos/app-shell.tsx:268` from Task ID 1's foundation (`react-hooks/static-components`). That file is on the DO-NOT-MODIFY list and is not introduced by me.

## Did NOT modify
- `prisma/schema.prisma`
- Any file in `src/lib/*`
- `src/components/churchos/app-shell.tsx`, `login-screen.tsx`, `module-registry.tsx`
- `src/components/churchos/modules/dashboard.tsx`, `members.tsx`, `departments.tsx`
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- `src/app/api/auth/*`, `src/app/api/me/*`, `src/app/api/dashboard/*`

## What works end-to-end
- **Attendance**: full session lifecycle (create → check-in via member search / visitor name / QR token paste → delete) with graceful duplicate handling. Trends chart visualizes last 12 sessions per service.
- **Visitors**: register visitors, edit, delete, convert to members (with auto-linking on duplicate email). Follow-up tasks board (Kanban) with Pending/In Progress/Done columns, log interactions (call/sms/email/visit), mark done. Notes restricted to follow-ups:update roles.
- **Events**: create / edit / delete events, calendar month grid view, register attendees (with capacity + duplicate-email guards), cancel event (admin only), scoped department_head sees only own department events.

## Honest caveats
1. **Services tab** is mostly read-only — the task allowed files for `/api/attendance` only (no `/api/services` endpoint), so adding new services / editing service details isn't possible without breaking the file-scope contract. The "Add Service" button opens a dialog explaining this limitation; the active toggle is also informational only. The session/check-in flows work fully.
2. **FollowUpTask.ownerId** has no Prisma relation defined in the schema (it's just a `String?`). I fetch owners separately via a parallel `db.user.findMany` and join client-side. This is a workaround for the existing schema design — not introduced by me. If a future task adds the relation, the code can switch back to a Prisma `include`.
3. **QR check-in** is simulated — there is no real camera-scanning library in the stack, and we don't generate QR codes server-side. The user pastes a member ID / token, which is looked up via `/api/members?q=`. The first match (or exact `memberId` match if found) is used. This matches the spec's "simulated QR-assisted check-in" requirement.
4. **Member self-registration for events** — the API uses `events:view` permission (members have that), so a logged-in member can self-register. The spec said "public-ish, requires auth" — that's what we have. There's no separate unauthenticated registration path.
5. The `paginatedSessions` `total` count includes past sessions (no `from` filter) — that's by design so the Sessions tab shows history. The Trends tab uses its own `?stats=1` endpoint.
