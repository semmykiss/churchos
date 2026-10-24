# ChurchOS Android App — Google AI (Gemini) Prompt Pack

This folder contains ready-to-paste prompts for building the ChurchOS Android app with Google AI.

## How to use

| Tool | Where to paste | Best for |
|---|---|---|
| **Google AI Studio** (aistudio.google.com) | Chat with Gemini 2.5 Pro | Generating whole features/files, architecture review |
| **Firebase Studio** (firebase.studio) | App Prototyping agent | Rapid UI prototyping from prompts |
| **Android Studio** (built-in Gemini) | Ask Gemini panel | Working inside a real Android project, step-by-step |

**Recommended workflow:** paste **Prompt 1 (Master Prompt)** first to get the architecture + project skeleton, then paste the **per-module prompt template** (Prompt 2) once per feature, filling in the module name. Generate, run, verify, then move to the next module. Never ask for the entire app in one shot — context limits will degrade quality.

## Before you start — prerequisites (do these first)

The Android app talks to your existing ChurchOS backend over HTTP. Three things must be true first:

1. **Deploy the backend publicly.** The Android phone cannot reach `localhost`. Deploy the Next.js app to Vercel/Railway/Render and use a real database (Postgres + Prisma — swap `sqlite` provider). Note your base URL, e.g. `https://api.yourchurch.org`.
2. **Token auth for mobile.** The web app uses an HttpOnly cookie session, which browsers handle automatically but native apps don't. Ask Gemini to add a small backend endpoint (`POST /api/auth/token`) that returns a JWT Bearer token from the same login credentials, and to accept `Authorization: Bearer <token>` alongside the cookie. (Paste the "Auth Token Endpoint" mini-prompt below into Gemini *working against your repo*, e.g. via Android Studio Gemini or AI Studio with your repo connected.)
3. **Realtime service URL.** The ai-events socket.io service (port 3004) must also be publicly reachable, e.g. `wss://events.yourchurch.org`.

## Contents

- **Prompt 1 — Master Prompt** (paste first): full product spec + tech stack + architecture.
- **Prompt 2 — Per-module template**: reusable, fill in `{{MODULE}}`.
- **Prompt 3 — Auth Token Endpoint** (backend change, run against your repo).
- **Prompt 4 — Bug-fix / iteration template**.

---

## PROMPT 1 — MASTER PROMPT (paste this first)

