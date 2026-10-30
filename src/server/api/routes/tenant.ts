import { route } from "@/server/api/router";
import { badRequest } from "@/server/http";
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
} from "@/server/services/tenant/compliance";
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
    return new Response(webStream, {
      headers: {
        "content-type": contentType,
        "content-disposition": `inline; filename="${kind}-${fileId.slice(-8)}"`,
        "cache-control": "private, no-store",
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

  route({
    method: "GET",
    pattern: "partner/compliance/documents/:fileId",
    handler: async (ctx) => documentResponse(ctx.params.fileId),
  });

  route({
    method: "GET",
    pattern: "partner/compliance/:orgId",
    handler: async (ctx) => complianceDetail(ctx.params.orgId),
  });

  route({
    method: "POST",
    pattern: "partner/compliance/:orgId/verify",
    handler: async (ctx) =>
      verifyTenant(ctx.params.orgId, {
        label: ctx.partner?.email ?? "partner",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }),
  });
}

