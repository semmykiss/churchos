import { route } from "@/server/api/router";
import { partnerLogin, revokePartnerSession, PARTNER_COOKIE } from "@/server/partner-auth";
import {
  badRequest, jsonOk, authCookieHeader, clearAuthCookieHeaders, jsonWithCookies, isSecureRequest,
} from "@/server/http";
import {
  partnerOverview,
  listTenants,
  getTenant,
  createTenant,
  setTenantStatus,
  tenantDeletePreview,
  deleteTenantOrg,
  listLicenses,
  issueLicense,
  updateLicense,
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

export function registerPartnerRoutes() {
  route({
    method: "POST",
    pattern: "partner/auth/login",
    isPublic: true,
    handler: async (ctx) => {
      const { email, password } = ctx.body ?? {};
      if (!email || !password) throw badRequest("Email and password are required.");
      const result = await partnerLogin(email, password, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
      if (!result.ok || !result.sessionId) {
        return jsonOk({ error: "invalid_credentials", message: result.error }, { status: 401 });
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
    pattern: "partner/overview",
    handler: async () => partnerOverview(),
  });

  route({
    method: "GET",
    pattern: "partner/tenants",
    handler: async (ctx) =>
      listTenants({ search: ctx.query.get("search") ?? undefined, status: ctx.query.get("status") ?? undefined }),
  });

  route({
    method: "GET",
    pattern: "partner/tenants/:id",
    handler: async (ctx) => getTenant(ctx.params.id),
  });

  route({
    method: "POST",
    pattern: "partner/tenants",
    handler: async (ctx) => createTenant(ctx.body, actor(ctx)),
  });

  route({
    method: "PATCH",
    pattern: "partner/tenants/:id/status",
    handler: async (ctx) => setTenantStatus(ctx.params.id, ctx.body?.status, actor(ctx)),
  });

  // deletion preview (counts shown in the confirm dialog)
  route({
    method: "GET",
    pattern: "partner/tenants/:id/delete-preview",
    handler: async (ctx) => tenantDeletePreview(ctx.params.id),
  });

  // permanent delete — confirmName must match the church display name exactly
  route({
    method: "POST",
    pattern: "partner/tenants/:id/delete",
    handler: async (ctx) => deleteTenantOrg(ctx.params.id, ctx.body?.confirmName, actor(ctx)),
  });

  route({
    method: "GET",
    pattern: "partner/licenses",
    handler: async (ctx) => listLicenses({ status: ctx.query.get("status") ?? undefined }),
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