```text
You are a senior Android engineer. Build a production-quality native Android app for "ChurchOS" — a church management platform — using Kotlin and Jetpack Compose. Produce a complete, buildable Gradle project (Kotlin DSL, version catalog), not snippets.

## PRODUCT CONTEXT

ChurchOS manages a church's operations. It already exists as a web app with a REST API. The Android app is a companion client for the SAME backend: it must consume the REST API described below, never invent data, and enforce the same role-based visibility in the UI (the server is the source of truth for permissions — the app hides UI the role can't use and gracefully handles 401/403).

Tenants: each church is an organization. Data is organization-scoped. Currency: NGN (₦, format with thousands separators). Timezone: Africa/Lagos. Brand: emerald/teal primary (#059669 → #0d9488 gradients), Material 3, light + dark themes, NO indigo or blue as primary.

## ROLES (13 — the nav and screens adapt to the user's role)

super_admin, church_admin, pastor, finance_officer, accountant, treasurer,
finance_committee, usher, department_head, department_assistant, unit_leader,
member, guest

Role capabilities (summary):
- member: own profile, directory (basic info of others only), events + registration, own giving history, announcements, town hall, prayer requests, own tasks, notifications, AI assistant.
- usher: offering collection sessions + count sheets only (no ledger).
- treasurer: collections, deposits, payment processing.
- accountant: chart of accounts, journal entries, bank reconciliation (cannot approve own payments).
- finance_officer: full finance (approve, pay, manage) + reports.
- finance_committee: read finance + approve budgets/significant expenses.
- pastor: pastoral cases, prayer requests, members, visits, events (no finance).
- department_head / department_assistant / unit_leader: scoped to their department (members, tasks, budget requests, departmental finance).
- church_admin: everything for their church. super_admin: platform-wide.

## BACKEND API (base: https://<your-host> — REST, JSON; auth via Authorization: Bearer <token>)

Auth & session:
- POST /api/auth {email, password} → 200 sets session; POST /api/auth/token {email, password} → { token, user } (JWT, 7-day expiry)
- DELETE /api/auth (logout) · GET /api/me → { user, permissions { allowed: {module: [actions] } } } — use `permissions.allowed` to drive UI visibility

Core modules (all GET return { items | rooms | sessions | ..., total?, page? }):
- GET /api/dashboard → { metrics { totalMembers, activeMembers, newVisitors, totalAttendance, pendingTasks, ... }, attendanceTrend[], upcomingEvents[] }
- /api/members (GET list w/ ?q&status&page, POST create) · /api/members/{id} (GET/PATCH/DELETE) — full biodata for self/staff; basic info for member role
- /api/households · /api/dependants · /api/departments (+/{id})
- /api/attendance (POST check-in) · /api/visitors (+/{id}, PATCH {action:'convert'})
- /api/followups · /api/events (GET/POST) · /api/events/{id} · POST /api/events/{id}/register {name,email,phone}
- /api/announcements (+/{id}) · /api/celebrations (birthdays/anniversaries) · POST /api/celebrations/greet
- /api/pastoral (cases) · /api/pastoral/prayer · /api/tasks (+/{id}) · /api/assets · /api/documents
- /api/townhall → rooms; /api/townhall/{roomId} → messages; POST → send {body, parentId?}; PATCH → edit/delete/react/pin
- /api/notifications?pageSize=20 → { items[{id,title,message,link,read,createdAt}], unread } · PATCH {id|all}
- /api/search?q= · /api/audit (admin) · /api/settings/users (admin)

Finance (role-gated; members ONLY see own giving):
- GET /api/finance → overview (staff: org totals; member: personal view)
- /api/finance/tithes (+/{id} PATCH status w/ rejectionReason required on reject)
- /api/finance/donations (+/{id}) · /api/finance/expenses · /api/finance/budgets · /api/finance/pending
- /api/finance/expense-requests (+/{id} PATCH action: submit|approve|reject|return|pay|reconcile)
- /api/finance/collection-sessions (+/{id} PATCH action: verify|handover|deposit|post; POST {id} adds count sheet {counterName, lines[{category,amount}]})
- /api/finance/chart-of-accounts · /api/finance/journal-entries (POST balanced double-entry; PATCH action:'reverse')
- /api/finance/bank-accounts · /api/finance/bank-reconciliations · /api/finance/pledges · /api/finance/budget-revisions
- /api/finance/reports/trial-balance|income-expenditure|statement-of-position|fund-activity|budget-vs-actual|collection-summary|expense-register|member-giving-statement?memberId= (members: own only)

AI assistant:
- POST /api/ai/chat {conversationId, message} → SSE stream: data: {"type":"start"} then {"type":"delta","delta":"..."} ... {"type":"done"}; render markdown incrementally
- GET/POST /api/ai/conversations · DELETE /api/ai/conversations/{id}

Realtime: socket.io (NEW socket.io-client-kotlin or via OkHttp SSE fallback) — event "church:event" {module, action, title, message, refId, isFinance} → live activity feed; also use for chat + notifications refresh.

## HARD RULES
1. FINANCE PRIVACY: a member can NEVER see another member's giving. Church-wide finance screens hidden for non-finance roles. If any finance response has allowed:false → show the refusal message, don't crash.
2. Never trust client-side role for security — server 403s must surface a friendly message.
3. Offline-first: cache lists (Room) for read-only viewing offline; queue nothing — writes require connectivity with clear error states.
4. All lists: pull-to-refresh, pagination (page param), empty/loading/error states.
5. Rejection flows (tithe/donation/expense) REQUIRE a reason — show a dialog with a mandatory textarea; send rejectionReason.
6. No hardcoded demo data anywhere.

## TECH STACK (required)
- Kotlin 2.x, Jetpack Compose + Material 3, single-Activity, Navigation Compose (type-safe routes)
- Hilt DI, Coroutines + Flow, ViewModel per screen (UiState: Loading/Content/Error)
- Retrofit + OkHttp + kotlinx.serialization; OkHttp AuthInterceptor (Bearer) + TokenAuthenticator (refresh→relogin on 401)
- Coil for images; Room for offline cache (members, events, announcements, giving)
- socket.io-client for realtime; FCM push notifications (tap → deep link to module/record via link field "module:refId")
- Min SDK 26, target latest. Package: org.churchos.app

## SCREENS (bottom nav adapts to role; overflow "More" sheet for the rest)
1. Splash → Login (email/password; "demo" hint if enabled) → role-based Home
2. Home/Dashboard: stat cards, attendance trend chart, upcoming events, recent announcements (role-filtered)
3. Members: search/list → detail (tabs: profile, household, dependants, giving for staff) → add/edit (staff)
4. Attendance: service picker + member check-in (fast grid) — attendance staff
5. Visitors: list + add + follow-up status + convert-to-member (staff)
6. Events: upcoming list + detail + register form; my registrations
7. Giving (member role): "My Giving" — tithes + donations + totals + period filter; giving statement export
8. Finance (finance roles): dashboard, pending approvals (confirm/reject w/ required reason), expense requests (workflow chips), collection sessions (count sheet entry: numeric keypad friendly), reports viewer
9. Offering Collection (usher): open session, count sheet form per category, submit
10. Town Hall: room list → chat (bubbles, replies, reactions, @mention picker) w/ polling or socket.io
11. Announcements: list + detail; Celebrations: this month's birthdays/anniversaries + "Send greeting"
12. Pastoral (pastor): cases list/detail + prayer requests
13. Tasks: my tasks, status change, comments
14. Notifications: list, unread badge, tap → navigate via link "module:refId" parsing
15. AI Assistant: chat screen, markdown rendering, streaming, conversation history, live activity ticker chips
16. Profile/Settings: my profile, household, dependants, theme toggle, logout

## DELIVERABLES
1. Full Gradle project tree + version catalog + build files
2. Core infra: network (Retrofit/OkHttp/auth), Room, Hilt modules, theme (emerald/teal M3, dark), common composables (StatCard, StatusPill, EmptyState, CurrencyText, ErrorState, LoadingList)
3. Auth flow + role-based nav graph (start from GET /api/me permissions)
4. All 16 screen groups with real API wiring (ViewModel + Repository per domain)
5. FCM setup + deep links + socket.io realtime service
6. README: how to set BASE_URL, google-services.json, build & run

Start with deliverables 1–3 (project + infra + auth/nav), show the file tree, then continue screen by screen. Ask me nothing unless a choice is blocking; make sensible defaults and note them.
```

