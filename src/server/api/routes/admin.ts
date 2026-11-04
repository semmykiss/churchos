import { route } from "@/server/api/router";
import * as admin from "@/server/services/admin";
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
