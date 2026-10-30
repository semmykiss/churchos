"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { AiConversationItem, AiMsg, AiStreamEvent } from "../types";

/**
 * useAiConversation — conversation lifecycle + SSE streaming for Shepherd.
 * Continuity: re-opening the panel resumes the most recent ACTIVE conversation
 * instead of forcing a new thread; "New chat" is an explicit user choice.
 */
export function useAiConversation(panelOpen: boolean) {
  const [conversations, setConversations] = useState<AiConversationItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convoStatus, setConvoStatus] = useState<"active" | "ended" | "none">("none");
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamTools, setStreamTools] = useState<string[]>([]);
  const [crisisEvent, setCrisisEvent] = useState<{ category: string; careCaseId?: string | null } | null>(null);
  const [booted, setBooted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await api.get<{ items: AiConversationItem[] }>("/ai/conversations");
      setConversations(res.items);
      return res.items;
    } catch {
      return [];
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const res = await api.get<{ items: AiMsg[] }>(`/ai/conversations/${id}/messages`);
    setMessages(res.items);
  }, []);

  // boot: resume the most recent ACTIVE conversation (continuity, not a new thread)
  useEffect(() => {
    if (!panelOpen) return;
    let cancelled = false;
    (async () => {
      setBooted(false);
      const items = await refreshConversations();
      if (cancelled) return;
      const current = items.find((c) => c.status === "active");
      if (current) {
        setConversationId(current.id);
        setConvoStatus("active");
        try {
          await loadMessages(current.id);
        } catch {
          setMessages([]);
        }
      } else {
        setConversationId(null);
        setConvoStatus("none");
        setMessages([]);
      }
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [panelOpen, refreshConversations, loadMessages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Parse an SSE body stream from a fetch Response. */
  async function consumeSSE(res: Response, onEvent: (evt: AiStreamEvent) => void): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Streaming not supported in this browser.");
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()) as AiStreamEvent);
          } catch {
            // ignore malformed keep-alive fragments
          }
        }
      }
    }
  }

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || streaming) return;
      setStreaming(true);
      setStreamingText("");
      setStreamTools([]);
      setCrisisEvent(null);
      const optimisticUser: AiMsg = { id: `tmp-u-${Date.now()}`, role: "user", content: text };
      setMessages((prev) => [...prev, optimisticUser]);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // lazy conversation creation on first send
        let convoId = conversationId;
        if (!convoId) {
          const created = await api.post<{ id: string }>("/ai/conversations");
          convoId = created.id;
          setConversationId(convoId);
          setConvoStatus("active");
        }

        const res = await fetch(`/api/v1/ai/conversations/${convoId}/messages`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: text }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          let message = "Shepherd could not reply just now.";
          try {
            const data = await res.json();
            if (data?.message) message = data.message;
          } catch {}
          throw new Error(message);
        }

        await consumeSSE(res, (evt) => {
          if (evt.type === "crisis") setCrisisEvent({ category: evt.category, careCaseId: evt.careCaseId });
          if (evt.type === "tools") setStreamTools(evt.names);
          if (evt.type === "token") setStreamingText((prev) => prev + evt.text);
          if (evt.type === "error") toast.error(evt.message);
        });

        // resync with the server thread (real ids + tool rows + cards)
        if (convoId) await loadMessages(convoId);
        refreshConversations();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toast.error(err instanceof Error ? err.message : "Something went wrong.");
        }
      } finally {
        setStreaming(false);
        setStreamingText("");
        setStreamTools([]);
        abortRef.current = null;
      }
    },
    [conversationId, streaming, loadMessages, refreshConversations],
  );

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(null);
    setConvoStatus("none");
    setMessages([]);
    setStreamingText("");
    setStreamTools([]);
    setCrisisEvent(null);
  }, []);

  const clearChat = useCallback(async () => {
    if (!conversationId) return;
    try {
      await api.post(`/ai/conversations/${conversationId}/clear`);
      setMessages([]);
      setStreamingText("");
      setCrisisEvent(null);
      refreshConversations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not clear the chat.");
    }
  }, [conversationId, refreshConversations]);

  const endChat = useCallback(async () => {
    if (!conversationId) return;
    try {
      await api.post(`/ai/conversations/${conversationId}/end`);
      setConvoStatus("ended");
      refreshConversations();
      toast.success("Conversation ended and archived.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not end the conversation.");
    }
  }, [conversationId, refreshConversations]);

  const resume = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      setConversationId(id);
      setStreamingText("");
      setStreamTools([]);
      setCrisisEvent(null);
      try {
        const item = await api.get<{ items: AiMsg[] }>(`/ai/conversations/${id}/messages`);
        setMessages(item.items);
        const meta = conversations.find((c) => c.id === id);
        setConvoStatus(meta?.status === "ended" ? "ended" : "active");
      } catch {
        toast.error("Could not load that conversation.");
      }
    },
    [conversations],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.del(`/ai/conversations/${id}`);
        if (id === conversationId) newChat();
        refreshConversations();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not delete the conversation.");
      }
    },
    [conversationId, newChat, refreshConversations],
  );

  return {
    conversations,
    conversationId,
    convoStatus,
    messages,
    streaming,
    streamingText,
    streamTools,
    crisisEvent,
    booted,
    send,
    newChat,
    clearChat,
    endChat,
    resume,
    remove,
    refreshConversations,
  };
}
