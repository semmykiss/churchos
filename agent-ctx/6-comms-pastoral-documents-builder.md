# Task ID 6 — Communications + Pastoral Care + Documents builder

## Agent
Communications/Announcements + Pastoral Care & Welfare + Documents/Media builder (Task ID 6).

## Task
Build three ChurchOS modules — Communications/Announcements (Module 8), Pastoral Care & Welfare (Module 9), Documents/Media (Module 11) — full CRUD UI components + REST API routes following the patterns established in Tasks 1/3/4/5.

## Work Log
- Read worklog.md (Task 1 foundation, Task 3 Members/Departments, Task 4 Attendance/Visitors/Events, Task 5 Finance/Reports patterns).
- Read reference files: src/app/api/members/route.ts, src/app/api/members/[id]/route.ts, src/lib/api.ts, src/lib/permissions.ts, src/lib/format.ts, src/lib/auth-store.ts, prisma/schema.prisma (Announcement, Notification, PastoralCase, PrayerRequest, Document models), src/lib/nav.ts.

### Announcements / Communications (Module 8)
- Created `/api/announcements/route.ts`: GET list (filter by audience + search + pagination + stats). For member role, fetches all published announcements then in-memory filters by audience relevance (all/members/leaders/department — resolves user's DepartmentMembership to allow dept-scoped announcements to be visible). For other roles, server-side Prisma filter. POST creates announcement + fans out Notification records for matching audience (all users / role=member users / role in [pastor,church_admin,super_admin,department_head] / users in dept + members in that department via email lookup). Returns `{...item, notificationsQueued: N}`. Audits `announcements.create` with recipient count.
- Created `/api/announcements/[id]/route.ts`: GET single announcement. PATCH updates title/body/audience/departmentId/published/pinned; when publishing for first time, sets publishedAt + fans out notifications. DELETE removes (audit). All org-scoped via `findFirst`.
- Created `/api/notifications/route.ts`: GET current user's notifications (unread first, then by date) with `unread` count. PATCH with `{id}` marks one read OR `{all:true}` marks all unread as read. Audited.

### Pastoral Care & Welfare (Module 9)
- Created `/api/pastoral/route.ts`: GET cases (filter by type/status/priority/assignedToId + search + pagination + stats). privateNotes stripped for non-pastor/super_admin roles. Audits `pastoral.case.view` on every list (privacy best practice). Also returns `staff` (org users with role in [pastor,super_admin,church_admin,department_head]) for the assignee dropdown. POST creates case — validates member and assignee. Audit `pastoral.case.create`.
  - NOTE: PastoralCase has no relation defined in schema for `assignedTo`. Resolved manually via additional `db.user.findMany` lookup keyed by `assignedToId`.
- Created `/api/pastoral/[id]/route.ts`: GET single case (privateNotes gated). PATCH supports status/priority/type/description/assignedToId updates + `appendNote` (timestamped + signed, only pastor/super_admin). DELETE (audit). Each GET audited as `pastoral.case.view`.
- Created `/api/pastoral/prayer/route.ts`: GET prayer requests. Member role auto-resolved via email→member lookup, only sees own. Pastor/super_admin sees all; private ones show submitter name only to pastor/super_admin (others see "Anonymous"). POST creates prayer request — resolves member from auth user's email; defaults `private:false`. Audits `pastoral.prayer.create`. PATCH with `{id, status}` updates status. Audit `pastoral.prayer.update`.

### Documents / Media (Module 11)
- Created `/api/documents/route.ts`: GET list filtered by what user can access (server-enforced ACCESS_MATRIX: super_admin sees all 6 levels, church_admin 5, pastor 5 (no finance), finance_officer 4, dept_head/assistant/unit_leader 3, member 2, guest 1). Filter by category/accessLevel/q + pagination + byCategory stats. POST handles multipart/form-data upload: validates file type (pdf/doc/docx/xlsx/pptx/txt/jpg/jpeg/png), size (≤10MB), saves to `/home/z/my-project/upload/<safe-name>` using node fs/promises (timestamped prefix + sanitized name), stores `fileUrl` (relative path) + `fileName` (original). Also blocks creating a doc with accessLevel higher than what the creator can access. Audits `documents.create`.
- Created `/api/documents/[id]/route.ts`: GET returns metadata; with `?download=1` reads file from disk, sets Content-Type by extension, Content-Disposition attachment, audits `documents.download`. PATCH updates title/description/category/accessLevel; bumps `version` on content change. DELETE removes record + unlinks file from disk (ignores ENOENT). Audits both. Access-level gate enforced server-side per-request.

### UI Module Components (3 files)
1. `src/components/churchos/modules/announcements.tsx` (REPLACED placeholder)
   - Header with "Communications" title + "New Announcement" button gated by `can(role,'announcements','create')`.
   - Notice banner: "Message delivery (email/SMS/WhatsApp) requires configured provider credentials. Announcements create in-app notifications only."
   - Tabs: Announcements | Notifications.
   - Announcements tab: 4 stat cards (Total/Pinned/Published/Drafts). Filter bar (search + audience select). Grid of cards (title, body preview 3-line clamp, audience badge, pinned badge, draft badge, published date, notificationsQueued count). Edit/delete for authorized roles. Form Dialog: title, body textarea, audience select (all/members/department/leaders), departmentId if department, pinned toggle, published toggle. Provider status note inside form.
   - Notifications tab: in-app notifications for current user (read/unread, sorted unread first). Mark all read button. Mark one read on click. Each notification shows title/message/timestamp via relativeTime + formatDateTime.

2. `src/components/churchos/modules/pastoral.tsx` (REPLACED placeholder)
   - Header "Pastoral Care" with privacy notice banner: "Confidential — restricted access. Case notes are visible only to authorized pastoral staff" + per-role hint about private notes access.
   - If role lacks `pastoral:view` (member, dept_head, finance_officer, etc.): shows MemberSubmissionView with two cards side-by-side:
     • "Submit a Prayer Request" — textarea + private toggle (default on) + submit button. Calls POST /api/pastoral/prayer.
     • "Request Pastoral Care" — type select (prayer/counselling/visitation/bereavement/hospital/welfare) + priority select + description textarea + submit button. Calls POST /api/pastoral.
   - If role has `pastoral:view` (pastor/super_admin/church_admin): Tabs: Cases | Prayer Requests.
     • Cases tab: 5 stat cards (Total/Open/In Progress/Resolved/Urgent). Filter bar (search + type + status + priority + New Case button for pastor+super_admin). Responsive table (type icon, member avatar+name+memberId, priority badge color-coded, status badge color-coded, assignee name, relativeTime created, actions dropdown). Detail Dialog: meta badges, member card, description, private notes (rose-tinted box for pastor/super_admin; EyeOff notice for others), status/assignee dropdowns (immediate-update pattern via useMutation), add-note textarea (only for pastor/super_admin). New Case form Dialog: member select + type + priority + description + assignee. Delete AlertDialog.
     • Prayer Requests tab: 3 stat cards (Total/Open/Private). Card grid showing each request with status badge, private badge, request text, submitter name (Anonymous if private + !canSeePrivate), relativeTime + formatDate, inline status Select for canUpdate. New Prayer Request form Dialog: textarea + private toggle.
   - privateNotes gating: `canSeePrivate = role === 'pastor' || role === 'super_admin'` (NOT just `pastoral:view`). church_admin has view but cannot see private notes.

3. `src/components/churchos/modules/documents.tsx` (REPLACED placeholder)
   - Header "Document Library" with "Upload Document" button gated by `can(role,'documents','create')`.
   - Notice: "Files are stored with access-level permissions. This sandbox stores file metadata; uploads write to local /home/z/my-project/upload with safe filenames + size validation (max 10MB)."
   - Category breakdown stats row (policy/template/minutes/form/report/resource counts).
   - Filter bar (search + category + access level + reset).
   - Card grid: title, version + updated relativeTime, file icon (FileImage/FileSpreadsheet/Presentation/FileType/File), category badge (color-coded), access level badge (color-coded; Lock icon for pastoral/finance), file extension badge, created date, Download button or "No file attached" notice. Edit (metadata only)/Delete in dropdown for authorized roles.
   - Upload Dialog: title, description, category, accessLevel, file input (drag-style box with allowed extensions hint, validates type+size on change), access-level explanation. Edit Dialog: same fields minus file (file replace not supported here — metadata-only).

### Patterns & quality bar
- All API routes wrapped in `apiHandler`, write ops audited via `audit(ctx, action, targetType, targetId, metadata)`. All API routes set `export const dynamic = 'force-dynamic'`. All routes org-scoped via `requirePermission` + ctx.organizationId.
- TanStack Query for all reads (`useQuery`) and writes (`useMutation` with `queryClient.invalidateQueries`). `sonner` toasts for feedback. `formatDate`/`formatDateTime`/`relativeTime`/`titleCase` from `@/lib/format`.
- Privacy: pastoral privateNotes strictly gated to pastor/super_admin only (even church_admin with `pastoral:view` is stripped). Documents access-level matrix enforced server-side via ACCESS_MATRIX map.
- Did NOT send real messages — provider adapters are stubs only. No external email/SMS/WhatsApp calls. Fan-out creates in-app Notification records only.
- shadcn/ui components throughout. Loading skeletons, empty states with retry, error states. Mobile-first responsive (sm/md/lg/xl breakpoints). Touch-friendly (≥44px targets on buttons).
- Lint: my 9 files lint cleanly with zero errors. Pre-existing app-shell.tsx:268 lint error (Task 1 foundation) untouched — outside my allowed file list.

## Stage Summary
- Files created/replaced (9 total):
  - `src/app/api/announcements/route.ts` (GET list, POST create + fan-out)
  - `src/app/api/announcements/[id]/route.ts` (GET, PATCH, DELETE)
  - `src/app/api/notifications/route.ts` (GET, PATCH mark read)
  - `src/app/api/pastoral/route.ts` (GET cases + POST create; staff side-channel)
  - `src/app/api/pastoral/[id]/route.ts` (GET, PATCH incl. appendNote, DELETE)
  - `src/app/api/pastoral/prayer/route.ts` (GET, POST, PATCH)
  - `src/app/api/documents/route.ts` (GET list, POST multipart upload)
  - `src/app/api/documents/[id]/route.ts` (GET metadata, GET ?download=1, PATCH, DELETE)
  - `src/components/churchos/modules/announcements.tsx` (REPLACED placeholder)
  - `src/components/churchos/modules/pastoral.tsx` (REPLACED placeholder)
  - `src/components/churchos/modules/documents.tsx` (REPLACED placeholder)

## Verification results
- pastor login: 200
- GET /api/announcements → 200 (real seeded data: Welcome to Grace Chapel, Midweek Bible Study, Youth Camp, Worship Team Rehearsal)
- POST /api/announcements {title, body, audience:all} → 201, notificationsQueued: 8 (all demo users)
- GET /api/notifications → 200, shows new notification
- GET /api/pastoral → 200, real seeded cases (6 cases) with member resolved + assignedTo resolved manually (since no schema relation). privateNotes: null in list (stripped for non-pastor roles if applicable).
- PATCH /api/pastoral/[id] {status:resolved} → 200
- PATCH /api/pastoral/[id] {appendNote:"Test private note"} → 200, privateNotes updated with `[2026-10-20T20:46:39.579Z] Pastor Samuel Adeyemi: Test private note from pastor`
- GET /api/pastoral/[id] → 200, privateNotes persisted
- GET /api/pastoral/prayer → 200, real seeded prayer requests
- POST /api/pastoral/prayer (as member) {request:"Pray for my family"} → 201, name="John Member", memberId=null (member has no member record)
- PATCH /api/pastoral/prayer {id, status:resolved} → 200
- dept_head (worship@) GET /api/pastoral → 403 "Role 'department_head' cannot view on module 'pastoral'." ✓
- member (member@) GET /api/pastoral → 403 ✓
- member POST /api/pastoral/prayer → 201 ✓
- GET /api/documents (admin) → 200, real seeded 6 documents
- POST /api/documents (admin, multipart with .txt file) → 201, fileUrl saved as `1792529155722_test-upload.txt`, fileName="test-upload.txt"
- GET /api/documents/[id] → 200 metadata + downloadUrl
- GET /api/documents/[id]?download=1 → 200, file content streamed
- PATCH /api/documents/[id] {accessLevel:leaders, description} → 200, version bumped to 2
- GET /api/documents/[id] as member (after accessLevel→leaders) → 403 "You do not have permission to access this document." ✓
- DELETE /api/documents/[id] → 200, file unlinked from /home/z/my-project/upload
- member GET /api/documents → 200 but only sees public + members access levels (staff/leaders/finance/pastoral filtered out server-side) ✓
- pastor (no documents:create) POST /api/documents → 403 ✓ (correct per matrix)
- No errors/warnings in dev.log

## Honest caveats
1. **Pastoral assignedTo relation missing in schema** — the `PastoralCase` model in `prisma/schema.prisma` has `assignedToId String?` but no `assignedTo User? @relation(...)` field. I CANNOT modify the schema (per task scope). So I resolve the assignee via an additional `db.user.findMany` query keyed by `assignedToId` and merge into the response. This is a one-shot lookup that batches all unique assigneeIds for the list response. Future schema work should add the relation for cleaner Prisma includes.
2. **File replace not supported in PATCH** — the edit dialog updates metadata only (title/description/category/accessLevel + version bump). Replacing the file would need either a separate PUT endpoint or extending PATCH to accept multipart; I kept PATCH JSON-only per the spec ("PATCH can update metadata/accessLevel"). File replacement can be done via delete+re-upload.
3. **Announcement fan-out is fire-and-forget** — Notifications are created in one `createMany` call. If the org has 10,000+ users, this could be slow. For a real church (<1k users typically), this is fine. No retry/queue mechanism for failed fan-out — the API returns `notificationsQueued: N` even if some inserts failed (errors caught + logged + `fanOutError:true` flag set in the response).
4. **Member prayer requests — submitter resolved via email** — when a member submits a prayer request, the API looks up their member record by `email == auth_user.email`. If they don't have a member record (e.g., the demo `member@gracechapel.org` user has no Member row in the seed), the prayer request is saved with `memberId: null` and `name: ctx.user.name` (fallback to user.name). Pastor sees all prayer requests in the pastor view.
5. **No real message sending** — provider adapters are stubs. The fan-out creates in-app Notification records only. The UI shows a notice banner explaining this. A real implementation would need a background job queue (BullMQ/Sidekiq-style) + provider credentials (SMTP, Twilio, WhatsApp Business API) — out of scope for this sandbox.
6. **church_admin can view cases but not edit** — per the permission matrix, church_admin has `pastoral: ['view']` only (no create/update/delete/assign). My UI correctly hides the New Case button and the update controls for church_admin. They can see the case list + descriptions but privateNotes are stripped server-side (only pastor/super_admin see them).
7. **Member-submission UI role gate** — the member-submission view is shown to ANY role that lacks `pastoral:view` (member, dept_head, dept_assistant, unit_leader, finance_officer, guest). Department heads explicitly have `pastoral: []` in the matrix, so they hit the submission view. Members have `pastoral: ['create']` so they can submit. Department heads don't have `pastoral: ['create']` in the matrix (matrix shows `pastoral: []` for them), so the submit buttons will be disabled for them in the UI (the form card has `opacity-60` when `enabled=false`). The forms still render so the UX explains what's possible — but the API will 403 if dept_head tries to submit. This is a known minor UX inconsistency that could be addressed by hiding the forms entirely for roles without create permission (kept visible for now to communicate the option).
8. **Document download URL is signed by cookie only** — no signed URL token, the download endpoint checks the session cookie + access level server-side then streams the file. For a production system you'd want signed URLs with expiry (e.g., S3 presigned URLs). For this sandbox, cookie-based auth + access-level gate is sufficient.
9. **Notifications don't auto-mark-read on link click** — clicking a notification's link navigates to `/announcements/[id]` (a route that doesn't exist as a separate page — would need a real Next.js page route). The notification remains unread until the user explicitly clicks the "Mark read" button. The UI currently shows the link as text only (not an actual anchor) to avoid broken routes. A future improvement would wire link click → mark read → navigate.
10. **Lint** — my 9 files lint cleanly with zero errors. The single pre-existing `app-shell.tsx:268` lint error (Task 1 foundation — react-hooks/static-components warning about dynamic component creation) is outside my allowed file list and was not introduced or modified by me.

## Did NOT modify
- prisma/schema.prisma, any lib/* (api.ts, permissions.ts, format.ts, auth-store.ts, db.ts, session.ts, password.ts, nav.ts), app-shell.tsx, login-screen.tsx, module-registry.tsx, dashboard.tsx, members.tsx, departments.tsx, attendance.tsx, visitors.tsx, events.tsx, finance.tsx, reports.tsx, page.tsx, layout.tsx, globals.css, /api/auth, /api/me, /api/dashboard, /api/members, /api/departments, /api/attendance, /api/visitors, /api/followups, /api/events, /api/finance, /api/reports, /api/audit, /api/profile, /api/search, /api/settings, /api/tasks, /api/assets.
