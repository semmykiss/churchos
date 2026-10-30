"use client";

/**
 * ThemeSwitcher — 4 circular swatch previews + a "System" option.
 * Instant apply (no reload), keyboard operable, aria-labelled.
 * Used in the top-bar user menu and as a mini control on the login screen
 * (pass `variant="compact"` there).
 */
import { Check, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES, useTheme, type StoredTheme } from "./theme";

export function ThemeSwitcher({ className, variant = "menu" }: { className?: string; variant?: "menu" | "compact" }) {
  const { stored, resolved, setTheme } = useTheme();

  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-1.5", className)} role="radiogroup" aria-label="Color theme">
        {THEMES.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={resolved === t.key}
            aria-label={`${t.label} theme`}
            title={`${t.label} — ${t.hint}`}
            onClick={() => setTheme(t.key)}
            className={cn(
              "relative h-6 w-6 overflow-hidden rounded-full border transition-transform",
              resolved === t.key
                ? "border-ring ring-2 ring-ring/40 scale-110"
                : "border-border-strong/60 hover:scale-110",
            )}
          >
            <span className="absolute inset-0" style={{ background: t.swatch[0] }} />
            <span className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: t.swatch[1] }} />
            <span
              className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/10"
              style={{ background: t.swatch[2] }}
            />
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={stored === "system"}
          aria-label="Match system theme"
          title="Match system"
          onClick={() => setTheme("system")}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full border transition-transform hover:scale-110",
            stored === "system" ? "border-ring bg-accent text-accent-foreground ring-2 ring-ring/40 scale-110" : "border-border-strong/60 text-ink-secondary",
          )}
        >
          <Monitor className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)} role="radiogroup" aria-label="Color theme">
      <p className="px-2 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">Theme</p>
      {THEMES.map((t) => (
        <button
          key={t.key}
          type="button"
          role="radio"
          aria-checked={stored === t.key}
          onClick={() => setTheme(t.key)}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <span
            className="relative flex h-4.5 w-4.5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 dark:border-white/20"
            style={{ background: t.swatch[0] }}
            aria-hidden
          >
            <span className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: t.swatch[1] }} />
            <span className="absolute h-2 w-2 rounded-full" style={{ background: t.swatch[2] }} />
          </span>
          <span className="flex-1 text-left">
            <span className="block leading-tight text-ink">{t.label}</span>
            <span className="block text-[11px] leading-tight text-ink-muted">{t.hint}</span>
          </span>
          {stored === t.key ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={stored === "system"}
        onClick={() => setTheme("system" as StoredTheme)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-border-strong/60 text-ink-secondary" aria-hidden>
          <Monitor className="h-2.5 w-2.5" />
        </span>
        <span className="flex-1 text-left leading-tight text-ink">Match system</span>
        {stored === "system" ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
      </button>
    </div>
  );
}
