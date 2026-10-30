"use client";

/**
 * EmojiPicker — lightweight, dependency-free emoji picker for the chat
 * composer. Category tabs + grid, inserts at the cursor position.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Smile } from "lucide-react";

/* Curated, church-friendly sets — compact by design (no huge emoji DB). */
const CATEGORIES: { key: string; label: string; icon: string; emoji: string[] }[] = [
  {
    key: "smileys",
    label: "Smileys",
    icon: "😀",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
      "🙂", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘",
      "😋", "😜", "🤪", "🤗", "🤔", "🤨", "😐", "😴",
      "😌", "😔", "😪", "🤤", "😷", "🤒", "🥳", "🥺",
      "😢", "😭", "😤", "😠", "🤯", "😳", "🥹", "😎",
    ],
  },
  {
    key: "people",
    label: "People",
    icon: "🙌",
    emoji: [
      "🙌", "👏", "🙏", "🤝", "👍", "👎", "✌️", "🤞",
      "🤟", "🤘", "👌", "🤌", "👈", "👉", "👆", "👇",
      "☝️", "✋", "🤚", "🖐️", "👋", "🤙", "💪", "🫶",
      "🫂", "🧎", "🏃", "🚶", "💃", "🕺", "🤱", "🧑‍🤝‍🧑",
    ],
  },
  {
    key: "hearts",
    label: "Hearts",
    icon: "❤️",
    emoji: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
      "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖",
      "💘", "💝", "💟", "✨", "🌟", "⭐", "💫", "🔥",
    ],
  },
  {
    key: "faith",
    label: "Faith",
    icon: "🙏",
    emoji: [
      "🙏", "⛪", "🕊️", "✝️", "📖", "🕯️", "🔔", "🎶",
      "🎵", "🎤", "🥁", "🎸", "🎹", "👼", "🌟", "🍒",
    ],
  },
  {
    key: "food",
    label: "Food",
    icon: "🍽️",
    emoji: [
      "☕", "🍵", "🧃", "🥤", "🍰", "🧁", "🍪", "🍩",
      "🍞", "🥐", "🥯", "🧇", "🍯", "🍎", "🍌", "🍇",
      "🍕", "🍔", "🌮", "🍲", "🥗", "🍗", "🐟", "🍚",
    ],
  },
  {
    key: "activity",
    label: "Activities",
    icon: "⚽",
    emoji: [
      "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏓", "🎯",
      "🎮", "🎲", "🧩", "🎨", "🎬", "📸", "🏕️", "🌴",
      "🚗", "✈️", "🚴", "🥾", "🎉", "🎊", "🎁", "🏆",
    ],
  },
  {
    key: "objects",
    label: "Objects",
    icon: "💡",
    emoji: [
      "💡", "🔋", "📱", "💻", "🖥️", "📞", "✉️", "📩",
      "📝", "📋", "📌", "📎", "🔍", "🔑", "🔒", "🧧",
      "💰", "💳", "💎", "⏰", "📅", "📍", "🏠", "🚪",
    ],
  },
  {
    key: "symbols",
    label: "Symbols",
    icon: "✅",
    emoji: [
      "✅", "☑️", "✔️", "❌", "❓", "❗", "⚠️", "🚫",
      "💯", "🆗", "🔄", "➕", "➖", "➗", "🟢", "🔴",
      "🟡", "🟠", "🟣", "⚫", "⚪", "🟤", "🔶", "🔷",
    ],
  },
];

export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(CATEGORIES[0].key);
  const active = useMemo(() => CATEGORIES.find((c) => c.key === cat) ?? CATEGORIES[0], [cat]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          disabled={disabled}
          aria-label="Insert emoji"
          title="Emoji"
        >
          <Smile className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">Emoji</p>
          <div className="flex gap-0.5" role="tablist" aria-label="Emoji categories">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={c.key === cat}
                title={c.label}
                onClick={() => setCat(c.key)}
                className={cn(
                  "flex h-6.5 w-6.5 items-center justify-center rounded-md text-sm transition-colors hover:bg-muted",
                  c.key === cat && "bg-primary/12 ring-1 ring-primary/40",
                )}
              >
                {c.icon}
              </button>
            ))}
          </div>
        </div>
        <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto scroll-slim" role="group" aria-label={`${active.label} emoji`}>
          {active.emoji.map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              aria-label={`Insert ${e}`}
              title={e}
              onClick={() => {
                onPick(e);
                // keep the picker open for emoji sequences (e.g. 🙏🙌)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none transition-colors hover:bg-muted"
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
