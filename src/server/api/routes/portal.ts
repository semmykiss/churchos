import { route } from "@/server/api/router";
import * as portal from "@/server/services/portal";
import { optBool, optInt, optStr } from "@/server/api/body";

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
    handler: async (ctx) => portal.updatePortalMe(ctx.user!, { email: optStr(ctx.body?.email), phone: optStr(ctx.body?.phone) }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "portal/me/consent", permission: "portal.use",
    handler: async (ctx) =>
      portal.updatePortalConsent(
        ctx.user!,
        { channel: optStr(ctx.body?.channel), category: optStr(ctx.body?.category), optedIn: optBool(ctx.body?.optedIn) },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });

  route({
    method: "POST", pattern: "portal/me/gift", permission: "portal.use",
    handler: async (ctx) =>
      portal.createPortalGift(
        ctx.user!,
        { amountCents: optInt(ctx.body?.amountCents), fundId: optStr(ctx.body?.fundId), method: optStr(ctx.body?.method), frequency: optStr(ctx.body?.frequency) },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
}
