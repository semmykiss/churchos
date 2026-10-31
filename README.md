# Grace ChMS — Church Management Platform (local build)

A complete, single-tenant church management system built to the product plan in
`upload/` (market research, compliance baseline, functional spec, architecture):
**people, groups, attendance & children's check-in, events, giving,
communications, volunteer scheduling, pastoral care, workflows, reporting,
member portal and administration** — one system, no spreadsheet beside it.

Runs **locally on Windows** with a **local SQLite database** and **TypeScript
end-to-end**, with the **backend clearly separated from the frontend** in code.

---

## Run it on Windows

Prerequisites: **Node.js 20+** (LTS) and npm. No cloud services, no Docker —
everything is on your machine.

```bat
:: 1. install dependencies
npm install

:: 2. create the local SQLite database (db\custom.db)
npm run db:push

:: 3. load the Grace Chapel demo data (optional but recommended)
npm run db:seed

:: 4. start the dev server on http://localhost:3000
npm run dev:win
```

Production mode (optional):

```bat
npm run build:win
npm run start:win
```

The database lives at `db\custom.db` (SQLite file — copy it to back up; delete
it and re-run `db:push` + `db:seed` to reset).

### Demo accounts (password for all: `redeem2026`)

Tenant: **Redeem Baptist Church** (local build).

| Account | Role | Sees |
|---|---|---|
| `pastor@redeembaptist.ng` | Owner / Lead pastor | Everything — including Care Radar with full giving detail |
| `rita.p@redeembaptist.ng` | Ministry leader | Care Radar (privacy-filtered: no giving amounts), Sermon Studio, Serving — **not** individual giving |
| `femi.f@redeembaptist.ng` | Finance (treasurer) | Giving, accounting, Board Reports |
| `vera.v@redeembaptist.ng` | Volunteer | Member portal, my serving schedule, availability & swaps |

Each role demonstrates the server-enforced permission model — sign in as each
one and compare the navigation.

### Partner Console (SaaS vendor layer)

Sign in from the main login screen → **"Partner Portal — manage churches &
licenses"**. This is a separate principal from church logins (own table,
session and cookie).

| Email | Password |
|---|---|
| `partner@gracechms.demo` | `partner2026` |

If the account is missing (e.g. after a database reset), restore it without
touching any other data:

```bash
bun scripts/create-partner-user.ts
```

---

## Architecture — backend separated from frontend

```
src/
├── server/                  ◀── BACKEND (no React, no 'use client', never
│   │                            imported by the frontend)
│   ├── db.ts                Prisma client (SQLite)
│   ├── auth.ts              scrypt password hashing, DB-backed sessions,
│   │                        kiosk device principal, login auditing
│   ├── permissions.ts       permission catalogue + wildcard policy checks
│   ├── audit.ts             append-only audit service (rule: who did what, before/after)
│   ├── http.ts              API error types + response helpers
│   ├── services/            DOMAIN SERVICES — all business rules live here
│   │   ├── people.ts        duplicates, merge w/ survivor choice, stage history
│   │   ├── groups.ts        rosters, absentee detection, attendance
│   │   ├── events.ts        occurrences, per-occurrence cancel, headcount
│   │   ├── checkin.ts       ★ security codes (4-char, per child per occurrence),
│   │   │                      room-by-age, code/authorised-guardian checkout
│   │   ├── giving.ts        append-only ledger, splits, batches w/ two-person
│   │   │                      control, reversals (never edits), statements
│   │   ├── comms.ts         consent-aware audience resolution, simulated send
│   │   ├── volunteers.ts    plans, tokenised respond, swaps w/ clearance re-check
│   │   ├── care.ts          confidentiality tiers, safeguarding rules
│   │   ├── workflows.ts     5 fixed templates, suppression rules, idempotency
│   │   ├── reports.ts       5 dashboards + metric dictionary
│   │   ├── portal.ts        member self-service (own data only)
│   │   └── admin.ts         permission matrix, audit query, CSV import w/ rollback
│   └── api/
│       ├── router.ts        route table: pattern match → session → permission
│       │                    check → zod-free validation → handler
│       └── routes/*.ts      THIN controllers (parse query/body, call services)
│
├── app/
│   ├── api/v1/[...path]/route.ts   the ONLY HTTP entrypoint — a thin adapter
│   │                               that delegates everything to src/server
│   ├── page.tsx             the single user-visible route
│   └── layout.tsx
│
├── components/
│   ├── ui/                  shadcn/ui primitives
│   └── app/                 FRONTEND (client components only)
│       ├── app-root.tsx     session bootstrap, login gate
│       ├── app-shell.tsx    responsive sidebar, topbar, sticky footer
│       ├── login-screen.tsx
│       ├── module-registry.tsx  nav + role-based module access
│       ├── shared.tsx       shared UI primitives + query hooks
│       └── modules/*.tsx    one file per module screen
│
├── lib/
│   ├── api.ts               typed fetch client (frontend only)
│   └── types.ts             shared DTOs + formatters (frontend only)
│
prisma/
├── schema.prisma            40-table data model (tenant_id everywhere,
│                            integer cents, soft delete, append-only audit)
└── seed.ts                  deterministic Grace Chapel demo data
```

**The separation is mechanical, not aspirational:**

- `src/server/**` never imports React, `next/*` UI, or anything in
  `src/components` / `src/lib` (the api client included).
- `src/components/**` and `src/lib/**` never import Prisma or `src/server`.
- The only bridge is HTTP: frontend → `fetch('/api/v1/...')` → thin route
  adapter → router (auth + permission gate) → domain service → Prisma.
- `docs/api-contract.md` is the contract both sides are written against.

### Product rules honored (from the plan docs)

- **Person** (not household) is the subject of attendance and giving.
- **Money is an append-only ledger**: posted gifts immutable; refunds and
  corrections are new reversal records; batches post under two-person control.
- **Security codes are per child, per occurrence** — reusing last week's code
  fails; checkout requires the code *or* an authorised guardian.
- **Consent is per person, per channel, per purpose**; the comms audience
  resolver suppresses opted-out, deceased and do-not-contact records.
- **Swaps re-validate clearance** — a volunteer without safeguarding clearance
  cannot be swapped into the kids room.
- **Care notes have three confidentiality tiers**; viewing is audited;
  safeguarding cases cannot be deleted.
- **Every permission is enforced server-side** per object and action; hiding a
  button is not a permission. The "Who can see giving?" screen computes the
  answer live from the role data.
- **Audit log is append-only** on people, giving, care, roles and exports.
- **Soft delete everywhere**; hard delete blocked when financial records exist.

## Notes

- Email and SMS sending is **simulated** (this is a local build — no provider
  credentials). Recipient delivery states are generated so the comms UI and
  reports behave realistically.
- Payment processing is simulated by a demo processor: the portal gift flow
  records a token, never card data (PCI scope stays minimal, per the plan).
- The kiosk is a **device principal**: an open check-in session carries a
  kiosk token that can look up families and run check-in/checkout — and
  nothing else.
