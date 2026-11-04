# Task 4 — Partner Console SERVER CONTRACT (backend)

Agent: server-contract implementer. Files owned per assignment; all contract paths/response shapes implemented exactly as specified.

## (a) Endpoint-by-endpoint

| # | Endpoint | Status |
|---|----------|--------|
| 1 | `GET /partner/plans` | ✅ `{ plans: [{ key, label, monthlyPriceCents, defaultSeats }] }` — Starter 9900/100, Growth 24900/250, Multisite 49900/1000 (integer kobo via `PLAN_META`). |
| 2 | `GET /partner/tenants` | ✅ `page` (1-based), `pageSize` (clamp 1..50, default 10), `search`, `status` allow-list (all\|active\|pending\|suspended; pending→`pending_verification`). Fixed sort `createdAt desc`. `deletedAt: null` filter. findMany+count in **parallel** (+people groupBy). Response `{ rows, total, page, pageSize, pageCount }`, `pageCount=max(1,ceil(total/pageSize))`. Rows: `licenseKey` masked `GCHMS-••••-••••-<last>`, NEW `licenseId`. |
| 3 | `POST /partner/tenants` | ✅ Requires `Idempotency-Key` header (case-insensitive via `ctx.req.headers`; missing→400 `"Idempotency-Key header is required."`, >200 chars→400). New `src/server/services/idempotency.ts` `withIdempotency<T>()`: composite key `endpoint:key`, live record (expiresAt>now)→replay `{replayed:true,result}`; store `{status:200,responseJson,expiresAt:+24h}`; ~1/20 fire-and-forget `deleteMany` cleanup; non-serializable → skip store. Replays return 200 + `x-idempotent-replay: true` header. **Passwordless**: owner `{name,email}` only; `passwordHash=hashPassword(randomBytes(32) hex)` (unusable) + `mustChangePassword:true`. slug: explicit→`validateSubdomain` (format+reserved) else `slugify(name)`; uniqueness via `subdomainAvailable()`→409, owner email exists→409 `"A user with this email already exists. Invitations cannot overwrite existing accounts."` Tx: Organization (status active, `onboardedVia:"partner"`, **timezone default `Africa/Lagos`**, currency NGN) + `reserveSubdomainInTx` + campus/roles/membership/roleAssignment + License. AFTER commit: AuthToken (`magic_login`, 24h, sha256-hashed, token=`randomBytes(24).toString("hex")`) → `inviteLink=/?magic=<token>` (consumed by EXISTING magic-verify); TenantOnboardingAudit step `partner_invite_issued`; AuditLog `partner.tenant_created` after `{name,plan,seats,termMonths,inviteIssued:true}` (never token/password). Response `{ id, name, slug, licenseKey: FULL, plan, seats, status, expiresAt, inviteLink }`. |
| 4 | `PATCH /partner/tenants/:id/status` | ✅ body `{status: active\|suspended, reason}`; unknown status→400; reason<10→400; audit before `{status}` / after `{status, reason}`; soft-deleted→404 `"Tenant not found."`; pending_verification→active still requires compliance queue. |
| 5 | delete-preview / delete / purge | ✅ preview unchanged shape, soft-deleted→404. `POST /partner/tenants/:id/delete` body `{confirmSlug, reason}` — both required; slug mismatch→400 `"Slug confirmation does not match."`; reason≥10; in-memory rate limit (partner userId+ip, 3/10min→429). Tx sets `{deletedAt, deletionReason, recoverUntil=+30d, status:"archived"}` + AuditLog `partner.tenant_delete_scheduled` (after `{name, slug, reason, recoverUntil}`) **inside the same tx, before anything destructive**. Sessions NOT touched (gate blocks). Response `{ name, recoverUntil }`. `purgeExpiredDeletions()` finds `recoverUntil<now AND deletedAt!=null` → runs extracted `hardDeleteOrgById()` (original wipe order/tombstone/subdomain release/uploads rm kept verbatim; `as any` wipe helper replaced with typed `keyof Prisma.TransactionClient` dispatch). Fired `void…catch` at START of `listTenants` + `partnerOverview` (lazy job, in-flight guard, documented). |
| 6 | `GET /partner/licenses` + `GET /partner/licenses/:id` | ✅ rows: `key` masked, `updatedAt` ISO\|null, `deletedAt:null` org filter, status filter kept; single → same row shape, 404 if missing/soft-deleted. |
| 7 | `PATCH /partner/licenses/:id` + `POST …/reveal-key` | ✅ `statusReason?`, `expectedUpdatedAt?`; optimistic concurrency: `license.updatedAt` non-null && mismatch → **409 `stale_write`** `"This license was just changed by someone else. Reload and try again."` (null updatedAt → skip). State machine `ALLOWED_TRANSITIONS` exactly per contract; `cancelled` final → 400 `"Cancelled licenses are final and cannot be reactivated."`; suspended/cancelled require reason≥10 (stored in audit before/after JSON, NOT notes); extendMonths clamp 1..60; auto-reactivation only when `input.status` undefined. Response = fresh licenseRow. reveal-key → `{key}` FULL + audit `partner.license_key_revealed` after `{licenseId, orgName}`; 404 missing/soft-deleted. |
| 8 | compliance | ✅ `complianceDetail`: `tin`/`scumlNumber` masked via `maskSensitive`; trustee + headPastor `phone`/`email` **removed entirely**; cac.number/addresses/ninMasked/accountNumberMasked kept. `verify` requires `{attested:true}` → 400 `"Attestation is required to verify."`; bypass reason min **20** chars; bypass env gating untouched. NEW `POST /partner/compliance/:orgId/request-changes` (reason≥10 → TenantOnboardingAudit step `changes_requested` snapshot `{reason: slice(0,500)}` + AuditLog `partner.compliance_changes_requested`; stays pending_verification; → `{ok:true}`). NEW `GET /partner/compliance/documents/:fileId/url` → `{url:"/api/v1/partner/compliance/documents/<id>?token=<expires>.<hmac>", expiresAt}` ttl 5min + audit `partner.document_url_issued`. Stream route now `isPublic` + session-OR-token (`verifyDocumentToken`, constant-time), audit `partner.document_viewed` (after `{fileId,kind,via:"session"\|"signed-url"}`) BEFORE streaming, headers `X-Content-Type-Options: nosniff`, contentType fallback `application/octet-stream`, sanitized `Content-Disposition` filename `[A-Za-z0-9._-]`, no-store kept; deleted FileRecords rejected. |
| 9 | partner auth hardening | ✅ `partnerLogin`: 8 fails → `lockedUntil=+15min`, `{ok:false,error:"locked",retryAfterSeconds}` while locked; success resets counters. Route: locked→429 `{error:"locked",message:"Too many attempts. Try again in Ns.",details:{retryAfterSeconds}}`; invalid→401 generic `"Invalid email or password."`; IP limiter 10/min (auth.ts pattern). `getPartnerSessionUser`: idle>20min → revoke+null; success touches `lastSeenAt` fire-and-forget; null lastSeenAt (legacy) stamped on first use. Rotation untouched. |

