"use client";

/**
 * Chat websocket client (FRONTEND ONLY).
 * Connects to the chat socket.io service through the gateway
 * (`/?XTransformPort=3003`) or, on direct Windows deployments without the
 * gateway, to NEXT_PUBLIC_CHAT_WS_URL (e.g. http://localhost:3003).
 *
 * Auth: a short-lived ticket (the session id) is fetched from
 * POST /chat/socket-ticket and validated server-side on handshake.
 */
import { io, type Socket } from "socket.io-client";
import { api } from "@/lib/api";

let socket: Socket | null = null;
let connecting: Promise<Socket> | null = null;

function gatewayUrl(): string {
  return process.env.NEXT_PUBLIC_CHAT_WS_URL || "/?XTransformPort=3003";
}

export function chatSocket(): Socket | null {
  return socket;
}

export async function getChatSocket(): Promise<Socket> {
  if (socket) return socket;
  if (connecting) return connecting;

  connecting = (async () => {
    const { ticket } = await api.post<{ ticket: string }>("/chat/socket-ticket");
    const s = io(gatewayUrl(), {
      path: "/",
      transports: ["websocket", "polling"],
      auth: { ticket },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    // rotate the ticket on reconnects (cheap; keeps the handshake valid)
    s.on("reconnect_attempt", async () => {
      try {
        const t = await api.post<{ ticket: string }>("/chat/socket-ticket");
        s.auth = { ticket: t.ticket };
      } catch {
        // session gone — the handshake will fail and the UI can react
      }
    });
    socket = s;
    return s;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export function disconnectChatSocket() {
  socket?.disconnect();
  socket = null;
}
