"use client";

import { Sparkles } from "lucide-react";

/** Role-aware suggested prompts shown when the conversation is empty. */
export default function SuggestedPrompts({ prompts, onPick }: { prompts: string[]; onPick: (p: string) => void }) {
  if (!prompts.length) return null;
  return (
    <div className="space-y-2" aria-label="Suggested prompts">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-ink-muted" /> Try asking
      </p>
      <div className="flex flex-wrap gap-1.5">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-full border border-border/60 bg-surface-sunken px-3 py-1.5 text-left text-xs font-medium text-ink-secondary transition-all hover:border-border-strong hover:bg-surface-elevated hover:text-ink"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
