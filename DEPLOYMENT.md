# ChurchOS — Vercel Deployment Guide

> Deployed: `https://churchos-pensin.vercel.app` (team **pensin**, project **churchos**)
> CLI auth: `donalore99-1724` · Vercel MCP: not available for this agent (unsupported client)

## Current state

| Item | Status |
|---|---|
| Vercel CLI 65.2.0 | ✅ installed (bun global) |
| Account | ✅ `donalore99-1724`, team `pensin` (hobby) |
| Agent skills | ✅ 9 Vercel skills in `~/.agents/skills/` |
| Project link | ✅ `.vercel/project.json` → `churchos` |
| Env (Preview) | ✅ `DATABASE_URL`, `UPLOAD_DIR`, `SESSION_SECRET` |
| Production alias | ✅ `https://churchos-pensin.vercel.app` (login + data verified) |
| Vercel MCP | ⛔ blocked — this agent is not a supported MCP client |

### Verified live (2026-10-25)
- `GET /` → 200, ChurchOS HTML shell
- `POST /api/auth` (login) → 200 with session cookie
- `GET /api/me` → 200, full user + 21-module permission matrix
- `GET /api/members|departments|events` → 200 with seeded data

### Key fixes made during setup
1. **`src/lib/permissions.ts` split** — the file mixed the pure client-safe
   permission MATRIX with server-only DB functions (`seedDefaultRoles`,
   `getEffectiveMatrix`, `canAsync`…). Because `app-shell.tsx` (client)
   imports `permissions.ts`, the Vercel Turbopack build failed with
   `"Can't resolve 'fs'"` (client graph → db.ts → fs). Server functions now
   live in **`src/lib/permissions-db.ts`**; all 12 server importers were
   rewired. The pure file is client-safe again.
2. **`src/lib/db.ts`** — on Vercel, copies the bundled `db/custom.db` to
   `/tmp/churchos.db` (writable) on cold start (atomic rename, multi-candidate
   path resolution + diagnostics).
3. **`next.config.ts`** — `outputFileTracingIncludes` bundles `db/**` +
   `prisma/**` into every API lambda; `output: standalone` now conditional on
   `BUILD_STANDALONE=true` (Docker path via `bun run build:standalone`).
4. **`package.json`** — `build` is plain `next build` (Vercel), added
   `postinstall: prisma generate`.
5. **Upload paths** — documents APIs use portable `getUploadDir()`
   (`UPLOAD_DIR` env → `/tmp/upload` on Vercel).

## ⚠️ Preview-mode limitations (read this)

The current deployment runs in **read-only demo mode** — it ships the pre-seeded
SQLite file (`db/custom.db`, bundled into each lambda via
`outputFileTracingIncludes`). This means:

1. **Reads work everywhere** — members, events, finance reports, login all function.
2. **Writes appear to work then vanish** — each serverless invocation gets a fresh
   copy of the DB file; nothing persists between requests.
3. **Real-time AI ticker offline** — the socket.io mini-service (port 3004) cannot
   run on Vercel; the AI assistant gracefully falls back to non-realtime mode.
4. **File uploads ephemeral** — `/tmp/upload` lives for one invocation only.

This is **perfect for demos/previews**, and the correct production path is below.

## Going to production — 3 migrations

### 1. Database → Turso (hosted libSQL, free tier)

SQLite-compatible — the Prisma schema stays as-is.

```bash
# one-time: create Turso db (turso auth login first)
turso db create churchos --location nrt   # or iad / fra
turso db show churchos --url              # → libsql://churchos-<org>.turso.io
turso db tokens create churchos           # → auth token

# local: push schema + seed to Turso
DATABASE_URL='libsql://churchos-<org>.turso.io' \
TURSO_AUTH_TOKEN='<token>' \
bun run db:push && DATABASE_URL=... bunx tsx prisma/seed.ts
```

Code change (1 file) — `src/lib/db.ts`: use `@prisma/adapter-libsql` when
`process.env.TURSO_AUTH_TOKEN` is set:

```ts
import { PrismaLibSQL } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

const libsql = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})
const db = new PrismaClient({ adapter: new PrismaLibSQL(libsql) })
```

