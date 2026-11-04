import { route } from "@/server/api/router";
import * as events from "@/server/services/events";
import { badRequest } from "@/server/http";
import { optArr, optBool, optNum, optObj, optStr } from "@/server/api/body";

/**
 * Events & services routes (thin controllers — all logic in services).
 * Note: manual/headcount attendance uses the groups.attendance permission,
 * matching the API contract.
 */
export function registerEventRoutes() {
  route({
    method: "GET", pattern: "events", permission: "events.view",
    handler: async (ctx) =>
      events.listEvents(ctx.user!, {
        from: ctx.query.get("from") ?? undefined,
        to: ctx.query.get("to") ?? undefined,
        kind: ctx.query.get("kind") ?? undefined,
        search: ctx.query.get("search") ?? undefined,
        serviceId: ctx.query.get("serviceId") ?? undefined,
      }),
  });

  route({
    method: "POST", pattern: "events", permission: "events.manage",
    handler: async (ctx) =>
      events.createEvent(ctx.user!, {
        name: optStr(ctx.body?.name) ?? "",
        kind: optStr(ctx.body?.kind),
        campusId: optStr(ctx.body?.campusId),
        serviceId: optStr(ctx.body?.serviceId),
        groupId: optStr(ctx.body?.groupId),
        startsAt: optStr(ctx.body?.startsAt) ?? "",
        endsAt: optStr(ctx.body?.endsAt) ?? "",
        roomText: optStr(ctx.body?.roomText),
        capacity: optNum(ctx.body?.capacity),
        checkinEnabled: optBool(ctx.body?.checkinEnabled),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "events/:id", permission: "events.view",
    handler: async (ctx) => events.getEventDetail(ctx.user!, ctx.params.id),
  });

  route({
    method: "POST", pattern: "events/:id/cancel", permission: "events.manage",
    handler: async (ctx) =>
      events.cancelEvent(ctx.user!, ctx.params.id, optStr(ctx.body?.reason), { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "events/:id/attendance", permission: "groups.attendance",
    handler: async (ctx) => {
      const rawRecords = optArr(ctx.body?.records);
      if (!rawRecords) throw badRequest("records is required.");
      // entries without both personId and status are dropped — the service skips them anyway
      const records = rawRecords
        .map((r) => {
          const o = optObj(r);
          const personId = optStr(o?.personId);
          const status = optStr(o?.status);
          return personId && status ? { personId, status } : null;
        })
        .filter((r): r is { personId: string; status: string } => r !== null);
      return events.saveEventAttendance(ctx.user!, ctx.params.id, records, optStr(ctx.body?.method), optStr(ctx.body?.reason), { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "services", permission: "events.view",
    handler: async (ctx) => events.listServices(ctx.user!),
  });
}
