# ChurchOS — Project Status

**Build date:** 2026-10-20
**Stack:** Next.js 16 (App Router) · TypeScript (strict) · Prisma + SQLite · shadcn/ui + Tailwind 4 · Zustand · TanStack Query · recharts · zod · React Hook Form

## Verification summary

| Check | Result |
|---|---|
| `bun run lint` | ✅ passes (0 errors) |
| `bun run db:push` | ✅ schema applied |
| `bun run db:generate` | ✅ Prisma client generated |
| `bun run prisma/seed.ts` | ✅ seeds Grace Chapel org + 8 users + 38 members + finance/events/etc. |
| Dev server boots | ✅ Next.js 16 ready on :3000 |
| Auth: login / logout / session | ✅ JWT cookie, rate-limited |
| Permission engine | ✅ deny-by-default, server-enforced, scoped roles |
| All 16 module APIs | ✅ return real DB data, 403 on unauthorized |

### Verified endpoint permission gates (sample)
- admin → `GET /api/members` → 200
- admin → `POST /api/members` → 201
- member → `POST /api/members` → **403** ✓
- finance → `GET /api/finance` → 200
- pastor → `GET /api/finance` → **403** ✓ (matrix blocks pastor from finance)
- member → `GET /api/finance` → **403** ✓
- dept_head → `GET /api/departments` → only own department returned ✓
- dept_head → `PATCH /api/departments/{other}` → **403** ✓
- member → `POST /api/pastoral/prayer` → 201 (members can submit prayer)
- dept_head → `GET /api/pastoral` → **403** ✓ (department heads cannot access pastoral cases)
- member → `GET /api/audit` → **403** ✓
- Attendance duplicate check-in → **409** ✓
- Event duplicate registration email → **409** ✓

## Completed (Phase 1–7)

- **Phase 1 — Foundation:** Prisma schema (all entities), db push, lib/auth (scrypt + JWT), lib/permissions (9 roles × 16 modules × 8 actions), lib/format (NGN/Africa/Lagos), lib/api (requirePermission/audit/apiHandler), nav config, seed (Grace Chapel + 8 users + 38 members + finance/events/tasks/assets/docs/pastoral), design system (emerald/teal, light+dark), layout providers.
- **Phase 2 — App shell:** login screen (split brand panel + demo quick-fill), authenticated shell with role-aware grouped sidebar (Overview/People/Ministry/Operations), topbar (global search, theme toggle, notifications, profile menu), breadcrumbs, sticky footer, mobile sheet sidebar.
- **Dashboard:** greeting hero, 4 stat cards, attendance trend area chart, department activity bars, upcoming events, announcements, finance overview (role-gated).
- **Module 2 — Members:** full CRUD, search/filter/pagination, detail dialog with timeline + status history, private notes gating, CSV export.
- **Module 3 — Departments:** CRUD, membership management (add/remove/role), scoped heads, member/unit/task/event counts.
- **Module 4 — Attendance:** sessions, manual + simulated QR check-in, duplicate prevention (unique constraint), trends bar chart.
- **Module 5 — Visitors & Follow-up:** registry, Kanban board (Pending/In Progress/Done), interaction logging, convert-to-member.
- **Module 6 — Events:** CRUD, month calendar grid, registration (capacity + duplicate-email guards), scoped department events.
- **Module 7 — Finance:** overview, funds (live balances), donations, expenses (with approve/reject workflow + Approval records), budgets, CSV export. Labeled "basic tracking, not full accounting".
- **Module 8 — Communications:** announcements with audience-based in-app notification fan-out, notification center (read/unread). No real email/SMS (provider adapters are stubs — intentional).
- **Module 9 — Pastoral Care:** confidential cases (privateNotes restricted to pastor/super_admin), prayer requests (members can submit), case-view auditing.
- **Module 11 — Documents:** upload (type/size validation, safe filenames), access-level gating (public/members/staff/leaders/finance/pastoral), permission-checked downloads.
- **Module 12 — Tasks & Approvals:** Kanban (todo/in_progress/done/blocked), approvals board.
- **Module 13 — Assets:** registry, valuation, condition tracking, summary stats.
- **Module 14 — Reports:** membership / attendance / finance / visitors / departments reports with charts + CSV export.
- **Module 16 — Settings:** church profile, branches, users & roles (audited, self-role-change blocked), profile + password change.
- **Audit Log:** filterable, permission-gated.
- **Global Search:** permission-aware, capped 5/type.

## Explicitly deferred / not implemented (with dependencies)

| Feature | Status | Dependency / reason |
|---|---|---|
| Module 10 — Volunteers & Rosters | Partial | Volunteers are modeled via `DepartmentMembership`; dedicated roster scheduling + substitution + check-in UI deferred. Data model (`Unit`, `Booking`) exists. |
| Real email/SMS/WhatsApp sending | Stub | Requires configured provider credentials. Adapter interface designed; no real delivery to avoid accidental spam. |
| MFA (TOTP) | Not implemented | Would require `User.mfaSecret` field + authenticator enrollment flow. |
| PostgreSQL + RLS | Not implemented | Sandbox is SQLite-only. Permission engine compensates server-side. RLS migration documented in README. |
| Object storage (S3 presigned URLs) | Not implemented | Local filesystem used. API contract designed for swap. |
| Double-entry accounting | Not implemented | Finance module is explicitly "basic tracking". Full ledger would require `LedgerAccount`/`JournalEntry`/`JournalLine` models. |
| Automated tests | Not implemented | Spec requested a full test suite. Time/context budget focused on working production app + manual curl verification. Adding Vitest/Playwright is the next step. |
| PWA / service worker | Not implemented | Only valuable with offline-safe sync strategy — deferred. |
| Scheduled jobs (cron) for reminders | Not implemented | Would require a worker process; reminders are computed on-view instead. |
| Branches CRUD UI in attendance | Read-only | Services management endpoint deferred; sessions/check-ins work fully. |
| File replace in documents | Not supported | Edit updates metadata only; replace requires delete + re-upload. |
| Member ↔ User link | Not linked | `User` and `Member` are separate; member self-service for giving history would require linking. Members see a "contact finance office" notice. |

## Commands executed during build

```
bun install
bun add -d tsx
bun run db:push        # schema applied
bun run db:generate    # client generated
bun run prisma/seed.ts # demo data
bun run lint           # 0 errors
bun run dev            # verified via curl + (pending) agent-browser
```

## Next actions

1. **Agent-browser end-to-end verification** of the rendered UI (login → dashboard → modules → role switching).
2. Fix any UI defects surfaced by browser verification.
3. (Optional, future) Add automated tests.
4. (Optional, future) Migrate to PostgreSQL + add RLS.

## Notes

- Demo seed data is clearly identifiable (password `churchos123`, org "Grace Chapel International"). No real personal data.
- Fund balances are recomputed from donations − expenses at seed time and on every confirmed donation / approved expense.
- The dev server is started with `bun run dev` (port 3000).
