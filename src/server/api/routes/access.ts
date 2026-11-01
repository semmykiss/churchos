import { route } from "@/server/api/router";
import * as access from "@/server/services/access";

/**
 * Access-control routes (thin controllers — all logic in services).
 * Reads require admin.view; every mutation requires admin.manage
 * ("Manage roles & access") and is audited inside the service.
 */
export function registerAccessRoutes() {
  const meta = (ctx: { ip: string | null; userAgent: string | null }) => ({
    ip: ctx.ip ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
  });

  // reads
  route({
    method: "GET", pattern: "admin/access", permission: "admin.view",
    handler: async (ctx) => access.accessOverview(ctx.user!),
  });
  route({
    method: "GET", pattern: "admin/members", permission: "admin.view",
    handler: async (ctx) => access.listMembers(ctx.user!, { search: ctx.query.get("search") ?? undefined }),
  });

  // roles
  route({
    method: "POST", pattern: "admin/roles", permission: "admin.manage",
    handler: async (ctx) => access.createRole(ctx.user!, ctx.body, meta(ctx)),
  });
  route({
    method: "PATCH", pattern: "admin/roles/:roleId", permission: "admin.manage",
    handler: async (ctx) => access.updateRole(ctx.user!, ctx.params.roleId, ctx.body, meta(ctx)),
  });
  route({
    method: "PUT", pattern: "admin/roles/:roleId/permissions", permission: "admin.manage",
    handler: async (ctx) => access.setRolePermissions(ctx.user!, ctx.params.roleId, ctx.body, meta(ctx)),
  });
  route({
    method: "PUT", pattern: "admin/roles/:roleId/access-matrix", permission: "admin.manage",
    handler: async (ctx) => access.setRoleAccessMatrix(ctx.user!, ctx.params.roleId, ctx.body, meta(ctx)),
  });
  route({
    method: "POST", pattern: "admin/roles/:roleId/duplicate", permission: "admin.manage",
    handler: async (ctx) => access.duplicateRole(ctx.user!, ctx.params.roleId, ctx.body, meta(ctx)),
  });
  route({
    method: "DELETE", pattern: "admin/roles/:roleId", permission: "admin.manage",
    handler: async (ctx) => access.deleteRole(ctx.user!, ctx.params.roleId, meta(ctx)),
  });

  // members (user accounts + role assignment)
  route({
    method: "POST", pattern: "admin/members", permission: "admin.manage",
    handler: async (ctx) => access.createMember(ctx.user!, ctx.body, meta(ctx)),
  });
  route({
    method: "PATCH", pattern: "admin/members/:membershipId/status", permission: "admin.manage",
    handler: async (ctx) => access.setMemberStatus(ctx.user!, ctx.params.membershipId, ctx.body, meta(ctx)),
  });
  route({
    method: "POST", pattern: "admin/members/:membershipId/roles", permission: "admin.manage",
    handler: async (ctx) => access.assignRole(ctx.user!, ctx.params.membershipId, ctx.body, meta(ctx)),
  });
  route({
    method: "DELETE", pattern: "admin/members/:membershipId/roles/:roleId", permission: "admin.manage",
    handler: async (ctx) => access.revokeRole(ctx.user!, ctx.params.membershipId, ctx.params.roleId, meta(ctx)),
  });
}
