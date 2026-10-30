import { route } from "@/server/api/router";
import * as groups from "@/server/services/groups";
import { badRequest } from "@/server/http";

/**
 * Groups routes (thin controllers — all logic in services).
 */
export function registerGroupRoutes() {
  route({
    method: "GET", pattern: "groups", permission: "groups.view",
    handler: async (ctx) =>
      groups.listGroups(ctx.user!, {
        search: ctx.query.get("search") ?? undefined,
        type: ctx.query.get("type") ?? undefined,
        leaderPersonId: ctx.query.get("leaderPersonId") ?? undefined,
        mine: ctx.query.get("mine") === "true",
      }),
  });

  route({
    method: "POST", pattern: "groups", permission: "groups.manage",
    handler: async (ctx) =>
      groups.createGroup(ctx.user!, ctx.body ?? {}, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "groups/:id", permission: "groups.view",
    handler: async (ctx) => groups.getGroupDetail(ctx.user!, ctx.params.id),
  });

  route({
    method: "PUT", pattern: "groups/:id", permission: "groups.manage",
    handler: async (ctx) =>
      groups.updateGroup(ctx.user!, ctx.params.id, ctx.body ?? {}, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "groups/:id/members", permission: "groups.manage",
    handler: async (ctx) => {
      const { personId, role } = ctx.body ?? {};
      if (!personId) throw badRequest("personId is required.");
      return groups.addGroupMember(ctx.user!, ctx.params.id, personId, role, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "DELETE", pattern: "groups/:id/members/:personId", permission: "groups.manage",
    handler: async (ctx) =>
      groups.removeGroupMember(ctx.user!, ctx.params.id, ctx.params.personId, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "groups/:id/join-requests/:requestId", permission: "groups.manage",
    handler: async (ctx) => {
      const { action } = ctx.body ?? {};
      if (!action) throw badRequest("action is required.");
      return groups.decideJoinRequest(ctx.user!, ctx.params.id, ctx.params.requestId, action, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "POST", pattern: "groups/:id/attendance", permission: "groups.attendance",
    handler: async (ctx) => {
      const { eventId, records } = ctx.body ?? {};
      if (!eventId) throw badRequest("eventId is required.");
      return groups.saveGroupAttendance(ctx.user!, ctx.params.id, eventId, records ?? [], { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "POST", pattern: "groups/:id/meetings", permission: "groups.attendance",
    handler: async (ctx) => {
      const { date } = ctx.body ?? {};
      if (!date) throw badRequest("date is required.");
      return groups.createGroupMeeting(ctx.user!, ctx.params.id, date, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });
}
