import { route } from "@/server/api/router";
import { publicGetForm, publicSubmitForm, type PublicFormPayload } from "@/server/services/public-forms";
import { badRequest } from "@/server/http";

/**
 * People CRM Phase 7 — PUBLIC Visitor Connect Card endpoints (no session).
 *
 * The slug is the authoritative tenant key: it resolves the org server-side
 * and no other tenant parameter exists, so a submission cannot read or write
 * another tenant's data. Responses never include member data — only the
 * church display name, the field configuration and a thank-you message.
 * POST is rate-limited per IP and honeypot-protected inside the service.
 */
export function registerPublicFormRoutes() {
  route({
    method: "GET",
    pattern: "public/connect/:slug",
    isPublic: true,
    handler: async (ctx) => publicGetForm(ctx.params.slug),
  });

  route({
    method: "POST",
    pattern: "public/connect/:slug/submit",
    isPublic: true,
    handler: async (ctx) => {
      const payload: PublicFormPayload = {};
      if (ctx.body && typeof ctx.body === "object") {
        for (const [k, v] of Object.entries(ctx.body as Record<string, unknown>)) {
          if (typeof v === "string") payload[k] = v;
        }
      }
      if (!payload || typeof payload !== "object") throw badRequest("Invalid submission.");
      return publicSubmitForm(ctx.params.slug, payload, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });
}
