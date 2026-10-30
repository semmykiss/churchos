"use client";

import { Sparkles } from "lucide-react";

/** Role-aware suggested prompts shown when the conversation is empty. */
export default function SuggestedPrompts({ prompts, onPick }: { prompts: string[]; onPick: (p: string) => void }) {
  if (!prompts.length) return null;
  return (
    <div className="space-y-2" aria-label="Suggested prompts">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" /> Try asking
      </p>
      <div className="flex flex-wrap gap-1.5">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-full border bg-gradient-to-r from-violet-500/5 via-fuchsia-500/5 to-amber-400/10 px-3 py-1.5 text-left text-xs font-medium text-foreground/80 transition-all hover:border-fuchsia-300 hover:from-violet-500/15 hover:via-fuchsia-500/15 hover:to-amber-400/20 hover:text-foreground"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
