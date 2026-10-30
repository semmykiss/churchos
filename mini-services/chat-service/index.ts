import { createServer } from "http";
import { Server, type Socket } from "socket.io";

/**
 * Grace ChMS — chat real-time service (socket.io).
 *
 * Transport-only layer: persistence + permissions live in the Next.js API
 * (src/server/services/chat.ts). This service:
 *   • validates each handshake against the ChMS session (via /chat/whoami)
 *   • manages rooms (org + conversation) with access-checked joins
 *   • relays server-driven message / read / delete events and ephemeral typing
 *
 * The Next.js API persists the message, then POSTs /broadcast here — delivery
 * is guaranteed by the server; clients never relay messages.
 */

const PORT = 3003;
const CHMS_API = process.env.CHMS_API_URL ?? "http://127.0.0.1:3000/api/v1";
// Shared secret for the internal API → socket-service broadcast call.
const SHARED_SECRET = process.env.CHAT_SHARED_SECRET ?? "grace-chms-local";

interface ChatIdentity {
  userId: string;
  personId: string | null;
  membershipId: string;
  orgId: string;
  name: string;
  canChat: boolean;
  churchwide: boolean;
}

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by the gateway to forward to this port
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Internal broadcast API on its own port — engine.io owns every request on the
// main server (path "/"), so server-driven fan-out rides a dedicated listener.
const internal = createServer(async (req, res) => {
  if (req.method === "POST" && (req.url ?? "").startsWith("/broadcast")) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let ok = false;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (body.secret === SHARED_SECRET && typeof body.conversationId === "string") {
        const room = `conv:${body.conversationId}`;
        if (body.event === "message") {
          io.to(room).emit("chat:message", { conversationId: body.conversationId, message: body.payload });
          ok = true;
        } else if (body.event === "delete") {
          io.to(room).emit("chat:delete", { conversationId: body.conversationId, messageId: body.payload?.messageId });
          ok = true;
        } else if (body.event === "read") {
          io.to(room).emit("chat:read", {
            conversationId: body.conversationId,
            personId: body.payload?.personId,
            name: body.payload?.name,
            at: body.payload?.at,
          });
          ok = true;
        }
      }
    } catch {
      ok = false;
    }
    res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok }));
    return;
  }
  res.writeHead(404).end();
});
internal.listen(PORT + 1, () => {
  console.log(`[chat-ws] internal broadcast API on port ${PORT + 1}`);
});

/* ───────────────────────── session validation ───────────────────────── */

function extractSessionId(socket: Socket): string | null {
  const ticket = socket.handshake.auth?.ticket;
  if (typeof ticket === "string" && ticket.length > 0) return ticket;
  const cookie = socket.handshake.headers.cookie ?? "";
  const row = cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("chms_session="));
  return row ? decodeURIComponent(row.slice("chms_session=".length)) : null;
}

async function whoami(sessionId: string): Promise<ChatIdentity | null> {
  try {
    const res = await fetch(`${CHMS_API}/chat/whoami`, {
      headers: { cookie: `chms_session=${sessionId}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ChatIdentity & { error?: string };
    return body?.error || !body?.canChat ? null : body;
  } catch {
    return null;
  }
}

async function accessCheck(
  sessionId: string,
  ids: string[],
): Promise<string[]> {
  try {
    const res = await fetch(`${CHMS_API}/chat/access-check`, {
      method: "POST",
      headers: { cookie: `chms_session=${sessionId}`, "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { allowed?: string[] };
    return Array.isArray(body?.allowed) ? body.allowed : [];
  } catch {
    return [];
  }
}

/* ─────────────────────────── presence (in-memory) ─────────────────────────── */

const onlineByOrg = new Map<string, Map<string, number>>(); // orgId -> personId -> socket count

function addOnline(orgId: string, personId: string): boolean {
  let org = onlineByOrg.get(orgId);
  if (!org) onlineByOrg.set(orgId, (org = new Map()));
  const next = (org.get(personId) ?? 0) + 1;
  org.set(personId, next);
  return next === 1; // first socket for this person
}

function removeOnline(orgId: string, personId: string): boolean {
  const org = onlineByOrg.get(orgId);
  if (!org) return false;
  const next = (org.get(personId) ?? 0) - 1;
  if (next <= 0) {
    org.delete(personId);
    return true; // person fully offline
  }
  org.set(personId, next);
  return false;
}

function onlineList(orgId: string): string[] {
  return [...(onlineByOrg.get(orgId)?.keys() ?? [])];
}

/* ─────────────────────────── connection handling ─────────────────────────── */

io.on("connection", async (socket) => {
  const sessionId = extractSessionId(socket);
  const identity = sessionId ? await whoami(sessionId) : null;
  if (!identity) {
    socket.emit("chat:error", { code: "unauthorized", message: "Chat session invalid or expired." });
    socket.disconnect(true);
    return;
  }

  const orgRoom = `org:${identity.orgId}`;
  const personId = identity.personId ?? `user:${identity.userId}`;
  socket.data.identity = identity;
  socket.join(orgRoom);

  // presence: tell the newcomer who is already online, announce them
  socket.emit("chat:presence-online", { personIds: onlineList(identity.orgId).filter((p) => p !== personId) });
  if (identity.personId && addOnline(identity.orgId, identity.personId)) {
    socket.to(orgRoom).emit("chat:presence", { personId: identity.personId, name: identity.name, online: true });
  }

  socket.on("chat:subscribe", async (payload: { ids?: unknown }, ack?: (res: unknown) => void) => {
    const requested = Array.isArray(payload?.ids) ? payload.ids.map(String).slice(0, 100) : [];
    const allowed = await accessCheck(sessionId!, requested);
    for (const id of allowed) socket.join(`conv:${id}`);
    ack?.({ allowed });
  });

  socket.on("chat:unsubscribe", (payload: { ids?: unknown }) => {
    const ids = Array.isArray(payload?.ids) ? payload.ids.map(String).slice(0, 100) : [];
    for (const id of ids) socket.leave(`conv:${id}`);
  });

  // fan-out helpers — every event requires the sender to already be in the room
  const requireRoom = (conversationId: unknown): string | null => {
    if (typeof conversationId !== "string" || !conversationId) return null;
    const room = `conv:${conversationId}`;
    return socket.rooms.has(room) ? room : null;
  };

  // NOTE: message/delete/read events are broadcast server-side by the Next.js
  // API via POST /broadcast after persisting — clients never relay messages.
  // Only ephemeral typing signals travel client → socket → room.
  socket.on("chat:typing", (payload: { conversationId?: unknown; typing?: unknown }) => {
    const room = requireRoom(payload?.conversationId);
    if (!room) return;
    socket.to(room).emit("chat:typing", {
      conversationId: payload.conversationId,
      personId,
      name: identity.name,
      typing: !!payload.typing,
    });
  });

  socket.on("disconnect", () => {
    if (identity.personId && removeOnline(identity.orgId, identity.personId)) {
      io.to(orgRoom).emit("chat:presence", { personId: identity.personId, name: identity.name, online: false });
    }
  });

  socket.on("error", (err) => console.error(`[chat-ws] socket error (${socket.id}):`, err));
});

httpServer.listen(PORT, () => {
  console.log(`[chat-ws] Grace ChMS chat service listening on port ${PORT} (api: ${CHMS_API})`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
