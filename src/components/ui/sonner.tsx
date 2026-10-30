"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"
import { useTheme } from "@/components/app/theme/theme"

/**
 * Sonner toaster — themed via the ChurchOS design tokens: elevated surface,
 * soft layered shadow, and a status-colored left accent bar (success /
 * error / warning / info). Stacked top-right per the design spec.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme()

  return (
    <Sonner
      theme={resolved === "midnight" || resolved === "contrast" ? "dark" : "light"}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--surface-elevated)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "!rounded-xl !border !shadow-lg !bg-[var(--surface-elevated)] !text-[var(--popover-foreground)] !border-[var(--border)] !border-l-[3px] " +
            "data-[type=success]:!border-l-success data-[type=error]:!border-l-destructive " +
            "data-[type=warning]:!border-l-warning data-[type=info]:!border-l-info",
          description: "!text-[var(--text-secondary)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
