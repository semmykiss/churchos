import { z } from "zod";
import { route } from "@/server/api/router";
import { partnerLogin, revokePartnerSession, PARTNER_COOKIE } from "@/server/partner-auth";
import {
  badRequest, forbidden, jsonOk, authCookieHeader, clearAuthCookieHeaders, jsonWithCookies, isSecureRequest,
} from "@/server/http";
import { withIdempotency } from "@/server/services/idempotency";
import {
  ipEmailLockRemaining, ipFailureRateExceeded, recordLoginFailure, clearLoginFailures,
} from "@/server/services/partner-login-guard";
import { optNum, optObj, optStr } from "@/server/api/body";
import {
  LICENSE_STATUSES,
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

function actor(ctx: { partner: PartnerPrincipal | null; ip: string | null; userAgent: string | null; requestId: string }) {
  return {
    label: ctx.partner?.email ?? "partner",
    partnerUserId: ctx.partner?.partnerUserId,
    sessionId: ctx.partner?.sessionId,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

/**
 * Login body contract (Zod, strict): strings only, bounded lengths, unknown
 * fields rejected. Without this a non-string email/password reached the
 * credential check unvalidated (B4/Zod-at-every-boundary).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LoginBody = z
  .object({
    email: z.string().trim().toLowerCase().max(254).regex(EMAIL_RE, "Invalid email address."),
    password: z.string().min(1).max(128),
  })
  .strict();

/** Identical lockout body for known and unknown accounts — no enumeration. */
function lockedResponse(secs: number): Response {
  return jsonOk(
    { error: "locked", message: `Too many attempts. Try again in ${secs}s.`, details: { retryAfterSeconds: secs } },
    { status: 429 },
  );
}

export function registerPartnerRoutes() {
  route({
    method: "POST",
    pattern: "partner/auth/login",
    isPublic: true,
    handler: async (ctx) => {
      const parsed = LoginBody.safeParse(ctx.body ?? {});
      if (!parsed.success) throw badRequest("Enter a valid email address and password.");
      const { email, password } = parsed.data;
      const ip = ctx.ip ?? "unknown";

      // 1) IP+e-mail lockout — checked FIRST, returned with the SAME body shape
      //    as the account lock, for known and unknown addresses alike (no
      //    enumeration). No DB access happens while a bucket is locked.
      const lockSecs = ipEmailLockRemaining(ip, email);
      if (lockSecs > 0) return lockedResponse(lockSecs);
      // 2) IP failure-rate burst guard — counts FAILURES only; successful
      //    sign-ins never consume budget (partner-login-guard.ts).
      if (ipFailureRateExceeded(ip)) {
        return jsonOk({ error: "rate_limited", message: "Too many sign-in attempts. Try again shortly." }, { status: 429 });
      }

      const result = await partnerLogin(email, password, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
      if (result.ok && result.sessionId) {
        clearLoginFailures(ip, email); // success clears the bucket — failure debt never outlives a real sign-in
        return jsonWithCookies({ partner: result.partner }, [partnerCookie(result.sessionId, ctx.req)]);
      }
      if (!result.ok && result.error === "locked") {
        return lockedResponse(result.retryAfterSeconds ?? 0);
      }
      // Credential failure — recorded BEFORE responding (buckets count failures only).
      recordLoginFailure(ip, email);
      // Generic message — never reveal whether the email or the password failed.
      return jsonOk({ error: "invalid_credentials", message: "Invalid email or password." }, { status: 401 });
    },
  });

  route({
    method: "POST",
    pattern: "partner/auth/logout",
    // PUBLIC + idempotent: logout must work even when the session is already
    // expired/absent — the guard must not 401 before the cookie gets cleared,
    // and revoking an already-revoked session is a no-op (updateMany).
    isPublic: true,
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
      if (!ctx.partner) throw forbidden("Partner principal required."); // router guard guarantees this — belt and braces (B2)
      const idempotencyKey = (ctx.req.headers.get("idempotency-key") ?? "").trim();
      if (!idempotencyKey) throw badRequest("Idempotency-Key header is required.");
      if (idempotencyKey.length > 200) throw badRequest("Idempotency-Key must be 200 characters or fewer.");
      const owner = optObj(ctx.body?.owner);
      const { replayed, result } = await withIdempotency(
        idempotencyKey,
        "partner/tenants",
        ctx.partner.partnerUserId, // scope the key PER PARTNER — never shared across partners
        () =>
          createTenant(
            {
              name: optStr(ctx.body?.name) ?? "",
              slug: optStr(ctx.body?.slug),
              timezone: optStr(ctx.body?.timezone),
              currency: optStr(ctx.body?.currency),
              plan: optStr(ctx.body?.plan),
              seats: optNum(ctx.body?.seats),
              termMonths: optNum(ctx.body?.termMonths),
              licenseStatus: LICENSE_STATUSES.find((s) => s === ctx.body?.licenseStatus),
              notes: optStr(ctx.body?.notes),
              owner: { name: optStr(owner?.name) ?? "", email: optStr(owner?.email) ?? "" },
            },
            actor(ctx),
          ),
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
      setTenantStatus(ctx.params.id, optStr(ctx.body?.status) ?? "", actor(ctx), optStr(ctx.body?.reason)),
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
    handler: async (ctx) => {
      if (!ctx.partner) throw forbidden("Partner principal required."); // router guard guarantees this — belt and braces (B2)
      return softDeleteTenant(
        ctx.params.id,
        { confirmSlug: ctx.body?.confirmSlug, reason: ctx.body?.reason },
        actor(ctx),
        `${ctx.partner.partnerUserId}|${ctx.ip ?? "unknown"}`,
      );
    },
  });

  route({
    method: "GET",
    pattern: "partner/licenses",
    handler: async (ctx) =>
      listLicenses({
        status: ctx.query.get("status") ?? undefined,
        page: Number(ctx.query.get("page")) || undefined,
        pageSize: Number(ctx.query.get("pageSize")) || undefined,
      }),
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
    handler: async (ctx) => {
      if (!ctx.partner) throw forbidden("Partner principal required."); // router guard guarantees this — belt and braces (B2)
      const orgId = optStr(ctx.body?.orgId);
      if (!orgId) throw badRequest("orgId is required.");
      // Idempotent issuance — a retried request replays the stored response
      // instead of double-issuing a license (same contract as onboarding).
      const idempotencyKey = (ctx.req.headers.get("idempotency-key") ?? "").trim();
      if (!idempotencyKey) throw badRequest("Idempotency-Key header is required.");
      if (idempotencyKey.length > 200) throw badRequest("Idempotency-Key must be 200 characters or fewer.");
      const { replayed, result } = await withIdempotency(
        idempotencyKey,
        "partner/licenses",
        ctx.partner.partnerUserId, // scope the key PER PARTNER
        () =>
          issueLicense(
            {
              orgId,
              plan: optStr(ctx.body?.plan),
              seats: optNum(ctx.body?.seats),
              termMonths: optNum(ctx.body?.termMonths),
              status: LICENSE_STATUSES.find((s) => s === ctx.body?.status),
              notes: optStr(ctx.body?.notes),
            },
            actor(ctx),
          ),
      );
      if (replayed) {
        return jsonOk(result, { headers: { "x-idempotent-replay": "true" } });
      }
      return result;
    },
  });

  route({
    method: "PATCH",
    pattern: "partner/licenses/:id",
    handler: async (ctx) =>
      updateLicense(
        ctx.params.id,
        {
          plan: optStr(ctx.body?.plan),
          seats: optNum(ctx.body?.seats),
          status: LICENSE_STATUSES.find((s) => s === ctx.body?.status),
          extendMonths: optNum(ctx.body?.extendMonths),
          notes: ctx.body?.notes === null ? null : optStr(ctx.body?.notes),
          statusReason: optStr(ctx.body?.statusReason),
          expectedUpdatedAt: optStr(ctx.body?.expectedUpdatedAt),
        },
        actor(ctx),
      ),
  });
}
