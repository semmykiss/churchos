import { route } from "@/server/api/router";
import * as notifications from "@/server/services/notifications";

/**
 * Notification routes (thin controllers) — the topbar bell's inbox.
 * Available to every authenticated user; data is strictly per-user.
 */
export function registerNotificationRoutes() {
  route({
    method: "GET", pattern: "notifications", permission: "",
    handler: async (ctx) => notifications.listNotifications(ctx.user!),
  });

  route({
    method: "GET", pattern: "notifications/unread-count", permission: "",
    handler: async (ctx) => notifications.unreadCount(ctx.user!),
  });

  route({
    method: "POST", pattern: "notifications/:id/read", permission: "",
    handler: async (ctx) => notifications.markRead(ctx.user!, ctx.params.id),
  });

  route({
    method: "POST", pattern: "notifications/read-all", permission: "",
    handler: async (ctx) => notifications.markAllRead(ctx.user!),
  });
}
