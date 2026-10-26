'use client'

// ChurchOS — shared design-system primitives.
// Premium, consistent building blocks used across all modules so the whole
// app shares one visual identity (Linear/Stripe-inspired).

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'

/* ----------------------------------------------------------------
   PageHeader — consistent module title + actions
----------------------------------------------------------------- */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  eyebrow,
}: {
  title: string
  description?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <div className="size-10 shrink-0 rounded-xl bg-primary/10 text-primary grid place-items-center ring-1 ring-inset ring-primary/15">
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground truncate">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  )
}

/* ----------------------------------------------------------------
   StatCard — KPI tiles with trend slot
----------------------------------------------------------------- */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = 'primary',
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: 'primary' | 'indigo' | 'violet' | 'teal' | 'amber' | 'rose' | 'emerald'
  onClick?: () => void
}) {
  const accents: Record<string, string> = {
    // primary/emerald follow the active app theme via tokens; named hues
    // (indigo/violet/teal/amber/rose) are semantic accents with proper
    // light/dark contrast pairs.
    primary: 'bg-primary/10 text-primary',
    indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    emerald: 'bg-primary/10 text-primary',
  }
  return (
    <Card
      className={cn(
        'glass aurora-stat-card border-transparent',
        onClick && 'cursor-pointer',
      )}
      onClick={onClick}
      // Keyboard access for clickable stat cards (non-clickable cards stay plain divs).
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
            <p className="text-2xl font-semibold tracking-tight nums mt-1.5 aurora-glow">{value}</p>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <div className={cn('size-9 shrink-0 rounded-lg grid place-items-center ring-1 ring-inset ring-foreground/5', accents[accent])}>
            <Icon className="size-4.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ----------------------------------------------------------------
   EmptyState — consistent zero-data / zero-result view
----------------------------------------------------------------- */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="size-12 rounded-2xl bg-muted grid place-items-center mb-4 ring-1 ring-inset ring-border/60">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ----------------------------------------------------------------
   LoadingGrid / skeleton helpers
----------------------------------------------------------------- */
export function StatCardSkeleton() {
  return <Skeleton className="h-[112px] rounded-xl" />
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------
   SectionCard — titled content block
----------------------------------------------------------------- */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('border-border/60', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </Card>
  )
}

/* ----------------------------------------------------------------
   Badge-like status pill (semantic colors)
----------------------------------------------------------------- */
export function StatusPill({
  status,
  tone,
}: {
  status: string
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'
}) {
  const tones: Record<string, string> = {
    default: 'bg-muted text-muted-foreground border-border',
    success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
    info: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20',
    neutral: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20',
  }
  const cls = tones[tone ?? 'default']
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', cls)}>
      {status}
    </span>
  )
}

/* ----------------------------------------------------------------
   Toolbar — wraps filters + search consistently
----------------------------------------------------------------- */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center gap-2.5 flex-wrap', className)}>{children}</div>
  )
}

export { Button }
