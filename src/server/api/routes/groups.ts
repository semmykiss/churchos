import { route } from "@/server/api/router";
import * as groups from "@/server/services/groups";
import { badRequest } from "@/server/http";
import { optArr, optBool, optNum, optObj, optStr } from "@/server/api/body";

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
      groups.createGroup(ctx.user!, {
        name: optStr(ctx.body?.name) ?? "",
        type: optStr(ctx.body?.type),
        campusId: optStr(ctx.body?.campusId),
        leaderPersonId: optStr(ctx.body?.leaderPersonId),
        meetingDay: optStr(ctx.body?.meetingDay),
        meetingTime: optStr(ctx.body?.meetingTime),
        locationText: optStr(ctx.body?.locationText),
        capacity: optNum(ctx.body?.capacity),
        description: optStr(ctx.body?.description),
        isOpen: optBool(ctx.body?.isOpen),
        isConfidential: optBool(ctx.body?.isConfidential),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
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
      const personId = optStr(ctx.body?.personId);
      if (!personId) throw badRequest("personId is required.");
      return groups.addGroupMember(ctx.user!, ctx.params.id, personId, optStr(ctx.body?.role), { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
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
      const action = optStr(ctx.body?.action);
      if (!action) throw badRequest("action is required.");
      return groups.decideJoinRequest(ctx.user!, ctx.params.id, ctx.params.requestId, action, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "POST", pattern: "groups/:id/attendance", permission: "groups.attendance",
    handler: async (ctx) => {
      const eventId = optStr(ctx.body?.eventId);
      if (!eventId) throw badRequest("eventId is required.");
      // entries without both personId and status are dropped — the service skips them anyway
      const records = (optArr(ctx.body?.records) ?? [])
        .map((r) => {
          const o = optObj(r);
          const personId = optStr(o?.personId);
          const status = optStr(o?.status);
          return personId && status ? { personId, status } : null;
        })
        .filter((r): r is { personId: string; status: string } => r !== null);
      return groups.saveGroupAttendance(ctx.user!, ctx.params.id, eventId, records, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "POST", pattern: "groups/:id/meetings", permission: "groups.attendance",
    handler: async (ctx) => {
      const date = optStr(ctx.body?.date);
      if (!date) throw badRequest("date is required.");
      return groups.createGroupMeeting(ctx.user!, ctx.params.id, date, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });
}
