"use client";

import { useState } from "react";
import { History, MessageSquarePlus, Sparkles, Square, Trash, X } from "lucide-react";
import { cn } from "@/lib/utils";
import MessageThread from "./MessageThread";
import SuggestedPrompts from "./SuggestedPrompts";
import ChatInputBar from "./ChatInputBar";
import ConversationHistoryDrawer from "./ConversationHistoryDrawer";
import { useAiConversation } from "./hooks/useAiConversation";
import { useAiToolSchema } from "./hooks/useAiToolSchema";
import type { SessionUser } from "@/lib/types";

/**
 * AiChatPanel — the slide-over Shepherd surface. Blends with the app's ink
 * theme: neutral header, ink accents, report cards — no off-palette colors.
 */
export default function AiChatPanel({ user, onClose }: { user: SessionUser; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const info = useAiToolSchema(true);
  const convo = useAiConversation(true);
  const assistantName = info.data?.assistantName ?? "Shepherd";
  const ended = convo.convoStatus === "ended";
  const empty = !convo.messages.length && !convo.streaming && !convo.streamingText;

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    convo.send(text);
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${assistantName} AI assistant`}>
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} aria-hidden />

      <div className="absolute inset-y-0 right-0 flex w-full flex-col bg-background shadow-2xl outline-none sm:w-[440px] lg:w-[460px] [animation:shepherd-slide-in_.28s_cubic-bezier(.32,.72,0,1)]">
        {/* Header — quiet surface banner */}
        <div className="relative shrink-0 border-b bg-surface px-4 pb-3.5 pt-4 text-ink">
          <style>{`@keyframes shepherd-slide-in { from { transform: translateX(24px); opacity: .4 } to { transform: translateX(0); opacity: 1 } }`}</style>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{assistantName}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  Your church's AI assistant
                </p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setHistoryOpen((v) => !v)} aria-label="Conversation history" title="History" className="rounded-lg p-2 transition-colors hover:bg-surface-sunken">
                <History className="h-4 w-4" />
              </button>
              <button onClick={convo.newChat} aria-label="New chat" title="New chat" className="rounded-lg p-2 transition-colors hover:bg-surface-sunken">
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button onClick={onClose} aria-label="Close panel" title="Close" className="rounded-lg p-2 transition-colors hover:bg-surface-sunken">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {convo.conversationId ? (
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className="max-w-[55%] truncate rounded-full bg-surface-sunken px-2 py-0.5 text-[10.5px] text-ink-secondary">{convo.messages[0]?.content?.slice(0, 40) || "Current conversation"}</span>
              {!ended ? (
                <>
                  <button
                    onClick={() => setConfirmClear((v) => !v)}
                    className="flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[10.5px] transition-colors hover:brightness-95"
                  >
                    <Trash className="h-3 w-3" /> Clear
                  </button>
                  <button onClick={convo.endChat} className="flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[10.5px] transition-colors hover:brightness-95">
                    <Square className="h-2.5 w-2.5 fill-current" /> End
                  </button>
                </>
              ) : (
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10.5px] text-ink-muted">Ended — start a new chat</span>
              )}
            </div>
          ) : null}
          {confirmClear ? (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-surface-sunken p-1.5 text-[11px] text-ink-secondary">
              <span className="px-1">Clear all messages in this chat?</span>
              <button
                onClick={() => { convo.clearChat(); setConfirmClear(false); }}
                className="rounded-md bg-primary px-2 py-1 font-semibold text-primary-foreground"
              >
                Clear
              </button>
              <button onClick={() => setConfirmClear(false)} className="rounded-md px-2 py-1 hover:bg-surface-sunken">Keep</button>
            </div>
          ) : null}
        </div>

        {/* Thread */}
        <div className="relative flex-1 overflow-hidden">
          {historyOpen ? (
            <ConversationHistoryDrawer
              conversations={convo.conversations}
              currentId={convo.conversationId}
              canReviewCrisis={!!info.data?.canReviewCrisis}
              canViewAudit={!!info.data?.canViewAudit}
              onResume={(id) => { convo.resume(id); setHistoryOpen(false); }}
              onDelete={convo.remove}
              onClose={() => setHistoryOpen(false)}
            />
          ) : null}

          <div className={cn("h-full overflow-y-auto px-4 py-4 scroll-slim", empty && "flex flex-col justify-center")}>
            {empty ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center gap-2.5 pt-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-base font-semibold">Hello, {user.name.split(" ")[0]} 👋</p>
                    <p className="mt-0.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                      {assistantName} can only see what your role is allowed to see — and every data lookup is logged. Ask about your giving, reports, scripture, or just talk.
                    </p>
                  </div>
                </div>
                <SuggestedPrompts prompts={info.data?.prompts ?? []} onPick={(p) => convo.send(p)} />
              </div>
            ) : (
              <MessageThread
                messages={convo.messages}
                streaming={convo.streaming}
                streamingText={convo.streamingText}
                streamTools={convo.streamTools}
                crisisEvent={convo.crisisEvent}
                info={info.data}
              />
            )}
          </div>
        </div>

        {/* Input */}
        <div className="shrink-0 border-t bg-background px-3.5 py-3">
          <ChatInputBar value={input} onChange={setInput} onSend={send} disabled={convo.streaming || ended} />
          <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-muted-foreground/70">
            {assistantName} is not a licensed counselor or tax advisor. For crises it will surface help and notify the care team transparently.
          </p>
        </div>
      </div>
    </div>
  );
}
