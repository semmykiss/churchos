"use client";

/**
 * Chat tab — WhatsApp-style messaging for the Communications module.
 * • Left: conversation list (direct / group / church-wide) with unread badges,
 *   presence dots and last-message previews.
 * • Right: message thread — own messages align right (emerald), others left.
 *   Date separators, sender names in group chats, typing indicator, read
 *   receipts, delete-own-message. No calls by design.
 * Real-time delivery rides the socket.io service; REST owns persistence.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { getChatSocket, chatSocket } from "@/lib/socket";
import type {
  ChatConversationDTO,
  ChatConversationsResp,
  ChatDirectoryGroup,
  ChatDirectoryPerson,
  ChatMessageDTO,
  ChatMessagesResp,
  ChatSocketDelete,
  ChatSocketMessage,
  ChatSocketPresence,
  ChatSocketRead,
  ChatSocketTyping,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApiQuery } from "@/components/app/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Church,
  Info,
  Loader2,
  Lock,
  Megaphone,
  MessageSquarePlus,
  MessagesSquare,
  Search,
  Send,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";

/* ───────────────────────────── helpers ───────────────────────────── */

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const AVATAR_COLORS = [
  "bg-teal-600", "bg-violet-600", "bg-amber-600", "bg-rose-600",
  "bg-emerald-600", "bg-orange-600", "bg-fuchsia-600", "bg-lime-600",
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const SENDER_COLORS = [
  "text-teal-600 dark:text-teal-400", "text-violet-600 dark:text-violet-400",
  "text-amber-600 dark:text-amber-400", "text-rose-600 dark:text-rose-400",
  "text-orange-600 dark:text-orange-400", "text-fuchsia-600 dark:text-fuchsia-400",
];

function senderColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length];
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);
  if (d >= weekAgo) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

const TYPE_LABEL: Record<ChatConversationDTO["type"], string> = {
  direct: "Direct message",
  group: "Group chat",
  churchwide: "Church-wide",
};

/* ───────────────────────────── main tab ───────────────────────────── */

