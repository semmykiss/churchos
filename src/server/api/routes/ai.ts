import { route } from "@/server/api/router";
import { badRequest } from "@/server/http";
import {
  startConversation,
  listConversations,
  listMessages,
  clearConversation,
  endConversation,
  deleteConversation,
  runTurn,
  listCrisisFlags,
  reviewCrisisFlag,
  listToolAudit,
  infoFor,
  type StreamEvent,
} from "@/server/services/ai/orchestrator";

/**
 * Shepherd AI — API routes (backend only).
 * Every route requires an authenticated session (permission "" = any signed-in
 * user). Conversation routes enforce conversation.userId === session user
 * INSIDE the service layer — a hard rule no permission can bypass (spec §5).
 * The church-level aiAssistantEnabled toggle is enforced in the services.
 */

export function registerAiRoutes() {
  route({
    method: "GET",
    pattern: "ai/info",
    permission: "",
    handler: async ({ user }) => infoFor(user!),
  });

  route({
    method: "POST",
    pattern: "ai/conversations",
    permission: "",
    handler: async ({ user }) => startConversation(user!),
  });

  route({
    method: "GET",
    pattern: "ai/conversations",
    permission: "",
    handler: async ({ user }) => listConversations(user!),
  });

  route({
    method: "GET",
    pattern: "ai/conversations/:id/messages",
    permission: "",
    handler: async ({ user, params }) => listMessages(user!, params.id),
  });

  // SSE stream — the handler returns a raw Response which the router passes through
  route({
    method: "POST",
    pattern: "ai/conversations/:id/messages",
    permission: "",
    handler: async ({ user, params, body, ip, userAgent }) => {
      const content = typeof body?.content === "string" ? body.content : "";
      if (!content.trim()) throw badRequest("Message cannot be empty.");
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const emit = (evt: StreamEvent) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
            } catch {
              // consumer disconnected — stop emitting; runTurn checks below
            }
          };
          try {
            await runTurn({
              user: user!,
              conversationId: params.id,
              content,
              ip,
              userAgent,
              emit,
            });
          } catch (err) {
            emit({
              type: "error",
              message: err instanceof Error ? err.message : "Something went wrong generating a reply.",
              code: (err as any)?.code ?? "internal",
            });
          } finally {
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    },
  });

  route({
    method: "POST",
    pattern: "ai/conversations/:id/clear",
    permission: "",
    handler: async ({ user, params }) => clearConversation(user!, params.id),
  });

  route({
    method: "POST",
    pattern: "ai/conversations/:id/end",
    permission: "",
    handler: async ({ user, params }) => endConversation(user!, params.id),
  });

  route({
    method: "DELETE",
    pattern: "ai/conversations/:id",
    permission: "",
    handler: async ({ user, params }) => deleteConversation(user!, params.id),
  });

  // compliance surfaces (permission-checked again inside the services)
  route({
    method: "GET",
    pattern: "ai/crisis-flags",
    permission: "",
    handler: async ({ user, query }) => listCrisisFlags(user!, query.get("open") === "1"),
  });

  route({
    method: "POST",
    pattern: "ai/crisis-flags/:id/review",
    permission: "",
    handler: async ({ user, params }) => reviewCrisisFlag(user!, params.id),
  });

  route({
    method: "GET",
    pattern: "ai/tool-audit",
    permission: "",
    handler: async ({ user }) => listToolAudit(user!),
  });
}
