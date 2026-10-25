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

## AI Assistant on Vercel — action required

The AI backend uses the sandbox's z-ai gateway (`internal-api.z.ai`), which
resolves to **private 172.25.x.x IPs** — reachable only inside the sandbox
network. Vercel lambdas can never call it, so the AI assistant needs a
public LLM provider on Vercel:

**Fix (2 minutes):** add these env vars in Vercel (any OpenAI-compatible
provider — OpenAI, OpenRouter, Groq, Together, DeepSeek, Ollama, …):

| Env var | Example | Notes |
|---|---|---|
| `LLM_BASE_URL` | `https://api.openai.com/v1` | any OpenAI-compatible base URL |
| `LLM_API_KEY` | `sk-…` | your provider API key |
| `LLM_MODEL` | `gpt-4o-mini` | optional, default `gpt-4o-mini` |

```bash
vercel env add LLM_BASE_URL production --value "https://api.openai.com/v1" -y
vercel env add LLM_API_KEY production --value "sk-…" -y
vercel env add LLM_MODEL production --value "gpt-4o-mini" -y
# then redeploy: vercel deploy --prod -y
```

Until then the AI assistant works locally/in the sandbox and shows a clear
explanatory error on Vercel.

**Serverless hardening already shipped (2026-10-25):**
- z-ai config auto-bootstrap from `ZAI_CONFIG_B64` env → `/tmp/.z-ai-config`
  (HOME pointed at /tmp so `os.homedir()` finds it)
- AI chat find-or-create conversation (per-lambda ephemeral DB isolation)
- Client-side thread history (localStorage) merged into the UI + sent as
  `history` for multi-turn context when server history is empty
- GET conversation returns a synthetic empty object instead of 404 when the
  lambda doesn't hold the row
