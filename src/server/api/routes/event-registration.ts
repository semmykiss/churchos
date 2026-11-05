import { route } from "@/server/api/router";
import * as reg from "@/server/services/event-registration";
import { badRequest } from "@/server/http";
import { optBool, optInt, optNum, optStr } from "@/server/api/body";

/**
 * Events & Registration routes — ticketing, RSVP, payments, QR check-in, program.
 *
 * ORDER MATTERS: this module registers BEFORE routes/events.ts, so its literal
 * prefixes win over parameterized patterns there ("events/me/…" and
 * "events/check-in" must never be captured as "events/:id").
 * Member self-service routes are grouped first, then literal staff routes,
 * then parameterized ones.
 */
export function registerEventRegistrationRoutes() {
  /* ── member self-service (portal.use) ───────────────────────────────────── */

  route({
    method: "GET", pattern: "events/me/catalog", permission: "portal.use",
    handler: async (ctx) => reg.memberCatalog(ctx.user!),
  });

  route({
    method: "GET", pattern: "events/me/registrations", permission: "portal.use",
    handler: async (ctx) => reg.myRegistrations(ctx.user!),
  });

  route({
    method: "POST", pattern: "events/me/:eventId/rsvp", permission: "portal.use",
    handler: async (ctx) =>
      reg.memberRsvp(ctx.user!, ctx.params.eventId, {
        ticketTypeId: optStr(ctx.body?.ticketTypeId),
        quantity: optInt(ctx.body?.quantity),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "events/me/registrations/:registrationId/pay", permission: "portal.use",
    handler: async (ctx) =>
      reg.memberPayRsvp(ctx.user!, ctx.params.registrationId, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  /* ── literal staff routes ───────────────────────────────────────────────── */

  route({
    method: "POST", pattern: "events/check-in", permission: "events.manage",
    handler: async (ctx) => {
      const token = optStr(ctx.body?.qrToken);
      if (!token) throw badRequest("qrToken is required.");
      // eventId scopes the check-in to one event (kiosk mode) — optional so the
      // generic scanner dialog keeps its cross-event behaviour.
      const eventId = optStr(ctx.body?.eventId);
      return reg.checkInByToken(ctx.user!, token, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }, { eventId });
    },
  });

  route({
    method: "GET", pattern: "events/registration/summary", permission: "events.view",
    handler: async (ctx) =>
      reg.registrationSummary(ctx.user!, {
        from: ctx.query.get("from") ?? undefined,
        to: ctx.query.get("to") ?? undefined,
      }),
  });

  /* ── staff: per-event registration management ───────────────────────────── */

  route({
    method: "GET", pattern: "events/:id/registration", permission: "events.view",
    handler: async (ctx) => reg.getRegistrationOverview(ctx.user!, ctx.params.id),
  });

  // Attendance download — branded Excel (church logo, event, date, venue).
  route({
    method: "GET", pattern: "events/:id/attendance/export", permission: "events.view",
    handler: async (ctx) => reg.exportAttendanceWorkbook(ctx.user!, ctx.params.id),
  });

  // Door check-ins (QR / kiosk) — every seat admitted, members and guests.
  route({
    method: "GET", pattern: "events/:id/checkins", permission: "events.view",
    handler: async (ctx) => reg.listDoorCheckins(ctx.user!, ctx.params.id),
  });

  route({
    method: "PUT", pattern: "events/:id/registration", permission: "events.manage",
    handler: async (ctx) =>
      reg.updateRegistrationSettings(ctx.user!, ctx.params.id, {
        registrationEnabled: optBool(ctx.body?.registrationEnabled),
        registrationCapacity: ctx.body?.registrationCapacity === null ? null : optInt(ctx.body?.registrationCapacity),
        registrationDeadline: ctx.body?.registrationDeadline === null ? null : optStr(ctx.body?.registrationDeadline),
        registrationNote: ctx.body?.registrationNote === null ? null : optStr(ctx.body?.registrationNote),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "events/:id/ticket-types", permission: "events.manage",
    handler: async (ctx) =>
      reg.createTicketType(ctx.user!, ctx.params.id, {
        name: optStr(ctx.body?.name) ?? "",
        description: optStr(ctx.body?.description),
        priceCents: optInt(ctx.body?.priceCents),
        capacity: ctx.body?.capacity === null ? null : optInt(ctx.body?.capacity),
        maxPerOrder: optInt(ctx.body?.maxPerOrder),
        salesEndAt: optStr(ctx.body?.salesEndAt),
        isActive: optBool(ctx.body?.isActive),
        sortOrder: optInt(ctx.body?.sortOrder),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "PUT", pattern: "events/:id/ticket-types/:ticketTypeId", permission: "events.manage",
    handler: async (ctx) =>
      reg.updateTicketType(ctx.user!, ctx.params.id, ctx.params.ticketTypeId, {
        name: optStr(ctx.body?.name),
        description: ctx.body?.description === null ? null : optStr(ctx.body?.description),
        priceCents: optInt(ctx.body?.priceCents),
        capacity: ctx.body?.capacity === null ? null : optInt(ctx.body?.capacity),
        maxPerOrder: optInt(ctx.body?.maxPerOrder),
        salesEndAt: ctx.body?.salesEndAt === null ? null : optStr(ctx.body?.salesEndAt),
        isActive: optBool(ctx.body?.isActive),
        sortOrder: optInt(ctx.body?.sortOrder),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "events/:id/registrations", permission: "events.view",
    handler: async (ctx) =>
      reg.listRegistrations(ctx.user!, ctx.params.id, {
        status: ctx.query.get("status") ?? undefined,
        search: ctx.query.get("search") ?? undefined,
      }),
  });

  route({
    method: "POST", pattern: "events/:id/registrations", permission: "events.manage",
    handler: async (ctx) =>
      reg.createRegistration(ctx.user!, ctx.params.id, {
        personId: optStr(ctx.body?.personId),
        guestName: optStr(ctx.body?.guestName),
        guestEmail: optStr(ctx.body?.guestEmail),
        guestPhone: optStr(ctx.body?.guestPhone),
        ticketTypeId: optStr(ctx.body?.ticketTypeId),
        quantity: optInt(ctx.body?.quantity),
        notes: optStr(ctx.body?.notes),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "registrations/:id/confirm-payment", permission: "events.manage",
    handler: async (ctx) =>
      reg.confirmRegistrationPayment(ctx.user!, ctx.params.id, {
        method: optStr(ctx.body?.method),
        reference: optStr(ctx.body?.reference),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "registrations/:id/cancel", permission: "events.manage",
    handler: async (ctx) =>
      reg.cancelRegistration(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  /* ── program / run-sheet ────────────────────────────────────────────────── */

  route({
    method: "GET", pattern: "events/:id/program", permission: "events.view",
    handler: async (ctx) => reg.getProgram(ctx.user!, ctx.params.id),
  });

  route({
    method: "POST", pattern: "events/:id/program", permission: "events.manage",
    handler: async (ctx) =>
      reg.addProgramItem(ctx.user!, ctx.params.id, {
        title: optStr(ctx.body?.title),
        speaker: optStr(ctx.body?.speaker),
        startsAt: optStr(ctx.body?.startsAt),
        endsAt: optStr(ctx.body?.endsAt),
        roomText: optStr(ctx.body?.roomText),
        notes: optStr(ctx.body?.notes),
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "DELETE", pattern: "events/:id/program/:itemId", permission: "events.manage",
    handler: async (ctx) =>
      reg.deleteProgramItem(ctx.user!, ctx.params.id, ctx.params.itemId, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
}