Then in Vercel: `vercel env add DATABASE_URL production --value 'libsql://…' -y`
and `vercel env add TURSO_AUTH_TOKEN production --value '<token>' -y`
(remove the `file:/var/task/...` preview value or update all environments).

### 2. Real-time → Pusher Channels (free tier) or keep local-only

Replace `mini-services/ai-events` (socket.io, port 3004) with Pusher:

```bash
bun add pusher pusher-js
```

- Server (`src/lib/ai-events.ts`): trigger `churchos.events` channel events via
  the `pusher` REST SDK instead of the HTTP POST to `localhost:3004/broadcast`.
- Client (`src/components/churchos/ai-assistant.tsx`): subscribe with `pusher-js`
  instead of `io('/?XTransformPort=3004')`.
- Env: `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`.

### 3. File uploads → Vercel Blob

```bash
vercel blob store add churchos   # or use the dashboard
bun add @vercel/blob
```

Swap `getUploadDir()` writes in `src/app/api/documents/*` for
`put()` from `@vercel/blob` (server-side, uses `BLOB_READ_WRITE_TOKEN`,
auto-set when the store is connected).

## Redeploying

```bash
vercel deploy --prod -y --scope pensin   # production
vercel deploy -y --scope pensin          # preview
vercel logs <deployment-url>             # debug
vercel curl <path>                        # fetch a protected preview route
```

## Deploy protection

Deployment Protection (Vercel Authentication) is ON — only logged-in team
members can open the URL. To make it public:
**Dashboard → churchos → Settings → Deployment Protection → Disabled**, or:

```bash
vercel project settings  # then disable protection interactively
```

## Recommended next step: connect a Git repo

Per Vercel best practice, push the repo to GitHub and connect it — every push
then auto-deploys (PRs get preview URLs):

```bash
gh repo create churchos --private --source=. --push
# then: Dashboard → churchos → Settings → Git → Connect
```

## AI Assistant on Vercel — CONFIGURED ✅ (2026-10-25)

The AI backend uses the sandbox's z-ai gateway (`internal-api.z.ai`), which
resolves to **private 172.25.x.x IPs** — reachable only inside the sandbox
network. Vercel lambdas can never call it, so production uses Z.ai's **public
OpenAI-compatible API** instead.

**Status: DONE.** These env vars are set on Vercel (production/preview/development):

| Env var | Value | Notes |
|---|---|---|
| `LLM_API_KEY` | *(Z.ai key — stored as Secret)* | the only var that is strictly required |
| `LLM_BASE_URL` | `https://api.z.ai/api/paas/v4` | default when unset |
| `LLM_MODEL` | `glm-4.5-flash` | **free tier** — user decision "LETS STAY ON 4.5 FREE" |

**Model configuration (in `src/lib/ai/llm.ts`):**
1. Primary: `glm-4.5-flash` — **FREE Z.ai tier**, no balance needed. Verified working.
2. Fallback safety net: if `LLM_MODEL` is ever switched to a paid model
   (e.g. `glm-5.3-flash`), balance/quota errors (1113), thinking-only models
   (1210) and unknown models (1211/404) automatically fall back to the free
   model so the assistant never goes down.
3. After a balance/quota failure on a paid primary, it is skipped for 10
   minutes (in-memory); auto-recovers after a top-up.

**Notes:**
- Z.ai GLM-4.5+ models are hybrid reasoning: requests to Z.ai endpoints send
  `thinking:{type:'disabled'}` so content isn't consumed by hidden reasoning.
- Rotating the key: `vercel env add LLM_API_KEY production preview development --value "…" -y`
  then `vercel deploy --prod -y`.
- Any OpenAI-compatible provider also works: set `LLM_BASE_URL` + `LLM_API_KEY`
  (+ optional `LLM_MODEL`).

**Serverless hardening already shipped (2026-10-25):**
- z-ai config auto-bootstrap from `ZAI_CONFIG_B64` env → `/tmp/.z-ai-config`
  (HOME pointed at /tmp so `os.homedir()` finds it)
- AI chat find-or-create conversation (per-lambda ephemeral DB isolation)
- Client-side thread history (localStorage) merged into the UI + sent as
  `history` for multi-turn context when server history is empty
- GET conversation returns a synthetic empty object instead of 404 when the
  lambda doesn't hold the row
