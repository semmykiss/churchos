import { route } from "@/server/api/router";
import * as chat from "@/server/services/chat";
import { optArr, optStr } from "@/server/api/body";

/**
 * Chat routes (thin controllers — all logic in services).
 * Real-time delivery runs on the socket.io service; these REST endpoints own
 * persistence + permissions. "comms.chat.use" gates the whole surface; deeper
 * access (participant / church-wide) is enforced in the service.
 */
export function registerChatRoutes() {
  route({
    method: "GET", pattern: "chat/conversations", permission: "comms.chat.use",
    handler: async (ctx) => chat.listConversations(ctx.user!),
  });

  route({
    method: "POST", pattern: "chat/conversations/direct", permission: "comms.chat.use",
    handler: async (ctx) => chat.createDirect(ctx.user!, { personId: optStr(ctx.body?.personId) }),
  });

  route({
    method: "POST", pattern: "chat/conversations/group", permission: "comms.chat.use",
    handler: async (ctx) => chat.createGroup(ctx.user!, { groupId: optStr(ctx.body?.groupId), title: optStr(ctx.body?.title) }),
  });

  route({
    method: "GET", pattern: "chat/conversations/:id/messages", permission: "comms.chat.use",
    handler: async (ctx) =>
      chat.listMessages(ctx.user!, ctx.params.id, {
        before: ctx.query.get("before") ?? undefined,
        limit: ctx.query.get("limit") ?? undefined,
      }),
  });

  route({
    method: "POST", pattern: "chat/conversations/:id/messages", permission: "comms.chat.use",
    handler: async (ctx) => chat.sendMessage(ctx.user!, ctx.params.id, { body: optStr(ctx.body?.body), replyToId: optStr(ctx.body?.replyToId) }),
  });

  route({
    method: "POST", pattern: "chat/conversations/:id/read", permission: "comms.chat.use",
    handler: async (ctx) => chat.markRead(ctx.user!, ctx.params.id),
  });

  route({
    method: "DELETE", pattern: "chat/messages/:id", permission: "comms.chat.use",
    handler: async (ctx) => chat.deleteMessage(ctx.user!, ctx.params.id),
  });

  route({
    method: "GET", pattern: "chat/directory/people", permission: "comms.chat.use",
    handler: async (ctx) => chat.directory(ctx.user!, ctx.query.get("search") ?? undefined),
  });

  route({
    method: "GET", pattern: "chat/directory/groups", permission: "comms.chat.use",
    handler: async (ctx) => chat.myGroups(ctx.user!),
  });

  // ── socket-service support (any authenticated session; used by the chat
  //    websocket service to validate handshakes and room joins) ──
  route({
    method: "GET", pattern: "chat/whoami", permission: "",
    handler: async (ctx) => chat.whoami(ctx.user!),
  });

  route({
    method: "POST", pattern: "chat/access-check", permission: "",
    handler: async (ctx) => chat.accessCheck(ctx.user!, { ids: optArr(ctx.body?.ids) }),
  });

  route({
    method: "POST", pattern: "chat/socket-ticket", permission: "",
    handler: async (ctx) => ({ ticket: ctx.user!.sessionId }),
  });
}
