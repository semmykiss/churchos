import { route } from "@/server/api/router";
import { badRequest, notFound, unauthorized } from "@/server/http";
import { Readable } from "stream";
import { db } from "@/server/db";
import {
  createTenantFromSignup,
  checkSignupRateLimit,
  onboardingStatusFor,
  brandingForSubdomain,
} from "@/server/services/tenant/onboarding";
import {
  complianceQueue,
  complianceDetail,
  verifyTenant,
  readDocument,
  requestComplianceChanges,
  issueDocumentAccessUrl,
} from "@/server/services/tenant/compliance";
import { verifyDocumentToken } from "@/server/services/tenant/crypto";
import { suggestSubdomains, subdomainAvailable, validateSubdomain, TENANT_URL_BASE } from "@/server/services/tenant/subdomain";
import { NIGERIAN_STATES, STATE_LGAS, NIGERIAN_BANKS, DENOMINATIONS, ID_TYPES, DPA_VERSION, DPA_SUMMARY } from "@/lib/nigeria";

/**
 * Tenant onboarding routes (backend only).
 *
 * PUBLIC  — signup wizard support: reference metadata, subdomain availability,
 *           the atomic tenant-creation endpoint (rate-limited + honeypot), and
 *           tenant branding lookup for subdomain resolution.
 * CHURCH  — onboarding status ("complete your verification" checklist) and
 *           permission-checked document streaming for org admins.
 * PARTNER — the compliance review queue (verify & activate). The router
 *           enforces the partner session for every partner/* path.
 */

