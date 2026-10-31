"use client";

import { useEffect, useRef } from "react";
import { SendHorizontal } from "lucide-react";

/** Pill input bar with gradient focus ring + gradient send button. */
export default function ChatInputBar({
  value,
  onChange,
  onSend,
  disabled,
  maxLength = 4000,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }, [value]);

  return (
    <div className="flex items-end gap-2">
      <div className="relative flex-1">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled) onSend();
            }
          }}
          rows={1}
          placeholder="Ask Shepherd anything…"
          aria-label="Message to Shepherd"
          disabled={disabled}
          className="w-full resize-none rounded-2xl border bg-background py-2.5 pl-3.5 pr-12 text-sm shadow-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:opacity-60"
        />
        <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] tabular-nums text-muted-foreground/60">
          {value.length > maxLength * 0.7 ? `${value.length}/${maxLength}` : ""}
        </span>
      </div>
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        aria-label="Send message"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-all hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <SendHorizontal className="h-4.5 w-4.5" />
      </button>
    </div>
  );
}