export default function ChatTab() {
  const qc = useQueryClient();
  const convQ = useApiQuery<ChatConversationsResp>(["chat", "conversations"], "/chat/conversations", {
    refetchInterval: 45000, // safety net if a socket event is missed
  });
  const conversations = convQ.data?.items ?? [];
  const churchwideAvailable = convQ.data?.churchwideAvailable ?? false;
  const me = convQ.data?.me ?? null;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [typingBy, setTypingBy] = useState<Record<string, { name: string; at: number }>>({});
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [readBy, setReadBy] = useState<Record<string, string>>({}); // personId -> read-at
  const [socketOn, setSocketOn] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const meRef = useRef(me);
  const lastTypingRef = useRef(0);
  activeIdRef.current = activeId;
  meRef.current = me;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return conversations;
    return conversations.filter((c) => {
      const hay = `${c.title} ${c.lastMessage?.body ?? ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [conversations, search]);

  /* load thread on conversation switch */
  useEffect(() => {
    if (!activeId || !me) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    setMessages([]);
    setReadBy({});
    api
      .get<ChatMessagesResp>(`/chat/conversations/${activeId}/messages`)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.items);
        setHasMore(res.hasMore);
      })
      .catch((err) => toast.error(errorMessage(err, "Could not load messages.")))
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, me]);

  /* socket wiring */
  useEffect(() => {
    let disposed = false;
    let bound: Awaited<ReturnType<typeof getChatSocket>> | null = null;
    let cleanupIv: number | undefined;

    getChatSocket()
      .then((sock) => {
        if (disposed) return;
        bound = sock;

        const onConnect = () => setSocketOn(true);
        const onDisconnect = () => setSocketOn(false);
        const onMessage = (p: ChatSocketMessage) => {
          if (!p?.message) return;
          // the broadcast DTO was computed for the sender — recompute ownership
          // for this viewer
          const msg: ChatMessageDTO = { ...p.message, mine: p.message.senderPersonId === meRef.current?.personId };
          if (p.conversationId === activeIdRef.current) {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            if (document.hasFocus() && msg.senderPersonId !== meRef.current?.personId) {
              // REST read broadcasts the receipt to the room for us
              void api.post(`/chat/conversations/${p.conversationId}/read`).catch(() => {});
            }
          }
          void qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
        };
        const onDelete = (p: ChatSocketDelete) => {
          if (p.conversationId === activeIdRef.current) {
            setMessages((prev) => prev.filter((m) => m.id !== p.messageId));
          }
          void qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
        };
        const onTyping = (p: ChatSocketTyping) => {
          if (p.conversationId !== activeIdRef.current) return;
          setTypingBy((prev) => {
            const next = { ...prev };
            if (p.typing) next[p.personId] = { name: p.name, at: Date.now() };
            else delete next[p.personId];
            return next;
          });
        };
        const onRead = (p: ChatSocketRead) => {
          if (p.conversationId !== activeIdRef.current) return;
          if (p.personId === meRef.current?.personId) return; // own receipts don't count
          setReadBy((prev) => ({ ...prev, [p.personId]: p.at }));
        };
        const onPresence = (p: ChatSocketPresence) => {
          setOnline((prev) => {
            const next = new Set(prev);
            if (p.online) next.add(p.personId);
            else next.delete(p.personId);
            return next;
          });
        };
        const onPresenceOnline = (p: { personIds: string[] }) => setOnline(new Set(p.personIds));

        sock.on("connect", onConnect);
        sock.on("disconnect", onDisconnect);
        sock.on("chat:message", onMessage);
        sock.on("chat:delete", onDelete);
        sock.on("chat:typing", onTyping);
        sock.on("chat:read", onRead);
        sock.on("chat:presence", onPresence);
        sock.on("chat:presence-online", onPresenceOnline);
        if (sock.connected) setSocketOn(true);

        cleanupIv = window.setInterval(() => {
          setTypingBy((prev) => {
            const now = Date.now();
            const next: typeof prev = {};
            let changed = false;
            for (const [k, v] of Object.entries(prev)) {
              if (now - v.at < 5000) next[k] = v;
              else changed = true;
            }
            return changed ? next : prev;
          });
        }, 2000);
      })
      .catch(() => {
        // websocket optional — REST + polling keep chat usable
        setSocketOn(false);
      });

    return () => {
      disposed = true;
      if (bound) {
        bound.off("connect");
        bound.off("disconnect");
        bound.off("chat:message");
        bound.off("chat:delete");
        bound.off("chat:typing");
        bound.off("chat:read");
        bound.off("chat:presence");
        bound.off("chat:presence-online");
      }
      if (cleanupIv) window.clearInterval(cleanupIv);
    };
  }, [qc]);

  /* subscribe to rooms for every visible conversation */
  const convIdKey = conversations.map((c) => c.id).join(",");
  useEffect(() => {
    if (!convIdKey) return;
    getChatSocket()
      .then((s) => s.emit("chat:subscribe", { ids: convIdKey.split(",") }))
      .catch(() => {});
  }, [convIdKey]);

  /* refresh list on window focus */
  useEffect(() => {
    const onFocus = () => void qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  /* auto-scroll to newest message */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeId, threadLoading]);

  /* actions */

  async function openDirect(personId: string) {
    try {
      const dto = await api.post<ChatConversationDTO>("/chat/conversations/direct", { personId });
      void qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      setActiveId(dto.id);
      setNewChatOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not start the chat."));
    }
  }

  async function openGroup(groupId: string) {
    try {
      const dto = await api.post<ChatConversationDTO>("/chat/conversations/group", { groupId });
      void qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      setActiveId(dto.id);
      setNewChatOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not open the group chat."));
    }
  }

  function openChurchwide() {
    const cw = conversations.find((c) => c.type === "churchwide");
    if (cw) {
      setActiveId(cw.id);
      setNewChatOpen(false);
    }
  }

  async function send() {
    const text = draft.trim();
    const convId = activeId;
    if (!text || !convId || sending) return;
    setSending(true);
    setDraft("");
    const temp: ChatMessageDTO = {
      id: `temp-${Date.now()}`,
      conversationId: convId,
      senderPersonId: me?.personId ?? "",
      senderUserId: null,
      senderName: me?.name ?? "",
      body: text,
      kind: "text",
      createdAt: new Date().toISOString(),
      mine: true,
    };
    setMessages((prev) => [...prev, temp]);
    try {
      const real = await api.post<ChatMessageDTO>(`/chat/conversations/${convId}/messages`, { body: text });
      setMessages((prev) => {
        // the socket broadcast may have delivered the real message before the
        // REST response — never keep both copies
        const alreadyThere = prev.some((m) => m.id === real.id);
        if (alreadyThere) return prev.filter((m) => m.id !== temp.id);
        return prev.map((m) => (m.id === temp.id ? real : m));
      });
      // fan-out is server-driven: the API broadcasts to the room after persisting
      void qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setDraft(text);
      toast.error(errorMessage(err, "Message failed to send."));
    } finally {
      setSending(false);
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    const s = chatSocket();
    if (!s || !activeId) return;
    if (value.trim()) {
      const now = Date.now();
      if (now - lastTypingRef.current > 2000) {
        lastTypingRef.current = now;
        s.emit("chat:typing", { conversationId: activeId, typing: true });
      }
    } else {
      lastTypingRef.current = 0;
      s.emit("chat:typing", { conversationId: activeId, typing: false });
    }
  }

  async function loadEarlier() {
    if (!activeId || !messages.length || !hasMore) return;
    try {
      const oldest = messages[0];
      const res = await api.get<ChatMessagesResp>(
        `/chat/conversations/${activeId}/messages${qs({ before: oldest.createdAt, limit: 50 })}`,
      );
      setMessages((prev) => [...res.items.filter((m) => !prev.some((x) => x.id === m.id)), ...prev]);
      setHasMore(res.hasMore);
    } catch (err) {
      toast.error(errorMessage(err, "Could not load earlier messages."));
    }
  }

  async function removeMessage(m: ChatMessageDTO) {
    if (!m.mine && !activeConv?.canModerate) return;
    try {
      await api.del(`/chat/messages/${m.id}`);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      chatSocket()?.emit("chat:delete", { conversationId: m.conversationId, messageId: m.id });
      void qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      toast.success("Message deleted for everyone");
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete the message."));
    }
  }

  const typingNames = Object.values(typingBy).map((t) => t.name.split(" ")[0]);

  /* render */

  if (convQ.isLoading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading chat…
      </div>
    );
  }
  if (convQ.isError) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-xl border bg-card p-6 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Chat is unavailable</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {convQ.error instanceof ApiError ? convQ.error.message : "Chat could not be loaded."}
        </p>
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex h-[calc(100dvh-16.5rem)] min-h-[540px]">
        {/* ── conversation list ── */}
        <aside
          className={cn(
            "flex w-full shrink-0 flex-col border-r md:w-80 lg:w-96",
            activeId && "hidden md:flex",
          )}
          aria-label="Conversations"
        >
          <div className="flex items-center gap-2 border-b p-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats"
                className="h-9 pl-8"
                aria-label="Search conversations"
              />
            </div>
            <Button
              onClick={() => setNewChatOpen(true)}
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              aria-label="New chat"
              title="New chat"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto scroll-slim">
            {filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <MessagesSquare className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">No conversations</p>
                <p className="text-xs text-muted-foreground">
                  Use <span className="font-medium">New chat</span> to message a member, a group, or the church.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map((c) => (
                  <ConversationRow
                    key={c.id}
                    c={c}
                    active={c.id === activeId}
                    online={c.type === "direct" && c.otherPersonId ? online.has(c.otherPersonId) : false}
                    onOpen={() => {
                      setActiveId(c.id);
                      // REST read marks the thread read and broadcasts the receipt
                      void api.post(`/chat/conversations/${c.id}/read`).catch(() => {});
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span
              className={cn("h-2 w-2 rounded-full", socketOn ? "bg-emerald-500" : "bg-muted-foreground/40")}
              aria-hidden
            />
            {socketOn ? "Real-time connected" : "Connecting…"}
          </div>
        </aside>

        {/* ── thread ── */}
        <section className={cn("flex min-w-0 flex-1 flex-col", !activeId && "hidden md:flex")}>
          {activeConv ? (
            <>
              <header className="flex items-center gap-3 border-b px-3 py-2.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 md:hidden"
                  onClick={() => setActiveId(null)}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                {activeConv.type === "churchwide" ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Megaphone className="h-4.5 w-4.5" aria-hidden />
                  </div>
                ) : (
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className={cn("text-xs font-semibold text-white", avatarColor(activeConv.title))}>
                      {activeConv.type === "group" ? <UsersRound className="h-4 w-4" /> : initials(activeConv.title)}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight">{activeConv.title}</p>
                  <p className="truncate text-[11px] leading-tight text-muted-foreground">
                    {typingNames.length > 0 ? (
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…
                      </span>
                    ) : activeConv.type === "direct" && activeConv.otherPersonId && online.has(activeConv.otherPersonId) ? (
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">online</span>
                    ) : activeConv.type === "group" ? (
                      `${activeConv.memberCount} members · ${TYPE_LABEL.group}`
                    ) : activeConv.type === "churchwide" ? (
                      `Church-wide · ${activeConv.memberCount} people`
                    ) : (
                      "Last seen recently"
                    )}
                  </p>
                </div>
                {activeConv.type === "churchwide" && (
                  <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                    <Church className="h-3 w-3" aria-hidden /> Church-wide
                  </Badge>
                )}
              </header>

              {activeConv.type === "churchwide" && (
                <div className="flex items-center gap-1.5 border-b bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <Info className="h-3 w-3 shrink-0" aria-hidden />
                  Every message reaches everyone with church-wide access. Sends are audited.
                </div>
              )}

              <div ref={scrollRef} className="flex-1 space-y-0.5 overflow-y-auto scroll-slim px-3 py-4 md:px-5">
                {hasMore && (
                  <div className="mb-3 flex justify-center">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void loadEarlier()}>
                      Load earlier messages
                    </Button>
                  </div>
                )}
                {threadLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading messages…
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                    No messages yet — say hello!
                  </div>
                ) : (
                  <MessageList
                    messages={messages}
                    readBy={readBy}
                    isGroup={activeConv.type !== "direct"}
                    canModerate={activeConv.canModerate}
                    onDelete={(m) => void removeMessage(m)}
                  />
                )}
              </div>

              <div className="border-t p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    rows={1}
                    value={draft}
                    onChange={(e) => {
                      onDraftChange(e.target.value);
                      const el = e.target as HTMLTextAreaElement;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder={
                      activeConv.type === "churchwide"
                        ? "Message the whole church…"
                        : activeConv.type === "group"
                          ? `Message ${activeConv.title}…`
                          : `Message ${activeConv.title.split(" ")[0]}…`
                    }
                    aria-label="Message"
                    className="max-h-32 min-h-10 flex-1 resize-none"
                  />
                  <Button
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-full"
                    onClick={() => void send()}
                    disabled={!draft.trim() || sending}
                    aria-label="Send message"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Enter to send · Shift+Enter for a new line
                </p>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <MessagesSquare className="h-8 w-8 text-primary" aria-hidden />
              </div>
              <h3 className="text-lg font-semibold">Grace ChMS Chat</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Select a conversation to start messaging, or use{" "}
                <span className="font-medium text-foreground">New chat</span> to reach a member, a group you
                belong to{churchwideAvailable ? ", or the whole church" : ""}.
              </p>
            </div>
          )}
        </section>
      </div>

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        churchwideAvailable={churchwideAvailable}
        onPickDirect={(id) => void openDirect(id)}
        onPickGroup={(id) => void openGroup(id)}
        onPickChurchwide={openChurchwide}
      />
    </div>
  );
}

/* ───────────────────────── conversation row ───────────────────────── */

function ConversationRow({
  c,
  active,
  online,
  onOpen,
}: {
  c: ChatConversationDTO;
  active: boolean;
  online: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        active && "bg-muted",
      )}
    >
      <div className="relative shrink-0">
        {c.type === "churchwide" ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Church className="h-4.5 w-4.5" aria-hidden />
          </div>
        ) : (
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white",
              avatarColor(c.title),
            )}
            aria-hidden
          >
            {c.type === "group" ? <UsersRound className="h-4 w-4" /> : initials(c.title)}
          </div>
        )}
        {online && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-emerald-500"
            title="online"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold leading-tight">{c.title}</p>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {fmtListTime(c.lastMessage?.createdAt ?? c.updatedAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {c.lastMessage
              ? `${c.lastMessage.mine ? "You: " : c.type !== "direct" ? `${c.lastMessage.senderName.split(" ")[0]}: ` : ""}${c.lastMessage.body}`
              : c.type === "churchwide"
                ? "Church-wide room"
                : "No messages yet"}
          </p>
          {c.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">
              {c.unreadCount > 99 ? "99+" : c.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ───────────────────────── message list ───────────────────────── */

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; m: ChatMessageDTO; showSender: boolean };

function MessageList({
  messages,
  readBy,
  isGroup,
  canModerate,
  onDelete,
}: {
  messages: ChatMessageDTO[];
  readBy: Record<string, string>;
  isGroup: boolean;
  canModerate: boolean;
  onDelete: (m: ChatMessageDTO) => void;
}) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay = "";
    let lastSender = "";
    let lastTime = 0;
    for (const m of messages) {
      const day = dayKey(m.createdAt);
      if (day !== lastDay) {
        out.push({ kind: "day", key: `d-${day}`, label: dayLabel(m.createdAt) });
        lastDay = day;
        lastSender = "";
      }
      const t = new Date(m.createdAt).getTime();
      const showSender = m.senderPersonId !== lastSender || t - lastTime > 5 * 60000;
      out.push({ kind: "msg", key: m.id, m, showSender });
      lastSender = m.senderPersonId;
      lastTime = t;
    }
    return out;
  }, [messages]);

  const othersReadAt = useMemo(() => {
    const vals = Object.values(readBy);
    return vals.length ? Math.max(...vals.map((v) => new Date(v).getTime())) : 0;
  }, [readBy]);

  return (
    <>
      {rows.map((row) =>
        row.kind === "day" ? (
          <div key={row.key} className="my-3 flex justify-center">
            <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
              {row.label}
            </span>
          </div>
        ) : (
          <MessageBubble
            key={row.key}
            m={row.m}
            showSender={isGroup && row.showSender}
            read={row.m.mine && othersReadAt > new Date(row.m.createdAt).getTime()}
            canDelete={row.m.mine || canModerate}
            onDelete={() => onDelete(row.m)}
          />
        ),
      )}
    </>
  );
}

function MessageBubble({
  m,
  showSender,
  read,
  canDelete,
  onDelete,
}: {
  m: ChatMessageDTO;
  showSender: boolean;
  read: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className={cn("group flex w-full px-1", m.mine ? "justify-end" : "justify-start")}>
      <div className={cn("relative max-w-[85%] sm:max-w-[70%]", m.mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-3 py-1.5 shadow-sm",
            m.mine ? "rounded-br-md bg-emerald-600 text-white" : "rounded-bl-md border bg-card",
          )}
        >
          {showSender && !m.mine && (
            <p className={cn("text-xs font-semibold", senderColor(m.senderName))}>{m.senderName}</p>
          )}
          <p className="whitespace-pre-wrap break-words text-sm leading-snug">{m.body}</p>
          <div className="mt-0.5 flex items-center justify-end gap-1">
            <span className={cn("text-[10px] tabular-nums", m.mine ? "text-emerald-100/90" : "text-muted-foreground")}>
              {fmtTime(m.createdAt)}
            </span>
            {m.mine &&
              (read ? (
                <CheckCheck className="h-3.5 w-3.5 text-emerald-200" aria-label="Read" />
              ) : (
                <Check className="h-3.5 w-3.5 text-emerald-200/70" aria-label="Sent" />
              ))}
          </div>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete message"
            title={m.mine ? "Delete for everyone" : "Moderate: delete message"}
            className={cn(
              "absolute top-1 rounded-full border bg-background/90 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity",
              "hover:bg-background hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100",
              m.mine ? "-left-7" : "-right-7",
            )}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── new chat dialog ───────────────────────── */

function NewChatDialog({
  open,
  onOpenChange,
  churchwideAvailable,
  onPickDirect,
  onPickGroup,
  onPickChurchwide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  churchwideAvailable: boolean;
  onPickDirect: (personId: string) => void;
  onPickGroup: (groupId: string) => void;
  onPickChurchwide: () => void;
}) {
  const [kind, setKind] = useState<"direct" | "group" | "churchwide">("direct");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const peopleQ = useApiQuery<{ items: ChatDirectoryPerson[] }>(
    ["chat", "directory", "people", debounced],
    `/chat/directory/people${qs({ search: debounced || undefined })}`,
    { enabled: open && kind === "direct" },
  );
  const groupsQ = useApiQuery<{ items: ChatDirectoryGroup[] }>(
    ["chat", "directory", "groups"],
    "/chat/directory/groups",
    { enabled: open && kind === "group" },
  );

  function reset() {
    setKind("direct");
    setSearch("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto scroll-slim sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>
            Choose an audience — an individual member, a group you belong to, or the whole church.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={kind}
          onValueChange={(v) => setKind(v as typeof kind)}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          <Label
            htmlFor="aud-direct"
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium",
              kind === "direct" && "border-primary bg-primary/5",
            )}
          >
            <RadioGroupItem id="aud-direct" value="direct" className="sr-only" />
            <UserRound className="h-4 w-4 text-primary" aria-hidden /> Member
          </Label>
          <Label
            htmlFor="aud-group"
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium",
              kind === "group" && "border-primary bg-primary/5",
            )}
          >
            <RadioGroupItem id="aud-group" value="group" className="sr-only" />
            <UsersRound className="h-4 w-4 text-primary" aria-hidden /> Group
          </Label>
          <Label
            htmlFor="aud-church"
            aria-disabled={!churchwideAvailable}
            className={cn(
              "flex items-center gap-2 rounded-lg border p-3 text-sm font-medium",
              churchwideAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-55",
              kind === "churchwide" && "border-primary bg-primary/5",
            )}
            onClick={() => churchwideAvailable && setKind("churchwide")}
          >
            <RadioGroupItem
              id="aud-church"
              value="churchwide"
              className="sr-only"
              disabled={!churchwideAvailable}
              checked={kind === "churchwide"}
              onChange={() => {}}
              tabIndex={-1}
            />
            {churchwideAvailable ? (
              <Church className="h-4 w-4 text-primary" aria-hidden />
            ) : (
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
            )}
            Church-wide
          </Label>
        </RadioGroup>
        {!churchwideAvailable && (
          <p className="-mt-2 text-[11px] text-muted-foreground">
            Church-wide chat requires the <span className="font-medium">comms.chat.churchwide</span> permission.
          </p>
        )}

        {kind === "direct" && (
          <div className="space-y-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members by name or email…"
              aria-label="Search members"
            />
            <ScrollArea className="h-72 rounded-lg border">
              <div className="divide-y">
                {peopleQ.isLoading ? (
                  <p className="p-4 text-sm text-muted-foreground">Loading members…</p>
                ) : (peopleQ.data?.items ?? []).length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No members match.</p>
                ) : (
                  (peopleQ.data?.items ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!p.hasPortalAccess}
                      onClick={() => void onPickDirect(p.id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className={cn("text-xs font-semibold text-white", avatarColor(p.name))}>
                          {initials(p.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-tight">{p.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{p.email ?? p.stage}</p>
                      </div>
                      {p.hasPortalAccess ? (
                        <Badge variant="outline" className="shrink-0 border-emerald-500/40 text-[10px] text-emerald-700 dark:text-emerald-400">
                          portal
                        </Badge>
                      ) : (
                        <span className="shrink-0 text-[10px] text-muted-foreground">no portal account</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {kind === "group" && (
          <div className="space-y-2">
            <ScrollArea className="h-72 rounded-lg border">
              <div className="divide-y">
                {groupsQ.isLoading ? (
                  <p className="p-4 text-sm text-muted-foreground">Loading your groups…</p>
                ) : (groupsQ.data?.items ?? []).length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">You don't belong to any groups yet.</p>
                ) : (
                  (groupsQ.data?.items ?? []).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => void onPickGroup(g.id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <UsersRound className="h-4 w-4" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-tight">{g.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {g.memberCount} members · you are {g.myRole.replace("_", " ")}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
            <p className="text-[11px] text-muted-foreground">
              Group chats sync with group membership — members join and leave automatically.
            </p>
          </div>
        )}

        {kind === "churchwide" && churchwideAvailable && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              Church-wide chat reaches everyone with access. Use it for announcements and all-church
              coordination — messages here are audited.
            </div>
            <DialogFooter>
              <Button onClick={onPickChurchwide} className="gap-1.5">
                <Megaphone className="h-4 w-4" /> Open church-wide chat
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