---

## PROMPT 2 — PER-MODULE TEMPLATE (repeat per feature)

```text
Continue the ChurchOS Android app (Kotlin + Compose + M3 + Hilt + Retrofit + Room as previously set up).

Build the {{MODULE}} feature end-to-end:
- Data: DTOs (kotlinx.serialization), Retrofit endpoints (listed below), Room entities/DAO if cacheable, repository with NetworkBoundResource pattern.
- Domain: ViewModel with UiState (Loading/Content/Error), pagination + pull-to-refresh where list.
- UI: Compose screen(s) matching the app's emerald/teal M3 theme; loading skeletons, empty state, error state with retry; status pills; currency = ₦ formatted (Africa/Lagos dates).
- Role gating: use the cached permissions from GET /api/me; hide actions the role lacks; handle 403 with a friendly snackbar.
- Navigation: type-safe route registered in the nav graph; deep link churchos://{{module}}/{id} for notifications.

API for {{MODULE}}:
{{PASTE THE RELEVANT ENDPOINTS FROM PROMPT 1}}

Rules: no hardcoded data; server errors → message from response body {error}; writes show success toast + optimistic list update on next refetch.
Output: complete files (no snippets) + how to wire into nav + a short test checklist.
```

Fill `{{MODULE}}` with: Members · Attendance · Visitors · Events · Giving(member) · Finance · Collections(usher) · TownHall · Announcements · Pastoral · Tasks · Notifications · AI Assistant · Settings.

---

## PROMPT 3 — AUTH TOKEN ENDPOINT (backend change — run against your repo, e.g. Android Studio Gemini)

```text
In this Next.js repo, add mobile token auth without breaking the existing cookie session:
1. Extend src/lib/session.ts with createSessionToken(payload) returning the same signed JWT as a string (reuse the existing sign()).
2. In src/app/api/auth/route.ts POST: also return { token } in the JSON body (same session payload, 7-day expiry) alongside the current response. Keep Set-Cookie exactly as is.
3. Create src/app/api/auth/token/route.ts: POST {email,password} → 200 { token, user } using the same credential check + rate limit as the existing login. No cookie.
4. Middleware/API helper: in src/lib/api.ts requireUser()/requirePermission(), accept Authorization: Bearer <token> by verifying it with the existing verify() when the cookie is absent. Tenant suspension + active checks unchanged.
5. Add a test: login via /api/auth/token → call /api/me with Bearer → 200 user. Keep everything backward compatible (web keeps using cookies).
```

---

## PROMPT 4 — ITERATION / BUG-FIX TEMPLATE

```text
In the ChurchOS Android project (Kotlin + Compose):
Bug/Task: {{DESCRIBE WHAT'S WRONG OR WHAT TO ADD}}
Expected behavior: {{WHAT SHOULD HAPPEN}}
Actual behavior: {{WHAT HAPPENS}}
Relevant files: {{PASTE OR NAME FILES}}
Fix it with the smallest change. Show complete updated files only. Explain the root cause in 2–3 sentences.
```

---

## Recommended build order

1. Prompt 3 (backend token) → verify with curl
2. Prompt 1 → get skeleton + auth + nav; get it running against your deployed BASE_URL
3. Prompt 2 per module, in this order: Auth polish → Dashboard → Members → Notifications → Events → Announcements → Giving (member) → TownHall → AI Assistant → Tasks → Pastoral → Finance (staff) → Collections (usher) → Reports → Settings
4. Ship internal test via Firebase App Distribution after each milestone
