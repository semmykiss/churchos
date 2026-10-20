# ChurchOS — Church Management System

A complete, secure, role-based church operations platform built with Next.js 16, TypeScript, Prisma, and shadcn/ui. Covers membership CRM, departments, attendance, services, visitors/follow-up, events, finance/giving, communications, pastoral care, tasks/approvals, assets, documents, reports, audit, settings, and a permission-aware global search — all gated by a server-enforced role-based access control engine.

> **Status:** Working application with real database-backed CRUD. Demo seed data included. See `PROJECT_STATUS.md` for what is implemented vs. explicitly deferred.

---

## Assumptions & adaptations

The original specification requested **Supabase / PostgreSQL**. This build environment is restricted to **Prisma + SQLite**. To deliver a genuinely working application (not a mockup), the stack was adapted:

| Spec requirement | Adaptation in this build | Impact |
|---|---|---|
| Supabase PostgreSQL | Prisma + SQLite (`prisma/schema.prisma`, `db/custom.db`) | Same normalized relational model. |
| Database Row Level Security (RLS) | Application-layer permission engine (`src/lib/permissions.ts`) + `requirePermission()` on every sensitive API route + organization-scoped queries. | Deny-by-default is enforced server-side on every read/write. RLS-as-defense-in-depth is noted as a production hardening step when migrating to Postgres. |
| Supabase Auth | Custom stateless JWT (HMAC-SHA256, httpOnly cookie) + scrypt password hashing (Node built-in, no deps). | Session + rate-limited login + audit. MFA / OAuth not implemented (see PROJECT_STATUS). |
| Supabase Storage (signed URLs) | Local filesystem under `/home/z/my-project/upload` with permission-checked download endpoint. | Production migration: swap in S3 presigned URLs behind the same API contract. |
| Postgres enums | SQLite has no enums — `String` fields with documented allowed values + app-level validation. | Values documented inline in schema comments. |
| Postgres arrays | `String` (CSV) or separate join tables. | e.g. `Meeting.attendees` is a CSV string. |

All other stack choices follow the spec: Next.js 16 App Router + TypeScript strict, shadcn/ui (New York) + Tailwind 4, Zod validation, React Hook Form, recharts, Zustand, TanStack Query.

**Defaults:** timezone `Africa/Lagos`, currency `NGN`. Configurable per organization in Settings.

---

## Quick start

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
#   - DATABASE_URL is already set for local SQLite
#   - Generate SESSION_SECRET:  openssl rand -hex 32

# 3. Create the database schema
bun run db:push
bun run db:generate

# 4. Seed demo data (DEMO DATA — clearly identifiable)
bun run prisma/seed.ts

