import { route } from "@/server/api/router";
import * as documents from "@/server/services/documents";

/**
 * Documents (DMS) routes. Static segments are registered BEFORE ":id" so the
 * router matches them exactly (same precedent as assets/bookings). Every
 * handler re-checks rights inside the service — these gates are the outer net.
 */
export function registerDocumentRoutes() {
  // ── library list + stats ───────────────────────────────────────────────────
  route({
    method: "GET", pattern: "documents", permission: "documents.view",
    handler: async (ctx) =>
      documents.listDocuments(ctx.user!, {
        q: ctx.query.get("q") ?? undefined,
        category: ctx.query.get("category") ?? undefined,
        access: ctx.query.get("access") ?? undefined,
        status: ctx.query.get("status") ?? undefined,
        kind: ctx.query.get("kind") ?? undefined,
        owner: ctx.query.get("owner") ?? undefined,
        tag: ctx.query.get("tag") ?? undefined,
        folderId: ctx.query.get("folderId") ?? undefined,
        from: ctx.query.get("from") ?? undefined,
        to: ctx.query.get("to") ?? undefined,
        scope: ctx.query.get("scope") ?? undefined,
        sort: ctx.query.get("sort") ?? undefined,
        dir: ctx.query.get("dir") ?? undefined,
        page: ctx.query.get("page") ?? undefined,
        pageSize: ctx.query.get("pageSize") ?? undefined,
        trash: ctx.query.get("trash") ?? undefined,
        includeInfected: ctx.query.get("includeInfected") ?? undefined,
      }),
  });

  // ── folders ────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "documents/folders", permission: "documents.view",
    handler: async (ctx) => documents.listFolders(ctx.user!),
  });
  route({
    method: "POST", pattern: "documents/folders", permission: "documents.create",
    handler: async (ctx) => documents.createFolder(ctx.user!, ctx.body ?? {}, ctx),
  });
  route({
    method: "PATCH", pattern: "documents/folders/:id", permission: "documents.edit",
    handler: async (ctx) => documents.renameFolder(ctx.user!, ctx.params.id, ctx.body ?? {}, ctx),
  });
  route({
    method: "DELETE", pattern: "documents/folders/:id", permission: "documents.delete",
    handler: async (ctx) => documents.deleteFolder(ctx.user!, ctx.params.id, ctx),
  });

  // ── trash / settings / exports / bulk / lookups ────────────────────────────
  route({
    method: "GET", pattern: "documents/trash", permission: "documents.view",
    handler: async (ctx) =>
      documents.listTrash(ctx.user!, {
        q: ctx.query.get("q") ?? undefined,
        page: ctx.query.get("page") ?? undefined,
        pageSize: ctx.query.get("pageSize") ?? undefined,
      }),
  });

  route({
    method: "GET", pattern: "documents/settings", permission: "documents.settings",
    handler: async (ctx) => documents.getSettings(ctx.user!),
  });
  route({
    method: "PUT", pattern: "documents/settings", permission: "documents.settings",
    handler: async (ctx) => documents.updateSettings(ctx.user!, ctx.body ?? {}, ctx),
  });

  route({
    method: "GET", pattern: "documents/export", permission: "documents.audit",
    handler: async (ctx) => documents.exportInventoryCsv(ctx.user!),
  });
  route({
    method: "GET", pattern: "documents/audit/export", permission: "documents.audit",
    handler: async (ctx) => documents.exportAuditCsv(ctx.user!, ctx.query.get("documentId") ?? undefined),
  });

  route({
    method: "POST", pattern: "documents/bulk", permission: "documents.view",
    handler: async (ctx) => documents.bulkOperation(ctx.user!, ctx.body ?? {}, ctx),
  });

  route({
    method: "GET", pattern: "documents/lookup/users", permission: "documents.view",
    handler: async (ctx) => documents.listEligibleUsers(ctx.user!),
  });
  route({
    method: "GET", pattern: "documents/lookup/tags", permission: "documents.view",
    handler: async (ctx) => documents.listDocumentTags(ctx.user!),
  });

  // ── PUBLIC share-link redemption (no session) ──────────────────────────────
  route({
    method: "POST", pattern: "documents/share/:token/redeem", isPublic: true,
    handler: async (ctx) =>
      documents.redeemShareLink(
        ctx.params.token,
        typeof ctx.body?.password === "string" ? ctx.body.password : undefined,
        ctx.ip,
        ctx.userAgent
      ),
  });

  // ── signed file serving (session OR share token; verified signature) ───────
  route({
    method: "GET", pattern: "documents/files/:versionId", isPublic: true,
    handler: async (ctx) =>
      documents.serveVersion(ctx.user, ctx.params.versionId, {
        shareToken: ctx.query.get("share"),
        exp: ctx.query.get("exp"),
        sig: ctx.query.get("sig"),
        inline: ctx.query.get("inline") === "1",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }),
  });

  // ── per-document ───────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "documents/:id", permission: "documents.view",
    handler: async (ctx) => documents.getDocument(ctx.user!, ctx.params.id, ctx),
  });

  route({
    method: "PATCH", pattern: "documents/:id", permission: "documents.view",
    handler: async (ctx) => documents.updateDocument(ctx.user!, ctx.params.id, ctx.body ?? {}, ctx),
  });

  route({
    method: "DELETE", pattern: "documents/:id", permission: "documents.delete",
    handler: async (ctx) => documents.trashDocument(ctx.user!, ctx.params.id, ctx),
  });
  route({
    method: "POST", pattern: "documents/:id/restore", permission: "documents.delete",
    handler: async (ctx) => documents.restoreDocument(ctx.user!, ctx.params.id, ctx),
  });
  route({
    method: "DELETE", pattern: "documents/:id/purge", permission: "documents.delete",
    handler: async (ctx) => documents.purgeDocument(ctx.user!, ctx.params.id, ctx),
  });
  route({
    method: "POST", pattern: "documents/:id/legal-hold", permission: "documents.delete",
    handler: async (ctx) => documents.setLegalHold(ctx.user!, ctx.params.id, Boolean(ctx.body?.value), ctx),
  });

  route({
    method: "POST", pattern: "documents/:id/lock", permission: "documents.view",
    handler: async (ctx) => documents.lockDocument(ctx.user!, ctx.params.id, ctx),
  });
  route({
    method: "POST", pattern: "documents/:id/unlock", permission: "documents.view",
    handler: async (ctx) => documents.unlockDocument(ctx.user!, ctx.params.id, ctx),
  });
  route({
    method: "POST", pattern: "documents/:id/favorite", permission: "documents.view",
    handler: async (ctx) => documents.toggleFavorite(ctx.user!, ctx.params.id),
  });

  route({
    method: "POST", pattern: "documents/:id/workflow", permission: "documents.view",
    handler: async (ctx) => documents.runWorkflow(ctx.user!, ctx.params.id, ctx.body ?? {}, ctx),
  });

  // ── versions ───────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "documents/:id/versions", permission: "documents.view",
    handler: async (ctx) => documents.listVersions(ctx.user!, ctx.params.id),
  });
  // JSON/base64 variant (multipart goes through the dedicated upload handler)
  route({
    method: "POST", pattern: "documents/:id/versions", permission: "documents.edit",
    handler: async (ctx) => documents.addVersionBase64(ctx.user!, ctx.params.id, ctx.body ?? {}, ctx),
  });
  route({
    method: "POST", pattern: "documents/:id/versions/:versionId/restore", permission: "documents.view",
    handler: async (ctx) => documents.restoreVersion(ctx.user!, ctx.params.id, ctx.params.versionId, ctx),
  });

  // ── audit / comments / sharing / download ──────────────────────────────────
  route({
    method: "GET", pattern: "documents/:id/audit", permission: "documents.audit",
    handler: async (ctx) => documents.documentAudit(ctx.user!, ctx.params.id),
  });

  route({
    method: "GET", pattern: "documents/:id/comments", permission: "documents.view",
    handler: async (ctx) => documents.listComments(ctx.user!, ctx.params.id),
  });
  route({
    method: "POST", pattern: "documents/:id/comments", permission: "documents.view",
    handler: async (ctx) => documents.addComment(ctx.user!, ctx.params.id, ctx.body ?? {}, ctx),
  });
  route({
    method: "DELETE", pattern: "documents/:id/comments/:commentId", permission: "documents.view",
    handler: async (ctx) => documents.deleteComment(ctx.user!, ctx.params.id, ctx.params.commentId, ctx),
  });

  route({
    method: "POST", pattern: "documents/:id/share", permission: "documents.share",
    handler: async (ctx) => documents.createShareLink(ctx.user!, ctx.params.id, ctx.body ?? {}, ctx),
  });
  route({
    method: "POST", pattern: "documents/:id/share/:linkId/revoke", permission: "documents.share",
    handler: async (ctx) => documents.revokeShareLink(ctx.user!, ctx.params.id, ctx.params.linkId, ctx),
  });
  route({
    method: "POST", pattern: "documents/:id/acls", permission: "documents.share",
    handler: async (ctx) => documents.addAcl(ctx.user!, ctx.params.id, ctx.body ?? {}, ctx),
  });
  route({
    method: "DELETE", pattern: "documents/:id/acls/:aclId", permission: "documents.share",
    handler: async (ctx) => documents.removeAcl(ctx.user!, ctx.params.id, ctx.params.aclId, ctx),
  });
  route({
    method: "GET", pattern: "documents/:id/download-url", permission: "documents.view",
    handler: async (ctx) => documents.downloadUrlFor(ctx.user!, ctx.params.id),
  });
}
