import { route } from "@/server/api/router";
import * as admin from "@/server/services/admin";
import * as integrations from "@/server/services/integrations";
import { optStr } from "@/server/api/body";

/**
 * Admin routes (thin controllers — all logic in services).
 * Settings PUT declares admin.view at the gate; the owner-only rule is
 * enforced inside the service (roleKeys check) and audited.
 */
export function registerAdminRoutes() {
  route({
    method: "GET", pattern: "admin/permission-matrix", permission: "admin.view",
    handler: async (ctx) => admin.permissionMatrix(ctx.user!),
  });

  route({
    method: "GET", pattern: "audit-log", permission: "audit.view",
    handler: async (ctx) =>
      admin.auditLog(ctx.user!, {
        page: Number(ctx.query.get("page") ?? 1),
        action: ctx.query.get("action") ?? undefined,
        entityType: ctx.query.get("entityType") ?? undefined,
        search: ctx.query.get("search") ?? undefined,
      }),
  });

  route({
    method: "GET", pattern: "admin/settings", permission: "admin.view",
    handler: async (ctx) => admin.getSettings(ctx.user!),
  });

  route({
    method: "PUT", pattern: "admin/settings", permission: "admin.view",
    handler: async (ctx) => admin.updateSettings(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  // ── Integrations: email server (SMTP) & SMS API ────────────────────────────
  // Reads need admin.view; writes/tests are owner-only (enforced inside the
  // service, mirroring the org-settings rule) and audited. Secrets are stored
  // AES-256-GCM encrypted and only ever returned masked.
  route({
    method: "GET", pattern: "admin/integrations", permission: "admin.view",
    handler: async (ctx) => integrations.getIntegrations(ctx.user!),
  });

  route({
    method: "PUT", pattern: "admin/integrations/email", permission: "admin.view",
    handler: async (ctx) => integrations.updateEmailIntegration(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "PUT", pattern: "admin/integrations/sms", permission: "admin.view",
    handler: async (ctx) => integrations.updateSmsIntegration(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "admin/integrations/email/test", permission: "admin.view",
    handler: async (ctx) => integrations.testEmailIntegration(ctx.user!, { to: optStr(ctx.body?.to) }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "admin/integrations/sms/test", permission: "admin.view",
    handler: async (ctx) => integrations.testSmsIntegration(ctx.user!, { to: optStr(ctx.body?.to) }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "admin/imports", permission: "admin.view",
    handler: async (ctx) => admin.listImports(ctx.user!),
  });

  route({
    method: "POST", pattern: "admin/imports/stage", permission: "admin.view",
    handler: async (ctx) => admin.stageImport(ctx.user!, { csvText: optStr(ctx.body?.csvText), fileName: optStr(ctx.body?.fileName) }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "admin/imports/:id/commit", permission: "admin.view",
    handler: async (ctx) => admin.commitImport(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "admin/imports/:id/rollback", permission: "admin.view",
    handler: async (ctx) => admin.rollbackImport(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
}
