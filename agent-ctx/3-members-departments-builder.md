# Task 3 — Members CRM + Departments/Units builder

## Scope
Members CRM module + Departments/Units module — full CRUD UI components + REST API routes.

## Files created/replaced (6 total)
| File | Purpose |
|------|---------|
| `src/app/api/members/route.ts` | GET list (search/filter/pagination + stats) + POST create |
| `src/app/api/members/[id]/route.ts` | GET detail + PATCH (status history) + DELETE |
| `src/app/api/departments/route.ts` | GET list (scoped for dept_head) + POST create |
| `src/app/api/departments/[id]/route.ts` | GET detail + PATCH (fields + membership mgmt) + DELETE |
| `src/components/churchos/modules/members.tsx` | REPLACED placeholder — full Members CRM UI |
| `src/components/churchos/modules/departments.tsx` | REPLACED placeholder — Departments grid + manage dialog |

## API endpoints
All require auth + permission (`requirePermission`). All wrapped in `apiHandler`. Writes audited.

| Method | Path | Permission |
|--------|------|-----------|
| GET    | `/api/members?q=&status=&branchId=&page=&pageSize=` | members:view |
| POST   | `/api/members` | members:create (201) |
| GET    | `/api/members/[id]` | members:view (donations finance-gated) |
| PATCH  | `/api/members/[id]` | members:update (auto MemberStatusHistory) |
| DELETE | `/api/members/[id]` | members:delete |
| GET    | `/api/departments` | departments:view (scoped for dept_head) |
| POST   | `/api/departments` | departments:create (201) |
| GET    | `/api/departments/[id]` | departments:view |
| PATCH  | `/api/departments/[id]` | departments:update (addMemberId/removeMemberId/memberRole + fields) — scoped |
| DELETE | `/api/departments/[id]` | departments:delete |

## Key design decisions
1. **Membership management** is handled inside `/api/departments/[id]` PATCH via `addMemberId`/`removeMemberId`/`memberRole` — keeps within allowed file list (no separate `/api/departments/[id]/members` route).
2. **Member status history** auto-appended in a Prisma `$transaction` whenever `status` changes during PATCH.
3. **Finance-gated donations** in member detail: only returned when `can(role,'finance','view')`.
4. **Private notes** only returned to roles with `members:update` — never to plain `member` role.
5. **Scoped department_head** sees only their own department (verified 403 when attempting to PATCH another dept).
6. **Auto-generated memberId** (GCI/1000+N pattern) if not provided on create.
7. **CSV export** fetches page=1&pageSize=500 client-side and triggers a download blob.

## Verification results (HTTP codes)
- admin login: 200
- GET /api/members?page=1 → 200 (real data, stats present)
- GET /api/departments → 200 (6 seeded departments)
- POST /api/members (admin) → 201 (member created)
- POST /api/members (member role) → **403** ✓ (permission denied — critical test passed)
- GET /api/members/[id] → 200 (full detail)
- PATCH /api/members/[id] (status change) → 200 (statusHistory appended)
- GET /api/departments/dept-worship → 200 (head + memberships)
- PATCH /api/departments/dept-ushering {addMemberId, memberRole:"leader"} → 200
- dept_head login → 200; their GET /api/departments returns ONLY their own dept ✓
- dept_head PATCH /api/departments/dept-media → **403** "You can only update your own department." ✓
- DELETE /api/members/[id] → 200
- 404 for non-existent member → 404 ✓
- No errors/warnings in dev.log

## Lint
My 6 files lint cleanly — `bunx eslint <my files>` returned no output (no errors, no warnings).

NOTE: There is a pre-existing lint error in `src/components/churchos/app-shell.tsx:268` (from Task ID 1's foundation code: `react-hooks/static-components` — "Cannot create components during render"). This file is on the DO-NOT-MODIFY list, so I left it untouched. The full `bun run lint` will surface that one pre-existing error, but **none of my code** produces errors or warnings.

## Did NOT modify
- `prisma/schema.prisma`
- Any file in `src/lib/*`
- `src/components/churchos/app-shell.tsx`, `login-screen.tsx`, `module-registry.tsx`
- `src/components/churchos/modules/dashboard.tsx`
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- `src/app/api/auth/*`, `src/app/api/me/*`, `src/app/api/dashboard/*`

## What works end-to-end
- Full admin CRUD on members (create/edit/delete + status changes with history)
- Full admin CRUD on departments (create/edit/delete + roster management)
- Permission gating at API layer (403 for member role create, scoped dept_head access)
- Premium UI with loading skeletons, empty states, error states, debounced search, server-side pagination, responsive table → cards, color-coded badges, dialogs with forms, AlertDialog confirmations, toast feedback via sonner
- Member detail dialog with status timeline, finance-gated giving summary, private notes (role-gated)
- Department manage dialog with inline member search + add-to-roster + remove + role assignment
- CSV export
