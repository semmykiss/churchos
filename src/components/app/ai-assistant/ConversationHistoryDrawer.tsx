"use client";

import { useState } from "react";
import { CheckCheck, MessageSquare, ShieldAlert, Trash2, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AiAuditRow, AiCrisisFlagRow, AiConversationItem } from "./types";

/**
 * ConversationHistoryDrawer — past conversations (resume/delete) plus the
 * compliance-only surfaces: AI safeguarding flags (care.view) and the tool
 * audit trail (audit.view). Tabs appear only for viewers holding those perms.
 */

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const CATEGORY_LABELS: Record<string, string> = {
  self_harm: "Self-harm concern",
  abuse_disclosure: "Abuse disclosure",
  other: "Other safeguarding",
};

export default function ConversationHistoryDrawer({
  conversations,
  currentId,
  canReviewCrisis,
  canViewAudit,
  onResume,
  onDelete,
  onClose,
}: {
  conversations: AiConversationItem[];
  currentId: string | null;
  canReviewCrisis: boolean;
  canViewAudit: boolean;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"chats" | "flags" | "audit">("chats");
  const qc = useQueryClient();

  const showTabs = canReviewCrisis || canViewAudit;
  const activeTab = showTabs ? tab : "chats";

  const flags = useQuery<AiCrisisFlagRow[]>({
    queryKey: ["ai", "crisis-flags"],
    queryFn: async () => (await api.get<{ items: AiCrisisFlagRow[] }>("/ai/crisis-flags?open=1")).items,
    enabled: activeTab === "flags",
  });

  const audit = useQuery<AiAuditRow[]>({
    queryKey: ["ai", "tool-audit"],
    queryFn: async () => (await api.get<{ items: AiAuditRow[] }>("/ai/tool-audit")).items,
    enabled: activeTab === "audit",
  });

  async function markReviewed(id: string) {
    try {
      await api.post(`/ai/crisis-flags/${id}/review`);
      qc.invalidateQueries({ queryKey: ["ai", "crisis-flags"] });
      toast.success("Flag marked as reviewed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the flag.");
    }
  }

  return (
    <div className="absolute inset-y-0 left-0 z-20 flex w-full max-w-80 flex-col border-r bg-background shadow-xl" role="dialog" aria-label="Conversation history">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <p className="text-sm font-semibold">History</p>
        <button onClick={onClose} aria-label="Close history" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      {showTabs ? (
        <div className="flex gap-1 border-b px-2 py-1.5">
          {([
            ["chats", "Chats", MessageSquare],
            ...(canReviewCrisis ? [["flags", "Safeguarding", ShieldAlert] as const] : []),
            ...(canViewAudit ? [["audit", "Tool audit", CheckCheck] as const] : []),
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                activeTab === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-3 w-3" /> {label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-2 scroll-slim">
        {activeTab === "chats" ? (
          conversations.length ? (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <div
                    className={cn(
                      "group flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors",
                      c.id === currentId ? "bg-primary/10" : "hover:bg-muted",
                      c.status === "ended" && "opacity-70",
                    )}
                  >
                    <button onClick={() => onResume(c.id)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-xs font-medium">{c.title}</p>
                      <p className="text-[10.5px] text-muted-foreground">
                        {relTime(c.updatedAt)} · {c.messageCount} messages{c.status === "ended" ? " · ended" : ""}
                      </p>
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      aria-label={`Delete conversation ${c.title}`}
                      className="rounded p-1.5 text-muted-foreground/60 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No conversations yet.</p>
          )
        ) : null}

        {activeTab === "flags" ? (
          flags.isLoading ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : flags.data?.length ? (
            <ul className="space-y-2">
              {flags.data.map((f) => (
                <li key={f.id} className="rounded-lg border border-rose-200 bg-rose-50/60 p-2.5 text-xs dark:border-rose-500/30 dark:bg-rose-950/30">
                  <p className="font-semibold text-rose-700 dark:text-rose-300">{CATEGORY_LABELS[f.category] ?? f.category}</p>
                  {f.person ? <p className="mt-0.5">Person: {f.person}</p> : <p className="mt-0.5 text-muted-foreground">No person record linked</p>}
                  {f.excerpt ? <p className="mt-1 line-clamp-3 italic text-muted-foreground">“{f.excerpt}”</p> : null}
                  <p className="mt-1 text-[10.5px] text-muted-foreground">{relTime(f.createdAt)}{f.careCaseId ? " · care case created" : ""}</p>
                  <button onClick={() => markReviewed(f.id)} className="mt-1.5 rounded-md border border-rose-300 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-900/40">
                    Mark reviewed
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No open safeguarding flags.</p>
          )
        ) : null}

        {activeTab === "audit" ? (
          audit.isLoading ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : audit.data?.length ? (
            <ul className="space-y-1.5">
              {audit.data.map((a) => (
                <li key={a.id} className="rounded-lg border p-2 text-[11px]">
                  <p className="flex items-center justify-between gap-2 font-medium">
                    <span className="truncate">{a.toolName}</span>
                    <span className={a.permissionCheckResult ? "text-teal-600 dark:text-teal-400" : "text-destructive"}>
                      {a.permissionCheckResult ? "allowed" : "denied"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {a.user} · {a.rowsReturned ?? 0} rows · {relTime(a.executedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No tool executions logged yet.</p>
          )
        ) : null}
      </div>
    </div>
  );
}
