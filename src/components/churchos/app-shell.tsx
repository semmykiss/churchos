'use client'

import { createElement, useEffect, useState } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { visibleModules, type Module } from '@/lib/permissions'
import { NAV_ITEMS } from '@/lib/nav'
import { getModuleComponent } from './module-registry'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  Church, Search, Sun, Moon, LogOut, Menu, User as UserIcon,
  ChevronRight, Settings as SettingsIcon, ShieldCheck,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { initials, titleCase as tc } from '@/lib/format'
import { cn } from '@/lib/utils'
import { NotificationsBell } from './notifications-bell'
import { ThemePicker } from './theme-picker'
import { AiAssistant } from './ai-assistant'
import { CommandPalette } from './command-palette'

function roleBadgeClass(role: string): string {
  switch (role) {
    case 'super_admin': return 'bg-rose-500/15 text-rose-400 border-rose-500/20'
    case 'church_admin': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
    case 'pastor': return 'bg-teal-500/15 text-teal-400 border-teal-500/20'
    case 'finance_officer': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
    case 'department_head': return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
    default: return 'bg-white/5 text-white/60 border-white/10'
  }
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, activeModule, setModule, organization, permissions } = useAuth()
  if (!user) return null
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
      <div className="flex items-center gap-3 h-14 border-b border-sidebar-border shrink-0 px-3.5">
        <div className="size-8 rounded-lg bg-gradient-to-br from-emerald-400/20 to-teal-500/10 ring-1 ring-emerald-400/20 grid place-items-center shrink-0">
          <Church className="size-4 text-emerald-400" />
        </div>
        <div className="nav-label min-w-0">
          <p className="font-semibold leading-none text-sm text-white">ChurchOS</p>
          <p className="text-[10px] text-white/40 truncate mt-1">{organization?.name ?? 'Church'}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll py-3 px-2 space-y-4">
        {groups.map((group) =>
          group.items.length === 0 ? null : (
            <div key={group.label}>
              <p className="nav-group-label px-3 text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((modId) => {
                  const item = NAV_ITEMS.find((n) => n.id === modId)!
                  const Icon = item.icon
                  const active = activeModule === modId
                  return (
                    <button
                      key={modId}
                      onClick={() => { setModule(modId); onNavigate?.() }}
                      title={item.label}
                      aria-label={item.label}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative w-full flex items-center gap-3 rounded-lg text-sm transition-colors text-left',
                        'px-3 py-2',
                        active
                          ? 'aurora-nav-active font-medium'
                          : 'text-white/55 hover:bg-white/[0.04] hover:text-white/90',
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="nav-label truncate">{item.label}</span>
                      {active && <ChevronRight className="nav-label size-3.5 ml-auto" aria-hidden="true" />}
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
        <div className="rounded-lg bg-white/[0.03] flex items-center gap-2.5 px-2.5 py-2">
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="bg-emerald-500/15 text-emerald-300 text-[11px] font-semibold">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="nav-label min-w-0 flex-1">
            <p className="text-xs font-medium truncate text-white/90">{user.name}</p>
            <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 h-3.5 mt-0.5', roleBadgeClass(user.role))}>
              {tc(user.role)}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  )
}

function TopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { user, organization, logout, setModule, canClient } = useAuth()
  const { theme, setTheme } = useTheme()
  const [cmdOpen, setCmdOpen] = useState(false)

  if (!user) return null

  return (
    <header className="h-14 glass-topbar sticky top-0 z-30">
      <div className="h-full flex items-center gap-2 px-3 lg:px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenSidebar} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>

        <div className="hidden md:block min-w-0">
          <Breadcrumbs />
        </div>

        {/* Command palette trigger (replaces inline search) */}
        <button
          onClick={() => setCmdOpen(true)}
          className="flex-1 max-w-sm mx-auto flex items-center gap-2 rounded-lg glass-subtle px-3 h-9 text-sm text-muted-foreground hover:text-foreground transition-colors focus-ring"
          aria-label="Open command palette"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <kbd className="kbd hidden sm:inline-flex">⌘K</kbd>
        </button>

        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <ThemePicker mode="app" />
          <NotificationsBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:bg-white/[0.05] transition-colors focus-ring" aria-label="User menu">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-emerald-500/15 text-emerald-300 text-[11px] font-semibold">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden lg:block text-left">
                  <p className="text-xs font-medium leading-none">{user.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{tc(user.role)}</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 glass-strong">
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
      <CommandPalette />
    </header>
  )
}

function Breadcrumbs() {
  const { activeModule } = useAuth()
  const item = NAV_ITEMS.find((n) => n.id === activeModule)
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground/50">ChurchOS</span>
      <ChevronRight className="size-3.5 text-muted-foreground/30" aria-hidden="true" />
      <span className="font-medium text-foreground">{item?.label ?? tc(activeModule)}</span>
    </div>
  )
}

export function AppShell() {
  const { loading, user, setModule, openDetail } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!user) loadSession()
  }, [user])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.module) return
      setModule(detail.module)
      if (detail.refId) {
        openDetail(detail.module, detail.refId, detail.action)
      }
    }
    window.addEventListener('churchos:navigate', handler)
    return () => window.removeEventListener('churchos:navigate', handler)
  }, [setModule, openDetail])

  if (loading || !user) {
    return (
      <div className="aurora-root dark min-h-screen grid place-items-center aurora-bg">
        <div className="relative z-10 flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-12 rounded-xl bg-emerald-500/15 text-emerald-400 grid place-items-center ring-1 ring-emerald-500/20">
            <Church className="size-6 animate-pulse" />
          </div>
          <p className="text-sm">Loading ChurchOS…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="aurora-root dark min-h-screen flex bg-background">
      {/* Desktop icon-rail sidebar (56px → 240px on hover) */}
      <aside className="icon-rail hidden lg:flex shrink-0 border-r border-sidebar-border fixed inset-y-0 left-0 z-40">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0 [&>button]:hidden glass-strong">
          <SidebarContent onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0 lg:pl-[56px]">
        <TopBar onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto aurora-fade-up">
          <ModuleRenderer />
        </main>
        <footer className="glass-topbar border-t border-white/5 py-4 px-6 mt-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>ChurchOS — Secure church operations platform. Demo data · Africa/Lagos · NGN.</p>
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" /> Role-based access enforced server-side
            </p>
          </div>
        </footer>
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
