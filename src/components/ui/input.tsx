import * as React from "react"

import { cn } from "@/lib/utils"
import { AlertCircle } from "lucide-react"

/**
 * Premium input (spec §3): sunken surface, 1px border, focus = 3px ring glow.
 * Optional additive `error` prop renders the red border + icon + helper text
 * below (existing call sites are unaffected — the prop is new and optional).
 */
function Input({ className, type, error, ...props }: React.ComponentProps<"input"> & { error?: string }) {
  const field = (
    <input
      type={type}
      data-slot="input"
      aria-invalid={props["aria-invalid"] ?? (error ? true : undefined)}
      className={cn(
        "placeholder:text-ink-muted selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-surface-sunken px-3 py-1 text-base shadow-xs transition-[color,border-color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:bg-surface focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/20",
        className
      )}
      {...props}
    />
  )
  if (!error) return field
  return (
    <>
      {field}
      <p className="flex items-center gap-1 text-xs text-danger" role="alert">
        <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
        {error}
      </p>
    </>
  )
}

export { Input }
