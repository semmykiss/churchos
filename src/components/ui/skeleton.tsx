import { cn } from "@/lib/utils"

/**
 * Shimmer skeleton (spec §3) — shaped like the loading content by callers,
 * with a soft moving highlight instead of a flat pulse.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
