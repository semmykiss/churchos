import { route } from "@/server/api/router";
import * as events from "@/server/services/events";
import { badRequest } from "@/server/http";

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
      events.createEvent(ctx.user!, ctx.body ?? {}, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "events/:id", permission: "events.view",
    handler: async (ctx) => events.getEventDetail(ctx.user!, ctx.params.id),
  });

  route({
    method: "POST", pattern: "events/:id/cancel", permission: "events.manage",
    handler: async (ctx) =>
      events.cancelEvent(ctx.user!, ctx.params.id, ctx.body?.reason, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "events/:id/attendance", permission: "groups.attendance",
    handler: async (ctx) => {
      const { records, method, reason } = ctx.body ?? {};
      if (!records) throw badRequest("records is required.");
      return events.saveEventAttendance(ctx.user!, ctx.params.id, records, method, reason, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "services", permission: "events.view",
    handler: async (ctx) => events.listServices(ctx.user!),
  });
}
