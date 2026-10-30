"use client";

/**
 * NotificationBell — the cross-module notification bell beside the profile
 * avatar in the topbar. Shows the unread count, lists the latest entries
 * (chat messages, volunteer assignments, urgent care cases, …) and navigates
 * to the originating module on click. Polls every 25s and on window focus;
 * chat messages additionally arrive in real time via the socket (the chat
 * tab invalidates the "notifications" query on every incoming message).
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { NotificationDTO, NotificationsResp } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApiQuery } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BadgeCheck, Bell, CalendarClock, CheckCheck, HeartHandshake, Loader2, MessageSquare, Megaphone, UsersRound } from "lucide-react";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const MODULE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  volunteers: CalendarClock,
  care: HeartHandshake,
  comms: Megaphone,
  groups: UsersRound,
  events: CalendarClock,
};

const MODULE_TINT: Record<string, string> = {
  chat: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  volunteers: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  care: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
  comms: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  groups: "bg-teal-500/12 text-teal-600 dark:text-teal-400",
  events: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
};

export default function NotificationBell({ className }: { className?: string }) {
  const qc = useQueryClient();
  const q = useApiQuery<NotificationsResp>(["notifications"], "/notifications", {
    refetchInterval: 25_000, // pull-based inbox — cheap and robust
  });
  const items = q.data?.items ?? [];
  const unread = q.data?.unread ?? 0;

  // refresh when the window regains focus (cheap safety net)
  useEffect(() => {
    const onFocus = () => void qc.invalidateQueries({ queryKey: ["notifications"] });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  async function open(n: NotificationDTO) {
    if (!n.read) {
      // optimistic — keep the panel snappy
      qc.setQueryData<NotificationsResp>(["notifications"], (prev) =>
        prev
          ? {
              unread: Math.max(0, prev.unread - 1),
              items: prev.items.map((x) => (x.id === n.id ? { ...x, read: true, readAt: new Date().toISOString() } : x)),
            }
          : prev,
      );
      try {
        await api.post(`/notifications/${n.id}/read`);
      } catch {
        /* refetch will reconcile */
      }
    }
    if (n.linkModule) {
      window.dispatchEvent(new CustomEvent("chms:navigate", { detail: n.linkModule }));
    }
  }

  async function markAllRead() {
    try {
      await api.post("/notifications/read-all");
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not mark notifications read.");
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative h-9 w-9 rounded-full", className)}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="h-4.5 w-4.5" />
          {unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white shadow-sm"
              aria-hidden
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-88 max-w-[92vw] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => void markAllRead()}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto scroll-slim" role="list" aria-label="Notification list">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <BadgeCheck className="h-7 w-7 text-muted-foreground/50" aria-hidden />
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="max-w-60 text-xs text-muted-foreground">
                Chat messages, volunteer schedules and urgent care updates will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const Icon = MODULE_ICON[n.module] ?? Bell;
                const tint = MODULE_TINT[n.module] ?? "bg-muted text-muted-foreground";
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      role="listitem"
                      onClick={() => void open(n)}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                        !n.read && "bg-primary/[0.04]",
                      )}
                      title={n.linkModule ? `Open ${n.linkModule}` : undefined}
                    >
                      <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", tint)} aria-hidden>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn("truncate text-[13px] leading-tight", n.read ? "font-medium" : "font-semibold")}>
                            {n.title}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{timeAgo(n.createdAt)}</span>
                        </span>
                        {n.body && <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted-foreground">{n.body}</span>}
                      </span>
                      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="unread" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
