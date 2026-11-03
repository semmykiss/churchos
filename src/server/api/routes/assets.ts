import { route } from "@/server/api/router";
import * as assets from "@/server/services/assets";

/**
 * Assets & Facilities routes — register, maintenance log, bookings.
 * The ladder: view → edit (maintenance/bookings decisions) → create → delete.
 */
export function registerAssetRoutes() {
  // NOTE: static segments are registered before ":id" so the router matches
  // "assets/bookings" exactly instead of treating "bookings" as an asset id.

  // ── register ───────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "assets", permission: "assets.view",
    handler: async (ctx) =>
      assets.listAssets(ctx.user!, {
        q: ctx.query.get("q") ?? undefined,
        category: ctx.query.get("category") ?? undefined,
        condition: ctx.query.get("condition") ?? undefined,
        status: ctx.query.get("status") ?? undefined,
        page: ctx.query.get("page") ?? undefined,
        pageSize: ctx.query.get("pageSize") ?? undefined,
      }),
  });

  route({
    method: "POST", pattern: "assets", permission: "assets.create",
    handler: async (ctx) => assets.createAsset(ctx.user!, ctx.body, ctx),
  });

  // ── bookings ───────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "assets/bookings", permission: "assets.view",
    handler: async (ctx) =>
      assets.listBookings(ctx.user!, {
        status: ctx.query.get("status") ?? undefined,
        upcoming: ctx.query.get("upcoming") ?? undefined,
      }),
  });

  // any reader can REQUEST a booking; approval happens via the decision route
  route({
    method: "POST", pattern: "assets/bookings", permission: "assets.view",
    handler: async (ctx) => assets.createBooking(ctx.user!, ctx.body, ctx),
  });

  route({
    method: "POST", pattern: "assets/bookings/:id/decision", permission: "assets.edit",
    handler: async (ctx) => assets.decideBooking(ctx.user!, ctx.params.id, ctx.body, ctx),
  });

  route({
    method: "POST", pattern: "assets/bookings/:id/cancel", permission: "assets.view",
    handler: async (ctx) => assets.cancelBooking(ctx.user!, ctx.params.id, ctx),
  });

  route({
    method: "DELETE", pattern: "assets/bookings/:id", permission: "assets.delete",
    handler: async (ctx) => assets.deleteBooking(ctx.user!, ctx.params.id, ctx),
  });

  // ── per-asset ──────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "assets/:id", permission: "assets.view",
    handler: async (ctx) => assets.getAsset(ctx.user!, ctx.params.id),
  });

  route({
    method: "PATCH", pattern: "assets/:id", permission: "assets.edit",
    handler: async (ctx) => assets.updateAsset(ctx.user!, ctx.params.id, ctx.body, ctx),
  });

  route({
    method: "DELETE", pattern: "assets/:id", permission: "assets.delete",
    handler: async (ctx) => assets.deleteAsset(ctx.user!, ctx.params.id, ctx),
  });

  route({
    method: "POST", pattern: "assets/:id/maintenance", permission: "assets.edit",
    handler: async (ctx) => assets.addMaintenance(ctx.user!, ctx.params.id, ctx.body, ctx),
  });

  route({
    method: "DELETE", pattern: "assets/:id/maintenance/:entryId", permission: "assets.edit",
    handler: async (ctx) => assets.deleteMaintenance(ctx.user!, ctx.params.id, ctx.params.entryId, ctx),
  });
}