function documentResponse(fileId: string) {
  return readDocument(fileId).then(({ stream, contentType, kind }) => {
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
    // Sanitize to a safe inline filename — [A-Za-z0-9._-] only.
    const filename = `${kind}-${fileId.slice(-8)}`.replace(/[^A-Za-z0-9._-]/g, "") || "document";
    return new Response(webStream, {
      headers: {
        "content-type": contentType,
        "content-disposition": `inline; filename="${filename}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        // The document URL carries a signed token — never leak it via Referer
        // when the viewer navigates away from the tab.
        "referrer-policy": "no-referrer",
      },
    });
  });
}

export function registerTenantRoutes() {
  // ── public: wizard reference data ──────────────────────────────────────────
  route({
    method: "GET",
    pattern: "tenants/meta",
    isPublic: true,
    handler: async () => ({
      states: NIGERIAN_STATES,
      lgas: STATE_LGAS,
      banks: NIGERIAN_BANKS,
      denominations: DENOMINATIONS,
      idTypes: ID_TYPES,
      dpa: { version: DPA_VERSION, summary: DPA_SUMMARY },
      urlBase: TENANT_URL_BASE,
      trusteeMinimum: 2,
    }),
  });

  route({
    method: "GET",
    pattern: "tenants/subdomain-check",
    isPublic: true,
    handler: async (ctx) => {
      const value = (ctx.query.get("value") ?? "").toLowerCase().trim();
      if (!value) throw badRequest("Provide a candidate subdomain.");
      const check = validateSubdomain(value);
      if (!check.ok) return { available: false, reason: check.reason, suggestions: [] };
      const available = await subdomainAvailable(value);
      return {
        available,
        reason: available ? null : "That address is already reserved.",
        suggestions: available ? [] : await suggestSubdomains(value.replace(/-\d+$/, ""), 3),
      };
    },
  });

  route({
    method: "GET",
    pattern: "tenants/branding",
    isPublic: true,
    handler: async (ctx) => {
      const subdomain = (ctx.query.get("subdomain") ?? "").toLowerCase().trim();
      if (!subdomain) throw badRequest("Provide a subdomain.");
      return brandingForSubdomain(subdomain);
    },
  });

  // ── public: THE atomic creation endpoint (spec §5) ─────────────────────────
  route({
    method: "POST",
    pattern: "tenants/create",
    isPublic: true,
    handler: async (ctx) => {
      checkSignupRateLimit(ctx.ip); // aggressive rate limit — abuse target
      const result = await createTenantFromSignup(ctx.body ?? {}, { ip: ctx.ip, userAgent: ctx.userAgent });
      return { ...result, note: "Store the credentials shown on screen — they are required for first sign-in." };
    },
  });

  // ── church: own onboarding status (owner/admin) ────────────────────────────
  route({
    method: "GET",
    pattern: "tenants/onboarding-status",
    permission: "admin.view",
    handler: async (ctx) => onboardingStatusFor(ctx.user!.orgId),
  });

  route({
    method: "GET",
    pattern: "tenants/documents/:fileId",
    permission: "admin.view",
    handler: async (ctx) => {
      // org-scope guard: the document must belong to the caller's tenant
      const rec = await db.fileRecord.findUnique({
        where: { id: ctx.params.fileId },
        select: { orgId: true },
      });
      if (!rec || rec.orgId !== ctx.user!.orgId) throw badRequest("Document not found in your church's records.");
      return documentResponse(ctx.params.fileId);
    },
  });

  // ── partner: compliance review queue (partner session enforced by router) ──
  route({
    method: "GET",
    pattern: "partner/compliance/queue",
    handler: async () => complianceQueue(),
  });

  // Document stream — partner session OR a valid unexpired signed URL token.
  // isPublic ON PURPOSE: the router's blanket partner gate would reject
  // token-only access, so the session-or-token decision happens here. Every
  // successful stream is audit-logged BEFORE the bytes go out.
  route({
    method: "GET",
    pattern: "partner/compliance/documents/:fileId",
    isPublic: true,
    handler: async (ctx) => {
      const viaSession = !!ctx.partner;
      const viaToken = !viaSession && verifyDocumentToken(ctx.params.fileId, ctx.query.get("token"));
      if (!viaSession && !viaToken) {
        throw unauthorized("Partner sign-in or a valid document link is required.");
      }
      const rec = await db.fileRecord.findUnique({
        where: { id: ctx.params.fileId },
        select: { orgId: true, kind: true, deletedAt: true },
      });
      if (!rec || rec.deletedAt) throw notFound("Document not found.");
      await db.auditLog.create({
        data: {
          orgId: rec.orgId,
          actorType: "support",
          actorLabel: ctx.partner?.email ?? "signed-url",
          action: "partner.document_viewed",
          entityType: "fileRecord",
          entityId: ctx.params.fileId,
          after: JSON.stringify({ fileId: ctx.params.fileId, kind: rec.kind, via: viaSession ? "session" : "signed-url" }),
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
      });
      return documentResponse(ctx.params.fileId);
    },
  });

  // Short-lived signed stream URL (5 min) — lets a reviewer open a document in
  // a new tab without copying the partner session cookie.
  route({
    method: "GET",
    pattern: "partner/compliance/documents/:fileId/url",
    handler: async (ctx) =>
      issueDocumentAccessUrl(ctx.params.fileId, {
        label: ctx.partner?.email ?? "partner",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }),
  });

  route({
    method: "GET",
    pattern: "partner/compliance/:orgId",
    handler: async (ctx) => complianceDetail(ctx.params.orgId),
  });

  route({
    method: "POST",
    pattern: "partner/compliance/:orgId/verify",
    handler: async (ctx) => {
      const attested = (ctx.body as { attested?: unknown } | undefined)?.attested === true;
      return verifyTenant(
        ctx.params.orgId,
        {
          label: ctx.partner?.email ?? "partner",
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        { attested },
      );
    },
  });

  // ── partner: BYPASS activation (sandbox/demo affordance) ───────────────────
  // Activates a pending_verification tenant even when checklist items are
  // missing. Requires a written reason (≥20 chars); writes bypass markers to
  // the org's settings + both audit trails. Disabled entirely when
  // COMPLIANCE_BYPASS=off or NODE_ENV=production — full deployments make every
  // item mandatory again.
  route({
    method: "POST",
    pattern: "partner/compliance/:orgId/bypass-verify",
    handler: async (ctx) => {
      const body = (ctx.body ?? {}) as { reason?: unknown };
      return verifyTenant(
        ctx.params.orgId,
        {
          label: ctx.partner?.email ?? "partner",
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        { bypass: true, reason: typeof body.reason === "string" ? body.reason : "" },
      );
    },
  });

  // ── partner: request changes (tenant stays pending_verification) ──────────
  route({
    method: "POST",
    pattern: "partner/compliance/:orgId/request-changes",
    handler: async (ctx) => {
      const body = (ctx.body ?? {}) as { reason?: unknown };
      return requestComplianceChanges(
        ctx.params.orgId,
        {
          label: ctx.partner?.email ?? "partner",
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        typeof body.reason === "string" ? body.reason : "",
      );
    },
  });
}

