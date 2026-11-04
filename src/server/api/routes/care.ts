import { route } from "@/server/api/router";
import * as care from "@/server/services/care";
import { badRequest } from "@/server/http";
import { optStr } from "@/server/api/body";

/**
 * Pastoral care routes (thin controllers — all logic in services).
 * No DELETE endpoints exist here by design: cases/notes are never deletable.
 */
export function registerCareRoutes() {
  route({
    method: "GET", pattern: "care-cases", permission: "care.view",
    handler: async (ctx) =>
      care.listCases(ctx.user!, {
        status: ctx.query.get("status") ?? undefined,
        stage: ctx.query.get("stage") ?? undefined,
        type: ctx.query.get("type") ?? undefined,
        urgency: ctx.query.get("urgency") ?? undefined,
        mine: ctx.query.get("mine") === "true",
      }),
  });

  route({
    method: "POST", pattern: "care-cases", permission: "care.create",
    handler: async (ctx) => care.createCase(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "care-cases/:id", permission: "care.view",
    handler: async (ctx) => care.getCase(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "care-cases/:id/notes", permission: "care.view",
    handler: async (ctx) => care.addNote(ctx.user!, ctx.params.id, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "care-cases/:id/close", permission: "care.manage",
    handler: async (ctx) => {
      const closeReason = optStr(ctx.body?.closeReason);
      if (!closeReason) throw badRequest("closeReason is required.");
      return care.closeCase(ctx.user!, ctx.params.id, closeReason, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "prayer-requests", permission: "care.view",
    handler: async (ctx) => care.listPrayerRequests(ctx.user!),
  });

  route({
    method: "POST", pattern: "prayer-requests", permission: "care.view",
    handler: async (ctx) => care.createPrayerRequest(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "prayer-requests/:id/approve", permission: "care.manage",
    handler: async (ctx) => {
      // keep the `?? "approve"` default ONLY for an absent/null action — a
      // wrong-typed action still fails the allow-list check below
      const rawAction = ctx.body?.action;
      const action = rawAction == null ? "approve" : (optStr(rawAction) ?? "");
      if (!["approve", "reject"].includes(action)) throw badRequest('action must be "approve" or "reject".');
      return care.approvePrayerRequest(ctx.user!, ctx.params.id, action, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });
}
