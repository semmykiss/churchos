'use client'

import { createElement, useEffect, useState } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { can, visibleModules, type Module } from '@/lib/permissions'
import { NAV_ITEMS } from '@/lib/nav'
import { getModuleComponent } from './module-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Church, Search, Sun, Moon, LogOut, Menu, Bell, User as UserIcon,
  ChevronRight, Settings as SettingsIcon, ShieldCheck,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { initials, titleCase as tc } from '@/lib/format'

function roleBadgeClass(role: string): string {
  switch (role) {
    case 'super_admin': return 'bg-destructive/10 text-destructive border-destructive/20'
    case 'church_admin': return 'bg-primary/10 text-primary border-primary/20'
    case 'pastor': return 'bg-chart-2/10 text-chart-2 border-chart-2/20'
    case 'finance_officer': return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
    case 'department_head': return 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, activeModule, setModule, organization } = useAuth()
  if (!user) return null
  const visible = visibleModules(user.role).filter((m) => NAV_ITEMS.some((n) => n.id === m))
  const groups: { label: string; items: typeof visible }[] = [
    { label: 'Overview', items: visible.filter((m) => m === 'dashboard' || m === 'search' || m === 'reports') },
    { label: 'People', items: visible.filter((m) => ['members', 'departments', 'visitors', 'pastoral'].includes(m)) },
    { label: 'Ministry', items: visible.filter((m) => ['attendance', 'events', 'announcements', 'tasks'].includes(m)) },
    { label: 'Operations', items: visible.filter((m) => ['finance', 'assets', 'documents', 'audit', 'access', 'settings'].includes(m)) },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 h-16 border-b border-sidebar-border shrink-0">
        <div className="size-9 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center shadow-sm">
          <Church className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-none text-sm">ChurchOS</p>
          <p className="text-[11px] text-muted-foreground truncate mt-1">{organization?.name ?? 'Church'}</p>
        </div>
      </div>

      <ScrollArea className="flex-1 scroll-thin">
        <nav className="px-3 py-4 space-y-5">
          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.label}>
                <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map((modId) => {
                    const item = NAV_ITEMS.find((n) => n.id === modId)!
                    const Icon = item.icon
                    const active = activeModule === modId
                    return (
                      <button
                        key={modId}
                        onClick={() => { setModule(modId); onNavigate?.() }}
                        className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left ${
                          active ? 'nav-item-active font-medium' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                        }`}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {active && <ChevronRight className="size-3.5 ml-auto" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ),
          )}
        </nav>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-3 shrink-0">
        <div className="rounded-lg bg-sidebar-accent/40 px-3 py-2.5 flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{user.name}</p>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${roleBadgeClass(user.role)}`}>
              {tc(user.role)}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  )
}

function TopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { user, organization, logout, setModule } = useAuth()
  const { theme, setTheme } = useTheme()
  const [q, setQ] = useState('')

  if (!user) return null

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (q.trim()) setModule('search')
  }

  return (
    <header className="h-16 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="h-full flex items-center gap-3 px-4 lg:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenSidebar} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>

        <div className="hidden md:block">
          <p className="text-sm text-muted-foreground">
            {organization?.name}
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-md mx-auto relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search members, events, donations…"
            className="pl-9 bg-muted/40 border-transparent focus-visible:border-border focus-visible:bg-background"
          />
        </form>

        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
            <Bell className="size-4.5" />
            <span className="absolute top-2 right-2 size-1.5 rounded-full bg-chart-2" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:bg-accent/60 transition-colors">
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
              {can(user.role, 'settings', 'view') && (
                <DropdownMenuItem onClick={() => setModule('settings')}>
                  <SettingsIcon className="size-4 mr-2" /> Settings
                </DropdownMenuItem>
              )}
              {can(user.role, 'audit', 'view') && (
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
      <span className="text-muted-foreground">ChurchOS</span>
      <ChevronRight className="size-3.5 text-muted-foreground/50" />
      <span className="font-medium">{item?.label ?? titleCase(activeModule)}</span>
    </div>
  )
}

export function AppShell() {
  const { loading, user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!user) loadSession()
  }, [user])

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Church className="size-5 text-primary animate-pulse" />
          <span>Loading ChurchOS…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-sidebar-border bg-sidebar flex-col fixed inset-y-0 left-0 z-40">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SidebarContent onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <TopBar onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 lg:p-6">
          <div className="mb-5">
            <Breadcrumbs />
          </div>
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
      </div>
    </div>
  )
}

function ModuleRenderer() {
  const { activeModule } = useAuth()
  const Comp = getModuleComponent(activeModule)
  return createElement(Comp)
}
