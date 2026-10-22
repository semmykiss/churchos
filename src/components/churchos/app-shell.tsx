'use client'

import { createElement, useEffect, useState } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { visibleModules, type Module } from '@/lib/permissions'
import { NAV_ITEMS } from '@/lib/nav'
import { getModuleComponent } from './module-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Church, Search, Sun, Moon, LogOut, Menu, User as UserIcon,
  ChevronRight, Settings as SettingsIcon, ShieldCheck, PanelLeftClose, PanelLeft,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { initials, titleCase as tc } from '@/lib/format'
import { cn } from '@/lib/utils'
import { NotificationsBell } from './notifications-bell'
import { ThemePicker } from './theme-picker'
import { AiAssistant } from './ai-assistant'

function roleBadgeClass(role: string): string {
  switch (role) {
    case 'super_admin': return 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/20'
    case 'church_admin': return 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/20'
    case 'pastor': return 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/20'
    case 'finance_officer': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/20'
    case 'department_head': return 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/20'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

function SidebarContent({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const { user, activeModule, setModule, organization, permissions } = useAuth()
  if (!user) return null
  // Prefer the DB-driven permission snapshot (returned by /api/me). Fall back to the
  // code MATRIX via visibleModules(user.role) if the snapshot hasn't loaded yet.
  const permModules = permissions?.modules ?? null
  const visible = (permModules ?? visibleModules(user.role)).filter((m) =>
    NAV_ITEMS.some((n) => n.id === m),
  )
  const groups: { label: string; items: typeof visible }[] = [
    { label: 'Overview', items: visible.filter((m) => m === 'dashboard' || m === 'search' || m === 'reports') },
    { label: 'People', items: visible.filter((m) => ['members', 'departments', 'visitors', 'pastoral', 'celebrations'].includes(m)) },
    { label: 'Ministry', items: visible.filter((m) => ['attendance', 'events', 'announcements', 'tasks', 'townhall'].includes(m)) },
    { label: 'Operations', items: visible.filter((m) => ['finance', 'assets', 'documents', 'audit', 'access', 'settings'].includes(m)) },
  ]

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className={cn('flex items-center gap-3 h-16 border-b border-sidebar-border shrink-0', collapsed ? 'justify-center px-2' : 'px-4')}>
        <div className="size-9 rounded-lg bg-white/10 ring-1 ring-white/15 grid place-items-center shrink-0 shadow-sm">
          <Church className="size-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-semibold leading-none text-sm text-white">ChurchOS</p>
            <p className="text-[11px] text-white/50 truncate mt-1">{organization?.name ?? 'Church'}</p>
          </div>
        )}
      </div>

      {/* Nav — native scroll (overflow-y-auto) for long module lists. */}
      <nav className={cn('flex-1 overflow-y-auto sidebar-scroll py-4 space-y-5', collapsed ? 'px-2' : 'px-3')}>
        {groups.map((group) =>
          group.items.length === 0 ? null : (
            <div key={group.label}>
              {!collapsed && (
                <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-1.5">{group.label}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map((modId) => {
                  const item = NAV_ITEMS.find((n) => n.id === modId)!
                  const Icon = item.icon
                  const active = activeModule === modId
                  return (
                    <button
                      key={modId}
                      onClick={() => { setModule(modId); onNavigate?.() }}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'w-full flex items-center gap-2.5 rounded-lg text-sm transition-all text-left',
                        collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
                        active
                          ? 'nav-item-active font-medium'
                          : 'text-white/65 hover:bg-white/[0.06] hover:text-white',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && active && <ChevronRight className="size-3.5 ml-auto" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ),
        )}
      </nav>

      {/* User card */}
      <div className="border-t border-sidebar-border p-2 shrink-0">
        <div className={cn('rounded-lg bg-white/[0.04] flex items-center gap-2.5', collapsed ? 'justify-center p-2' : 'px-2.5 py-2')}>
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-indigo-500/20 text-indigo-200 text-xs font-semibold">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate text-white">{user.name}</p>
              <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4 mt-0.5', roleBadgeClass(user.role))}>
                {tc(user.role)}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TopBar({ onOpenSidebar, onToggleSidebar }: { onOpenSidebar: () => void; onToggleSidebar: () => void }) {
  const { user, organization, logout, setModule, canClient } = useAuth()
  const { theme, setTheme } = useTheme()
  const [q, setQ] = useState('')

  if (!user) return null

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (q.trim()) setModule('search')
  }

  return (
    <header className="h-16 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65 sticky top-0 z-30">
      <div className="h-full flex items-center gap-2 px-4 lg:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenSidebar} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={onToggleSidebar} aria-label="Toggle sidebar">
          <PanelLeft className="size-4.5" />
        </Button>

        <div className="hidden md:block min-w-0">
          <Breadcrumbs />
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-md mx-auto relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search members, events, donations…"
            className="pl-9 h-9 bg-muted/40 border-transparent focus-visible:border-border focus-visible:bg-background"
          />
          <kbd className="hidden md:inline-flex absolute right-2.5 top-1/2 -translate-y-1/2 items-center gap-0.5 rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground pointer-events-none">
            ⌘K
          </kbd>
        </form>

        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </Button>
          <ThemePicker mode="app" />
          <NotificationsBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:bg-accent/60 transition-colors focus-ring">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden lg:block text-left">
                  <p className="text-xs font-medium leading-none">{user.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{tc(user.role)}</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground font-normal truncate">{user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setModule('settings')}>
                <UserIcon className="size-4 mr-2" /> Profile & Account
              </DropdownMenuItem>
              {canClient('settings', 'view') && (
                <DropdownMenuItem onClick={() => setModule('settings')}>
                  <SettingsIcon className="size-4 mr-2" /> Settings
                </DropdownMenuItem>
              )}
              {canClient('audit', 'view') && (
                <DropdownMenuItem onClick={() => setModule('audit')}>
                  <ShieldCheck className="size-4 mr-2" /> Audit Log
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { logout(); toast.success('Signed out') }}>
                <LogOut className="size-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

function Breadcrumbs() {
  const { activeModule } = useAuth()
  const item = NAV_ITEMS.find((n) => n.id === activeModule)
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground/60">ChurchOS</span>
      <ChevronRight className="size-3.5 text-muted-foreground/40" />
      <span className="font-medium text-foreground">{item?.label ?? tc(activeModule)}</span>
    </div>
  )
}

export function AppShell() {
  const { loading, user, setModule } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!user) loadSession()
  }, [user])

  // Listen for notification navigation events from NotificationsBell
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.module) {
        setModule(detail.module)
      }
    }
    window.addEventListener('churchos:navigate', handler)
    return () => window.removeEventListener('churchos:navigate', handler)
  }, [setModule])

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-12 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-lg shadow-primary/20">
            <Church className="size-6 animate-pulse" />
          </div>
          <p className="text-sm">Loading ChurchOS…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar (collapsible) */}
      <aside className={cn('hidden lg:flex shrink-0 border-r border-sidebar-border fixed inset-y-0 left-0 z-40 transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-64')}>
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0 [&>button]:hidden">
          <SidebarContent onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className={cn('flex-1 flex flex-col min-w-0 transition-[padding] duration-200', collapsed ? 'lg:pl-[68px]' : 'lg:pl-64')}>
        <TopBar onOpenSidebar={() => setSidebarOpen(true)} onToggleSidebar={() => setCollapsed((v) => !v)} />
        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
          <ModuleRenderer />
        </main>
        <footer className="border-t border-border/60 py-4 px-6 mt-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>ChurchOS — Secure church operations platform. Demo data · Africa/Lagos · NGN.</p>
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" /> Role-based access enforced server-side
            </p>
          </div>
        </footer>
        {/* Floating AI assistant — gated internally by ai:view permission */}
        <AiAssistant />
      </div>
    </div>
  )
}

function ModuleRenderer() {
  const { activeModule } = useAuth()
  const Comp = getModuleComponent(activeModule)
  return createElement(Comp)
}
