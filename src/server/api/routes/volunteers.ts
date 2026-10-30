import { route } from "@/server/api/router";
import * as volunteers from "@/server/services/volunteers";
import { badRequest } from "@/server/http";

/**
 * Volunteer scheduling routes (thin controllers — all logic in services).
 * Note: assignments/:id/respond is PUBLIC + token-scoped (sms link, no login);
 * without a token it falls back to the schedule.respond permission.
 */
export function registerVolunteerRoutes() {
  route({
    method: "GET", pattern: "volunteer-roles", permission: "schedule.view",
    handler: async (ctx) => volunteers.listVolunteerRoles(ctx.user!),
  });

  route({
    method: "POST", pattern: "volunteer-roles", permission: "schedule.assign",
    handler: async (ctx) => volunteers.createVolunteerRole(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "plans", permission: "schedule.view",
    handler: async (ctx) =>
      volunteers.listPlans(ctx.user!, {
        from: ctx.query.get("from") ?? undefined,
        to: ctx.query.get("to") ?? undefined,
      }),
  });

  route({
    method: "POST", pattern: "assignments", permission: "schedule.assign",
    handler: async (ctx) => volunteers.createAssignment(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "DELETE", pattern: "assignments/:id", permission: "schedule.assign",
    handler: async (ctx) => volunteers.deleteAssignment(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "assignments/:id/respond",
    isPublic: true,
    handler: async (ctx) =>
      volunteers.respondToAssignment(
        ctx.user,
        ctx.params.id,
        { token: ctx.query.get("token") ?? ctx.body?.token ?? undefined, action: ctx.body?.action },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });

  route({
    method: "POST", pattern: "assignments/:id/no-show", permission: "schedule.assign",
    handler: async (ctx) => volunteers.markNoShow(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "assignments/:id/swap", permission: "schedule.respond",
    handler: async (ctx) =>
      volunteers.requestSwap(
        ctx.user!,
        ctx.params.id,
        { token: ctx.body?.token, withPersonId: ctx.body?.withPersonId },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });

  route({
    method: "GET", pattern: "swaps", permission: "schedule.view",
    handler: async (ctx) => volunteers.listSwaps(ctx.user!),
  });

  route({
    method: "POST", pattern: "swaps/:id/approve", permission: "schedule.assign",
    handler: async (ctx) => {
      const action = ctx.body?.action ?? "approve";
      if (!["approve", "reject"].includes(action)) throw badRequest('action must be "approve" or "reject".');
      return volunteers.approveSwap(ctx.user!, ctx.params.id, action, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "blockouts", permission: "schedule.view",
    handler: async (ctx) => volunteers.listBlockouts(ctx.user!, ctx.query.get("personId") ?? undefined),
  });

  route({
    method: "POST", pattern: "blockouts", permission: "schedule.respond",
    handler: async (ctx) => volunteers.createBlockout(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "volunteer-health", permission: "schedule.view",
    handler: async (ctx) => volunteers.volunteerHealth(ctx.user!),
  });
}
