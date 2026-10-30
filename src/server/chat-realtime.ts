/**
 * Server-side fan-out bridge (BACKEND ONLY).
 * After the chat service persists an event, it calls the socket.io service's
 * internal /broadcast endpoint so every subscribed client receives it.
 * Fire-and-forget: if the chat service is down, chat still works (clients
 * fall back to polling/focus refresh).
 */

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL ?? "http://127.0.0.1:3004";
const SHARED_SECRET = process.env.CHAT_SHARED_SECRET ?? "grace-chms-local";

function broadcast(event: "message" | "delete" | "read", conversationId: string, payload: unknown) {
  const body = JSON.stringify({ secret: SHARED_SECRET, event, conversationId, payload });
  fetch(`${CHAT_SERVICE_URL}/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    // never let a broadcast failure bubble into the request path
    signal: AbortSignal.timeout(2000),
  }).catch(() => {
    // best-effort — clients reconcile via list polling
  });
}

export function notifyChatMessage(conversationId: string, message: unknown) {
  broadcast("message", conversationId, message);
}

export function notifyChatDelete(conversationId: string, messageId: string) {
  broadcast("delete", conversationId, { messageId });
}

export function notifyChatRead(conversationId: string, personId: string, name: string) {
  broadcast("read", conversationId, { personId, name, at: new Date().toISOString() });
}
