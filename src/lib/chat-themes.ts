"use client";

/**
 * Chat themes — per-user chat interface appearance (chat wallpaper + bubble
 * colours), persisted in localStorage. Purely presentational: the client-side
 * only; the server never needs to know.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface ChatTheme {
  id: string;
  label: string;
  swatch: string; // picker preview dot
  shell: string; // root chat card
  thread: string; // message canvas (wallpaper)
  threadHeader: string; // strip above the canvas
  composer: string; // composer strip below the canvas
  dayChip: string; // date separator chip
  mineBubble: string; // own message bubble
  mineMeta: string; // timestamp/receipts on own bubble
  mineQuote: string; // quoted block inside own bubble
  theirsBubble: string; // incoming message bubble
  theirsMeta: string; // timestamp on incoming bubble
  theirsQuote: string; // quoted block inside incoming bubble
  hint: string; // "Enter to send" hint row
}

export const CHAT_THEMES: ChatTheme[] = [
  {
    id: "classic",
    label: "Classic",
    swatch: "bg-emerald-600",
    shell: "bg-card",
    thread: "bg-muted/30",
    threadHeader: "bg-card",
    composer: "bg-card",
    dayChip: "bg-background",
    mineBubble: "bg-emerald-600 text-white",
    mineMeta: "text-emerald-100/90",
    mineQuote: "border-emerald-300/80 bg-emerald-700/35 text-emerald-50",
    theirsBubble: "border bg-card",
    theirsMeta: "text-muted-foreground",
    theirsQuote: "border-l-primary/70 bg-muted text-foreground",
    hint: "text-muted-foreground",
  },
  {
    id: "midnight",
    label: "Midnight",
    swatch: "bg-zinc-900 ring-1 ring-zinc-600",
    shell: "bg-zinc-950 text-zinc-100 border-zinc-800",
    thread: "bg-zinc-900",
    threadHeader: "bg-zinc-950 border-zinc-800",
    composer: "bg-zinc-950",
    dayChip: "bg-zinc-800 text-zinc-300",
    mineBubble: "bg-emerald-600 text-white",
    mineMeta: "text-emerald-100/90",
    mineQuote: "border-emerald-300/80 bg-emerald-700/35 text-emerald-50",
    theirsBubble: "border border-zinc-700/70 bg-zinc-800 text-zinc-100",
    theirsMeta: "text-zinc-400",
    theirsQuote: "border-l-emerald-400 bg-zinc-700/70 text-zinc-100",
    hint: "text-zinc-500",
  },
  {
    id: "parchment",
    label: "Parchment",
    swatch: "bg-amber-200",
    shell: "bg-card",
    thread: "bg-[#f4ecdd] dark:bg-[#2b2620]",
    threadHeader: "bg-card",
    composer: "bg-card",
    dayChip: "bg-[#fdf9f0] dark:bg-zinc-800",
    mineBubble: "bg-amber-600 text-white",
    mineMeta: "text-amber-100/90",
    mineQuote: "border-amber-300/80 bg-amber-700/35 text-amber-50",
    theirsBubble: "border border-amber-900/15 bg-[#fffdf6] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
    theirsMeta: "text-amber-900/60 dark:text-zinc-400",
    theirsQuote: "border-l-amber-600 bg-amber-500/10 text-foreground",
    hint: "text-amber-900/50 dark:text-zinc-400",
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "bg-rose-500",
    shell: "bg-card",
    thread: "bg-rose-50/70 dark:bg-[#2a1d20]",
    threadHeader: "bg-card",
    composer: "bg-card",
    dayChip: "bg-rose-100 dark:bg-zinc-800",
    mineBubble: "bg-rose-600 text-white",
    mineMeta: "text-rose-100/90",
    mineQuote: "border-rose-300/80 bg-rose-700/35 text-rose-50",
    theirsBubble: "border border-rose-200/80 bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
    theirsMeta: "text-rose-900/50 dark:text-zinc-400",
    theirsQuote: "border-l-rose-500 bg-rose-500/10 text-foreground",
    hint: "text-rose-900/50 dark:text-zinc-400",
  },
  {
    id: "forest",
    label: "Forest",
    swatch: "bg-teal-700",
    shell: "bg-card",
    thread: "bg-teal-50/60 dark:bg-[#16231f]",
    threadHeader: "bg-card",
    composer: "bg-card",
    dayChip: "bg-teal-100 dark:bg-zinc-800",
    mineBubble: "bg-teal-700 text-white",
    mineMeta: "text-teal-100/90",
    mineQuote: "border-teal-300/80 bg-teal-900/40 text-teal-50",
    theirsBubble: "border border-teal-200/70 bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
    theirsMeta: "text-teal-900/50 dark:text-zinc-400",
    theirsQuote: "border-l-teal-600 bg-teal-500/10 text-foreground",
    hint: "text-teal-900/50 dark:text-zinc-400",
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch: "bg-orange-500",
    shell: "bg-card",
    thread: "bg-orange-50/70 dark:bg-[#271d16]",
    threadHeader: "bg-card",
    composer: "bg-card",
    dayChip: "bg-orange-100 dark:bg-zinc-800",
    mineBubble: "bg-orange-600 text-white",
    mineMeta: "text-orange-100/90",
    mineQuote: "border-orange-300/80 bg-orange-700/35 text-orange-50",
    theirsBubble: "border border-orange-200/80 bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
    theirsMeta: "text-orange-900/50 dark:text-zinc-400",
    theirsQuote: "border-l-orange-600 bg-orange-500/10 text-foreground",
    hint: "text-orange-900/50 dark:text-zinc-400",
  },
];

const STORAGE_KEY = "grace.chat.theme";
const THEME_EVENT = "chms:chat-theme";

/** Hydration-safe read of the persisted theme via an external store. */
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_EVENT, callback);
  };
}

function getSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? CHAT_THEMES[0].id;
  } catch {
    return CHAT_THEMES[0].id;
  }
}

function getServerSnapshot(): string {
  return CHAT_THEMES[0].id;
}

/** Per-user chat theme, persisted to localStorage (client only). */
export function useChatTheme(): [ChatTheme, (id: string) => void] {
  const id = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const theme = CHAT_THEMES.find((t) => t.id === id) ?? CHAT_THEMES[0];

  const pick = useCallback((nextId: string) => {
    const next = CHAT_THEMES.find((t) => t.id === nextId) ?? CHAT_THEMES[0];
    try {
      window.localStorage.setItem(STORAGE_KEY, next.id);
    } catch {
      /* private mode — theme just won't persist */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return [theme, pick];
}
