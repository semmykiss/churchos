import { route } from "@/server/api/router";
import * as comms from "@/server/services/comms";
import { badRequest } from "@/server/http";

/**
 * Communications routes (thin controllers — all logic in services).
 */
export function registerCommsRoutes() {
  route({
    method: "GET", pattern: "messages", permission: "comms.view",
    handler: async (ctx) => comms.listMessages(ctx.user!),
  });

  route({
    method: "POST", pattern: "messages", permission: "comms.view", // channel permission enforced per-body in the service
    handler: async (ctx) => comms.createMessage(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "messages/:id", permission: "comms.view",
    handler: async (ctx) => comms.getMessage(ctx.user!, ctx.params.id),
  });

  route({
    method: "POST", pattern: "messages/:id/send", permission: "comms.view", // channel permission enforced per-message in the service
    handler: async (ctx) => comms.sendMessage(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "messages/:id/cancel", permission: "comms.view", // channel permission enforced per-message in the service
    handler: async (ctx) => comms.cancelMessage(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "segments/preview", permission: "comms.view",
    handler: async (ctx) =>
      comms.previewSegment(ctx.user!, {
        stage: ctx.query.get("stage") ?? undefined,
        groupIds: ctx.query.get("groupIds") ?? undefined,
        tagIds: ctx.query.get("tagIds") ?? undefined,
        consentCategory: ctx.query.get("consentCategory") ?? undefined,
        channel: ctx.query.get("channel") ?? undefined,
      }),
  });

  route({
    method: "GET", pattern: "consent", permission: "consent.view",
    handler: async (ctx) => comms.listConsent(ctx.user!, ctx.query.get("search") ?? undefined),
  });

  route({
    method: "POST", pattern: "consent", permission: "consent.view",
    handler: async (ctx) => comms.updateConsent(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
}
