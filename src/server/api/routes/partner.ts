import { route } from "@/server/api/router";
import { partnerLogin, revokePartnerSession, PARTNER_COOKIE } from "@/server/partner-auth";
import {
  badRequest, jsonOk, authCookieHeader, clearAuthCookieHeaders, jsonWithCookies, isSecureRequest,
} from "@/server/http";
import { withIdempotency } from "@/server/services/idempotency";
import {
  partnerOverview,
  partnerPlans,
  listTenants,
  getTenant,
  createTenant,
  setTenantStatus,
  tenantDeletePreview,
  softDeleteTenant,
  listLicenses,
  getLicense,
  issueLicense,
  updateLicense,
  revealLicenseKey,
} from "@/server/services/partner";
import type { PartnerPrincipal } from "@/server/partner-auth";

/**
 * Partner console routes (backend only). All paths are prefixed partner/.
 * Guarding happens in the router: partner/* (except login) requires a valid
 * partner session cookie — church-tenant sessions are never accepted here.
 */
/** Partner console cookie — church-tenant sessions are never accepted here.
 *  Embedded-preview safe: SameSite=None; Secure; Partitioned over HTTPS
 *  (same treatment as the church session cookie, see http.ts). */
function partnerCookie(sessionId: string, req: Request) {
  return authCookieHeader(PARTNER_COOKIE, sessionId, 7 * 24 * 3600, isSecureRequest(req));
}

function actor(ctx: { partner: PartnerPrincipal | null; ip: string | null; userAgent: string | null }) {
  return { label: ctx.partner?.email ?? "partner", ip: ctx.ip, userAgent: ctx.userAgent };
}

/** Tiny in-memory rate limiter (same pattern as routes/auth.ts) — login brute-force guard. */
const loginAttempts = new Map<string, number[]>();
const RATE_MAP_MAX = 5000;

/** Bound the limiter map — unbounded keys are a memory-DoS vector. On insert,
 *  prune the oldest ~1000 entries (Map preserves insertion order). */
function boundRateMap(): void {
  if (loginAttempts.size <= RATE_MAP_MAX) return;
  let n = 1000;
  for (const key of loginAttempts.keys()) {
    if (n-- <= 0) break;
    loginAttempts.delete(key);
  }
}

function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (loginAttempts.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  loginAttempts.set(key, hits);
  boundRateMap();
  return hits.length > max;
}

export function registerPartnerRoutes() {
  route({
    method: "POST",
    pattern: "partner/auth/login",
    isPublic: true,
    handler: async (ctx) => {
      const { email, password } = ctx.body ?? {};
      if (!email || !password) throw badRequest("Email and password are required.");
      if (rateLimited(`partner-login|${ctx.ip ?? "unknown"}`, 10, 60 * 1000)) {
        return jsonOk({ error: "rate_limited", message: "Too many sign-in attempts. Try again shortly." }, { status: 429 });
      }
      const result = await partnerLogin(email, password, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
      if (!result.ok && result.error === "locked") {
        const secs = result.retryAfterSeconds ?? 0;
        return jsonOk(
          { error: "locked", message: `Too many attempts. Try again in ${secs}s.`, details: { retryAfterSeconds: secs } },
          { status: 429 },
        );
      }
      if (!result.ok || !result.sessionId) {
        // Generic message — never reveal whether the email or the password failed.
        return jsonOk({ error: "invalid_credentials", message: "Invalid email or password." }, { status: 401 });
      }
      return jsonWithCookies({ partner: result.partner }, [partnerCookie(result.sessionId, ctx.req)]);
    },
  });

  route({
    method: "POST",
    pattern: "partner/auth/logout",
    handler: async (ctx) => {
      if (ctx.partner) await revokePartnerSession(ctx.partner.sessionId);
      return jsonWithCookies({ ok: true }, clearAuthCookieHeaders(PARTNER_COOKIE, ctx.req));
    },
  });

  route({
    method: "GET",
    pattern: "partner/auth/me",
    handler: async (ctx) => ({ partner: ctx.partner }),
  });

  route({
    method: "GET",
    pattern: "partner/plans",
    handler: async () => partnerPlans(),
  });

  route({
    method: "GET",
    pattern: "partner/overview",
    handler: async () => partnerOverview(),
  });

  route({
    method: "GET",
    pattern: "partner/tenants",
    handler: async (ctx) =>
      listTenants({
        search: ctx.query.get("search") ?? undefined,
        status: ctx.query.get("status") ?? undefined,
        page: Number(ctx.query.get("page")) || undefined,
        pageSize: Number(ctx.query.get("pageSize")) || undefined,
      }),
  });

  route({
    method: "GET",
    pattern: "partner/tenants/:id",
    handler: async (ctx) => getTenant(ctx.params.id),
  });

  // Passwordless, idempotent onboarding. The Idempotency-Key header makes a
  // retried request replay the stored response instead of creating a second
  // church; the owner's one-time invite link is inside the (stored) response.
  route({
    method: "POST",
    pattern: "partner/tenants",
    handler: async (ctx) => {
      const idempotencyKey = (ctx.req.headers.get("idempotency-key") ?? "").trim();
      if (!idempotencyKey) throw badRequest("Idempotency-Key header is required.");
      if (idempotencyKey.length > 200) throw badRequest("Idempotency-Key must be 200 characters or fewer.");
      const { replayed, result } = await withIdempotency(
        idempotencyKey,
        "partner/tenants",
        ctx.partner?.partnerUserId ?? "unknown", // scope the key PER PARTNER — never shared across partners
        () => createTenant(ctx.body, actor(ctx)),
      );
      if (replayed) {
        return jsonOk(result, { headers: { "x-idempotent-replay": "true" } });
      }
      return result;
    },
  });

  route({
    method: "PATCH",
    pattern: "partner/tenants/:id/status",
    handler: async (ctx) =>
      setTenantStatus(ctx.params.id, ctx.body?.status, actor(ctx), ctx.body?.reason),
  });

  // deletion preview (counts shown in the confirm dialog)
  route({
    method: "GET",
    pattern: "partner/tenants/:id/delete-preview",
    handler: async (ctx) => tenantDeletePreview(ctx.params.id),
  });

  // SOFT delete — 30-day recoverable archive. The confirmation is the tenant's
  // slug (server-checked); rate-limited per partner+IP in the service.
  route({
    method: "POST",
    pattern: "partner/tenants/:id/delete",
    handler: async (ctx) =>
      softDeleteTenant(
        ctx.params.id,
        { confirmSlug: ctx.body?.confirmSlug, reason: ctx.body?.reason },
        actor(ctx),
        `${ctx.partner?.partnerUserId ?? "unknown"}|${ctx.ip ?? "unknown"}`,
      ),
  });

  route({
    method: "GET",
    pattern: "partner/licenses",
    handler: async (ctx) => listLicenses({ status: ctx.query.get("status") ?? undefined }),
  });

  route({
    method: "GET",
    pattern: "partner/licenses/:id",
    handler: async (ctx) => getLicense(ctx.params.id),
  });

  // Full license key — audited; list/detail views only ever carry masked keys.
  route({
    method: "POST",
    pattern: "partner/licenses/:id/reveal-key",
    handler: async (ctx) => revealLicenseKey(ctx.params.id, actor(ctx)),
  });

  route({
    method: "POST",
    pattern: "partner/licenses",
    handler: async (ctx) => issueLicense(ctx.body, actor(ctx)),
  });

  route({
    method: "PATCH",
    pattern: "partner/licenses/:id",
    handler: async (ctx) => updateLicense(ctx.params.id, ctx.body, actor(ctx)),
  });
}
