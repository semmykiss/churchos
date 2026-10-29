import { route } from "@/server/api/router";
import * as portal from "@/server/services/portal";

/**
 * Member portal routes (thin controllers — all logic in services).
 * Every endpoint is scoped to the signed-in user's own person record.
 */
export function registerPortalRoutes() {
  route({
    method: "GET", pattern: "portal/me", permission: "portal.use",
    handler: async (ctx) => portal.getPortalMe(ctx.user!),
  });

  route({
    method: "PUT", pattern: "portal/me", permission: "portal.use",
    handler: async (ctx) => portal.updatePortalMe(ctx.user!, { email: ctx.body?.email, phone: ctx.body?.phone }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "portal/me/consent", permission: "portal.use",
    handler: async (ctx) =>
      portal.updatePortalConsent(
        ctx.user!,
        { channel: ctx.body?.channel, category: ctx.body?.category, optedIn: ctx.body?.optedIn },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });

  route({
    method: "POST", pattern: "portal/me/gift", permission: "portal.use",
    handler: async (ctx) =>
      portal.createPortalGift(
        ctx.user!,
        { amountCents: ctx.body?.amountCents, fundId: ctx.body?.fundId, method: ctx.body?.method, frequency: ctx.body?.frequency },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
}
