import { route, type ApiContext } from "@/server/api/router";
import * as checkin from "@/server/services/checkin";
import { badRequest, unauthorized } from "@/server/http";

/**
 * Check-in routes: staff (checkin.*) + token-scoped kiosk device endpoints (PUBLIC).
 * Kiosk handlers use ctx.kiosk (CheckinSession + event) as the principal — never ctx.user.
 */
function requireKiosk(ctx: ApiContext) {
  if (!ctx.kiosk) throw unauthorized("Kiosk session invalid or expired.");
  return ctx.kiosk;
}

export function registerCheckinRoutes() {
  // ── staff ──────────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "checkin/rooms", permission: "checkin.view",
    handler: async (ctx) => checkin.getRooms(ctx.user!),
  });

  route({
    method: "POST", pattern: "checkin/sessions", permission: "checkin.manage",
    handler: async (ctx) => {
      const { eventId } = ctx.body ?? {};
      if (!eventId) throw badRequest("eventId is required.");
      return checkin.openCheckinSession(ctx.user!, eventId);
    },
  });

  route({
    method: "GET", pattern: "checkin/sessions", permission: "checkin.view",
    handler: async (ctx) => checkin.listSessions(ctx.user!),
  });

  route({
    method: "POST", pattern: "checkin/sessions/:id/close", permission: "checkin.manage",
    handler: async (ctx) => checkin.closeCheckinSession(ctx.user!, ctx.params.id),
  });

  route({
    method: "GET", pattern: "checkin/roster", permission: "checkin.view",
    handler: async (ctx) => {
      const eventId = ctx.query.get("eventId");
      if (!eventId) throw badRequest("eventId is required.");
      return checkin.staffRoster(ctx.user!, eventId);
    },
  });

  route({
    method: "POST", pattern: "checkin/checkout", permission: "checkin.view",
    handler: async (ctx) => {
      const { childId, eventId, reason } = ctx.body ?? {};
      return checkin.staffOverrideCheckout(ctx.user!, childId, eventId, reason);
    },
  });

  // ── kiosk (PUBLIC + token-scoped device principal) ─────────────────────────
  route({
    method: "GET", pattern: "kiosk/families", isPublic: true,
    handler: async (ctx) => {
      const kiosk = requireKiosk(ctx);
      const q =
        ctx.query.get("q") ??
        ctx.query.get("query") ??
        ctx.query.get("search") ??
        ctx.query.get("name") ??
        ctx.query.get("phone") ??
        "";
      return checkin.kioskFamilies(kiosk, q);
    },
  });

  route({
    method: "POST", pattern: "kiosk/checkin", isPublic: true,
    handler: async (ctx) => {
      const kiosk = requireKiosk(ctx);
      const { childIds, guardianPersonId } = ctx.body ?? {};
      return checkin.kioskCheckin(kiosk, childIds, guardianPersonId);
    },
  });

  route({
    method: "POST", pattern: "kiosk/checkout", isPublic: true,
    handler: async (ctx) => {
      const kiosk = requireKiosk(ctx);
      const { childId, code, guardianPersonId } = ctx.body ?? {};
      return checkin.kioskCheckout(kiosk, childId, code, guardianPersonId);
    },
  });

  route({
    method: "GET", pattern: "kiosk/roster", isPublic: true,
    handler: async (ctx) => checkin.kioskRoster(requireKiosk(ctx)),
  });
}