## (b) Deviations + why

1. **crypto.ts got two exported helpers** (`signDocumentToken`/`verifyDocumentToken` + private `signingKey()` domain-separated from the AES key). crypto.ts wasn't in the owned-files list, but contract §8 explicitly authorizes "add an exported signDocumentToken/verifyDocumentToken pair to crypto.ts OR a small helper inside compliance.ts" — chose crypto.ts so the env-derived secret exists in exactly ONE place. Purely additive; existing exports untouched.
2. **`getTenant` now masks `license.key`** too (contract only mandates masking for list/license rows). Leaving the raw key there would defeat the reveal-key audit trail; shape otherwise unchanged.
3. **request-changes rejects non-`pending_verification` orgs** (400) — contract says "tenant stays pending_verification"; requesting changes on an active/archived tenant is a no-op trap, so it's guarded.
4. **auth.ts: ZERO edits** (prefer-no-changes honored). Both `getSessionUser` and `issueSessionForUser` already resolve the org's `status` and reject anything outside `active|pending_verification` — soft-deleted orgs become `archived`, so church sessions/sign-ins die without touching auth.ts. Verified by reading.
5. **router.ts: ZERO edits** — it never loads the Organization; it resolves sessions via auth.ts/partner-auth.ts only.
6. `createTenant` `owner.password` removed from `CreateTenantInput` (contract) — signature position/count unchanged, so callers are unaffected (only routes/partner.ts calls it).
7. `existsAsOrgSlug` (subdomain.ts) → `findFirst({where:{slug, deletedAt:null}})` — the one permitted minimal edit; a soft-deleted tenant's slug remains blocked through the registry reservation until purge releases it.
8. **Idempotent replay stores createTenant's response with `expiresAt` as ISO string** (JSON) — on replay the field is a string instead of a Date; serialization-identical over the wire.

