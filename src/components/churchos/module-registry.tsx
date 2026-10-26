'use client'

import dynamic from 'next/dynamic'
import type { Module } from '@/lib/permissions'
import { Loader2 } from 'lucide-react'

const Loading = () => (
  <div className="flex items-center justify-center py-20 text-muted-foreground">
    <Loader2 className="size-5 animate-spin mr-2" /> Loading module…
  </div>
)

// Static map of module id → lazily-loaded component.
// Each module lives in its own file so multiple agents can edit in parallel without conflicts.
// Partial because not every Module has a real view yet (followups, ai) —
// getModuleComponent falls back to a Placeholder for missing entries.
const loaders: Partial<Record<Module, () => Promise<{ default: React.ComponentType }>>> = {
  dashboard: () => import('@/components/churchos/modules/dashboard'),
  members: () => import('@/components/churchos/modules/members'),
  departments: () => import('@/components/churchos/modules/departments'),
  attendance: () => import('@/components/churchos/modules/attendance'),
  visitors: () => import('@/components/churchos/modules/visitors'),
  events: () => import('@/components/churchos/modules/events'),
  finance: () => import('@/components/churchos/modules/finance'),
  announcements: () => import('@/components/churchos/modules/announcements'),
  pastoral: () => import('@/components/churchos/modules/pastoral'),
  tasks: () => import('@/components/churchos/modules/tasks'),
  assets: () => import('@/components/churchos/modules/assets'),
  documents: () => import('@/components/churchos/modules/documents'),
  reports: () => import('@/components/churchos/modules/reports'),
  audit: () => import('@/components/churchos/modules/audit'),
  access: () => import('@/components/churchos/modules/access'),
  settings: () => import('@/components/churchos/modules/settings'),
  search: () => import('@/components/churchos/modules/search'),
  celebrations: () => import('@/components/churchos/modules/celebrations'),
  townhall: () => import('@/components/churchos/modules/townhall'),
}

// Build the registry once at module load (NOT during render) to satisfy react-hooks/static-components.
const components: Partial<Record<Module, React.ComponentType>> = {}
for (const key of Object.keys(loaders) as Module[]) {
  const loader = loaders[key]
  if (loader) components[key] = dynamic(loader, { loading: Loading, ssr: false })
}

export function getModuleComponent(mod: Module): React.ComponentType {
  return components[mod] ?? Placeholder
}

function Placeholder() {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-12 text-center">
      <p className="text-muted-foreground text-sm">This module is being prepared.</p>
    </div>
  )
}