# 5. Run the dev server
bun run dev    # http://localhost:3000
```

### Demo accounts

All demo accounts use the password **`churchos123`**. These are seeded demo accounts — do not use in production.

| Email | Role | Scope |
|---|---|---|
| `super@churchos.app` | Super Admin | Platform-wide |
| `admin@gracechapel.org` | Church Admin | Full church |
| `pastor@gracechapel.org` | Pastor | Pastoral workflows |
| `finance@gracechapel.org` | Finance Officer | Finance only |
| `worship@gracechapel.org` | Department Head | Worship dept |
| `assistant@gracechapel.org` | Dept Assistant | Worship dept |
| `member@gracechapel.org` | Member | Self only |

Sign in with each to see how the sidebar, dashboard, and module access change per role.

---

## Architecture

```
src/
  app/
    api/                    # All REST endpoints (auth, me, dashboard, members, ...)
      auth/route.ts         # POST login (rate-limited) / DELETE logout
      me/route.ts           # GET current session
      dashboard/route.ts    # GET role-aware metrics
      members/              # CRUD + scoped list
      departments/          # CRUD + membership management
      attendance/           # sessions, check-in, duplicate prevention
      visitors/, followups/ # visitor CRM + follow-up board
      events/               # calendar + registration
      finance/              # overview, funds, donations, expenses, budgets, export
      announcements/, notifications/
      pastoral/             # confidential cases + prayer requests (restricted)
      documents/            # permission + access-level gated uploads/downloads
      tasks/, assets/, audit/
      settings/             # church profile, branches, users & roles
      reports/              # permission-aware analytics
      search/               # global permission-aware search
      profile/              # self-service profile + password change
    page.tsx                # Entry: renders LoginScreen or AppShell
    layout.tsx              # Providers (theme + query client)
    globals.css             # ChurchOS emerald/teal design system
  components/
    churchos/
      app-shell.tsx         # Sidebar + topbar + module router + sticky footer
      login-screen.tsx      # Public login experience
      module-registry.tsx   # Lazy-loads each module component
      modules/*.tsx          # One file per module (16 modules)
    ui/                     # shadcn/ui component library (pre-installed)
    providers.tsx           # next-themes + TanStack Query
  lib/
    db.ts                   # Prisma client (singleton)
    password.ts             # scrypt hash/verify (Node crypto, no deps)
    session.ts              # HMAC-SHA256 JWT in httpOnly cookie
    permissions.ts          # RBAC matrix: 9 roles × 16 modules × 8 actions
    api.ts                  # requireUser / requirePermission / audit / apiHandler
    format.ts               # Currency (NGN), dates (Africa/Lagos), helpers
    auth-store.ts           # Zustand client store (user, org, activeModule)
    nav.ts                  # Sidebar navigation config
prisma/
  schema.prisma              # Full normalized data model
  seed.ts                    # Demo data seeder
```

### Security model

- **Authentication:** email + scrypt-hashed password → HMAC-SHA256 JWT in `httpOnly`, `SameSite=Lax`, `Secure` (prod) cookie. 7-day TTL. Login endpoint is rate-limited (10 attempts/min/IP).
- **Authorization:** every sensitive API route calls `requirePermission(module, action)`, which loads the live user from the DB and checks the permission matrix in `src/lib/permissions.ts`. **Deny by default.** Scoped roles (`department_head`, `department_assistant`, `unit_leader`) are additionally filtered by `departmentId` in their queries.
- **Audit:** privileged actions (login, member CRUD, finance postings, approvals, role changes, exports, pastoral case views) write append-only `AuditLog` records with actor + action + target + metadata. No passwords, tokens, or sensitive case contents are logged.
- **Cross-tenant isolation:** every query is scoped by `organizationId` from the session.
- **Input validation:** Zod on auth + write endpoints; Prisma parameterized queries (no raw SQL string concatenation).
- **File access:** documents are access-level gated (`public`/`members`/`staff`/`leaders`/`finance`/`pastoral`); downloads are permission-checked server-side, never served via obscure URLs.
- **Privacy:** pastoral case `privateNotes` are visible only to `pastor` and `super_admin` (never to `church_admin`, department heads, or finance). Department heads cannot access other departments. Members cannot view other members' giving records.

### Data model highlights

See `prisma/schema.prisma` for the full schema. Key entities: `Organization`, `Branch`, `User`, `Member`, `MemberStatusHistory`, `Department`, `DepartmentMembership`, `Unit`, `Service`, `AttendanceSession`, `AttendanceRecord` (unique `[sessionId, memberId]` prevents duplicate check-in), `Visitor`, `FollowUpTask`, `FollowUpInteraction`, `Event`, `Registration` (unique `[eventId, email]`), `Fund`, `Donation`, `Expense`, `Budget`, `Approval`, `Announcement`, `Notification`, `PastoralCase`, `PrayerRequest`, `Task`, `Meeting`, `Asset`, `Booking`, `Document`, `AuditLog`, `Setting`, `ImportJob`.

---

## Modules

| # | Module | Status |
|---|---|---|
| 1 | Dashboard (role-aware) | ✅ Real metrics, charts, drill-down |
| 2 | Membership CRM | ✅ CRUD, search/filter/pagination, detail, status history, scoped |
| 3 | Departments, Units & Teams | ✅ CRUD, membership management, scoped heads |
| 4 | Attendance & Services | ✅ Sessions, manual + simulated QR check-in, duplicate prevention, trends |
| 5 | Visitors & Follow-up | ✅ Registry, Kanban board, interactions, convert-to-member |
| 6 | Events & Calendar | ✅ CRUD, month grid, registration (capacity + duplicate guards) |
| 7 | Finance & Giving | ✅ Funds, donations, expenses, approvals, budgets, CSV export (basic tracking, not full accounting) |
| 8 | Communications | ✅ Announcements + in-app notifications (no real email/SMS — provider adapters are stubs) |
| 9 | Pastoral Care & Welfare | ✅ Confidential cases + prayer requests (strictly restricted) |
| 10 | Volunteers/Rosters | ⚠️ Partial — volunteers modeled via department memberships; full roster scheduling deferred |
| 11 | Documents & Media | ✅ Upload, access-level gating, permission-checked downloads |
| 12 | Tasks & Approvals | ✅ Kanban, approvals board |
| 13 | Assets & Facilities | ✅ Registry, valuation, basic booking |
| 14 | Reports & Analytics | ✅ Membership / attendance / finance / visitor / department reports + CSV |
| 15 | Member Portal | ✅ Member role sees directory, events, announcements, prayer submission, personal giving notice |
| 16 | Settings & Admin | ✅ Church profile, branches, users & roles (audited), profile + password change |
| — | Audit Log | ✅ Filterable, permission-gated |
| — | Global Search | ✅ Permission-aware, capped results |

---

## Threat model (summary)

| Threat | Mitigation |
|---|---|
| Unauthorized data access | `requirePermission` on every route + org-scoped queries + scoped roles |
| Privilege escalation | Role changes audited + self-role-change blocked; privileged role changes require `settings:manage` |
| IDOR | All `[id]` routes verify the resource belongs to the caller's org (and department for scoped roles) |
| Brute-force login | In-memory rate limiter (10/min/IP) |
| XSS | React auto-escaping; no `dangerouslySetInnerHTML` on user input |
| CSRF | Cookie `SameSite=Lax`; state-changing routes use POST/PATCH/DELETE |
| Insecure file upload | Type + size validation (10MB), safe filenames, access-level gating |
| Cross-tenant leakage | Every query filtered by `organizationId` |
| Sensitive data in logs | Audit log stores action metadata only, never passwords/tokens/case contents |

**Production hardening (not implemented here — see PROJECT_STATUS):** PostgreSQL RLS as defense-in-depth, MFA, real email/SMS provider with opt-out honoring, signed storage URLs, automated backups + restore tests, dependency scanning, CSP + security headers.

---

## Commands

```bash
bun run dev          # dev server (port 3000)
bun run lint         # ESLint
bun run db:push      # apply schema to SQLite
bun run db:generate  # regenerate Prisma client
bun run db:reset     # reset DB (DESTRUCTIVE)
bun run prisma/seed.ts  # seed demo data
```

---

## Deployment

This sandbox runs the Next.js dev server on port 3000 behind a Caddy gateway. For production:

1. Set `SESSION_SECRET` to a strong 32+ byte random value.
2. Migrate to PostgreSQL (swap `datasource` provider + run `prisma migrate deploy`; add RLS policies mirroring the permission matrix).
3. Configure real email/SMS providers behind the adapter interface.
4. Configure object storage (S3) for document uploads; swap the local file write for presigned URLs.
5. Deploy the Next.js app (Vercel or self-hosted `next start`).
6. Back up the database on a schedule; test restoration in a non-production environment.

---

## License

Demo project. Adapt to your church's needs. Review privacy obligations (including Nigeria's NDPA) before handling real personal data — flag legal decisions for qualified review.