## (c) Files changed

- `src/server/services/partner.ts` — rewritten around the contract (plans meta, masked keys, pagination, passwordless create, soft delete + purge, license state machine/concurrency/reveal).
- `src/server/api/routes/partner.ts` — plans/pagination/idempotency/status-reason/soft-delete/licenses single+reveal routes; login 429/401 hardening + IP limiter.
- `src/server/partner-auth.ts` — lockout (8/15min), 20-min idle timeout + lastSeenAt touch.
- `src/server/services/idempotency.ts` — NEW `withIdempotency<T>` replay store.
- `src/server/services/tenant/compliance.ts` — PII masking/removal, attestation, bypass≥20, `requestComplianceChanges`, `issueDocumentAccessUrl`, soft-delete filters.
- `src/server/api/routes/tenant.ts` — partner/compliance section only: verify attested, request-changes, document URL route, stream session-or-token + view audit; `documentResponse` nosniff+filename sanitize (shared with church route — headers only).
- `src/server/services/tenant/crypto.ts` — additive HMAC token pair (`signDocumentToken`/`verifyDocumentToken`).
- `src/server/services/tenant/subdomain.ts` — 1-line soft-delete filter in `existsAsOrgSlug`.
- `src/server/auth.ts` — **unchanged** (status checks already exclude archived). `src/server/api/router.ts` — **unchanged**.

## (d) Lint / types

- `bun run lint` → **✖ 5 problems (0 errors, 5 warnings)** — all 5 warnings pre-existing `react-hooks/incompatible-library` in unrelated frontend files.
- `bunx tsc --noEmit` filtered to all touched server files → **0 errors** (repo has many pre-existing errors in unrelated scripts/components — untouched).

## (e) How to test (curl; base = `$B` e.g. http://localhost:3000/api/v1)

```bash
# login (cookie jar)
curl -s -c /tmp/pj.txt -X POST $B/partner/auth/login -H 'content-type: application/json' \
  -d '{"email":"partner@gracechms.demo","password":"partner2026"}'

# 1) plans
curl -s -b /tmp/pj.txt $B/partner/plans

# 3) passwordless + idempotent onboarding (re-run same command → identical body + x-idempotent-replay: true)
curl -s -b /tmp/pj.txt -D /tmp/h.txt -X POST $B/partner/tenants \
  -H 'content-type: application/json' -H 'idempotency-key: demo-key-001' \
  -d '{"name":"Grace Chapel Lagos","plan":"starter","seats":100,"termMonths":12,"licenseStatus":"trial","owner":{"name":"Ada","email":"ada@gracechapel.demo"}}'
grep -i idempotent /tmp/h.txt   # first call: absent · replay: x-idempotent-replay: true

# 2) paginated list (masked keys, licenseId, pageCount)
curl -s -b /tmp/pj.txt "$B/partner/tenants?page=1&pageSize=10&status=active"

# 7) optimistic concurrency (send the updatedAt you got from GET /partner/licenses/:id; wrong value → 409 stale_write)
curl -s -b /tmp/pj.txt -X PATCH $B/partner/licenses/<LICENSE_ID> -H 'content-type: application/json' \
  -d '{"status":"suspended","statusReason":"Non-payment for two consecutive months","expectedUpdatedAt":null}'

# 8) signed document URL → then stream with token only (no cookie)
curl -s -b /tmp/pj.txt $B/partner/compliance/documents/<FILE_ID>/url
curl -s -D - "$B/partner/compliance/documents/<FILE_ID>?token=<token>" -o /tmp/doc.bin
```
