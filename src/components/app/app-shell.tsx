"use client";

/**
 * App shell — premium SaaS layout (spec §4):
 * collapsible grouped sidebar, top bar with ⌘K search trigger / notification
 * bell / theme-aware user menu, role-aware command palette, page transitions,
 * and the sticky footer contract (mt-auto).
 */
import { useState, useEffect, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/types";
import { canDo } from "@/lib/types";
import { GROUP_LABELS, modulesFor, type ModuleDef } from "@/components/app/module-registry";
import NotificationBell from "@/components/app/notifications/notification-bell";
import { useCommandPalette } from "@/components/app/command-palette";
import { ThemeSwitcher } from "@/components/app/theme/theme-switcher";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/app/shared";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Church, LogOut, Menu, MapPin, Sparkles, Search, PanelLeftClose, PanelLeftOpen,
  Settings, UserRound,
} from "lucide-react";

interface ShellProps {
  user: SessionUser;
  active: string;
  onNavigate: (key: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const SIDEBAR_KEY = "churchos-sidebar-collapsed";

/* localStorage-backed collapsed state via useSyncExternalStore — SSR-safe,
   hydration-safe, no setState-in-effect. */
let sidebarListeners: Array<() => void> = [];
function subscribeSidebar(cb: () => void) {
  sidebarListeners.push(cb);
  window.addEventListener("storage", cb);
  return () => {
    sidebarListeners = sidebarListeners.filter((l) => l !== cb);
    window.removeEventListener("storage", cb);
  };
}
function getSidebarCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { return false; }
}
function getServerSidebarCollapsed(): boolean {
  return false;
}
function setSidebarCollapsed(v: boolean) {
  try { localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  for (const l of sidebarListeners) l();
}

export default function AppShell({ user, active, onNavigate, onLogout, children }: ShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarCollapsed, getServerSidebarCollapsed);
  const reduce = useReducedMotion();
  const mods = modulesFor(user);
  const current: ModuleDef | undefined = mods.find((m) => m.key === active) ?? mods[0];
  const groups: ModuleDef["group"][] = ["overview", "ministry", "finance", "system"];
  const { openPalette, palette } = useCommandPalette(user, onNavigate, onLogout);

  function toggleCollapsed() {
    setSidebarCollapsed(!collapsed);
  }

  // cross-module navigation requests (e.g. a notification click) hop through here
  useEffect(() => {
    const onNav = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (typeof key === "string" && mods.some((m) => m.key === key)) onNavigate(key);
    };
    window.addEventListener("chms:navigate", onNav);
    return () => window.removeEventListener("chms:navigate", onNav);
  }, [mods, onNavigate]);

  const NavList = (
    <nav aria-label="Main navigation" className="flex-1 space-y-4 overflow-y-auto px-3 py-4 scroll-slim">
      {groups.map((g) => {
        const items = mods.filter((m) => m.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            {!collapsed ? (
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/45">
                {GROUP_LABELS[g]}
              </p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" aria-hidden />
            )}
            <ul className="space-y-0.5">
              {items.map((m) => {
                const Icon = m.icon;
                const isActive = m.key === current?.key;
                return (
                  <li key={m.key}>
                    <button
                      onClick={() => { onNavigate(m.key); setNavOpen(false); }}
                      aria-current={isActive ? "page" : undefined}
                      title={collapsed ? m.label : undefined}
                      className={cn(
                        "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150",
                        collapsed && "justify-center px-0",
                        isActive
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                      )}
                    >
                      {isActive ? (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary" aria-hidden />
                      ) : null}
                      <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-sidebar-primary")} aria-hidden />
                      {!collapsed ? <span className="truncate">{m.label}</span> : <span className="sr-only">{m.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* Ask Shepherd — additive AI-assistant entry: opens the floating panel
          (the launcher component decides visibility via the church toggle). */}
      <div className="border-t border-sidebar-border pt-3">
        <button
          onClick={() => { window.dispatchEvent(new CustomEvent("chms:ai:open")); setNavOpen(false); }}
          title={collapsed ? "Ask Shepherd" : undefined}
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-0"
          )}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-400">
            <Sparkles className="h-2.5 w-2.5 text-white" aria-hidden />
          </span>
          {!collapsed ? <span>Ask Shepherd</span> : <span className="sr-only">Ask Shepherd</span>}
        </button>
      </div>
    </nav>
  );

  const Brand = (
    <div className={cn("flex items-center border-b border-sidebar-border px-4 py-4", collapsed ? "justify-center px-0" : "gap-2.5")}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary/12">
        <Church className="h-4.5 w-4.5 text-sidebar-primary" aria-hidden />
      </div>
      {!collapsed ? (
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold tracking-[-0.01em] text-sidebar-foreground">{user.orgName}</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-sidebar-foreground/55">
            <MapPin className="h-3 w-3" aria-hidden /> {user.campusName ?? "Main campus"}
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {palette}

      {/* Topbar */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 no-print">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
          {/* Mobile nav */}
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
              <SheetHeader className="border-b border-sidebar-border p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
              </SheetHeader>
              {Brand}
              {NavList}
            </SheetContent>
          </Sheet>

          {/* Desktop: collapse toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            className="hidden lg:inline-flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" aria-hidden /> : <PanelLeftClose className="h-4.5 w-4.5" aria-hidden />}
          </Button>

          {/* Global search / command palette trigger */}
          <button
            type="button"
            onClick={openPalette}
            className="hidden h-9 w-52 items-center gap-2 rounded-md border bg-surface-sunken px-3 text-sm text-ink-muted shadow-xs transition-colors hover:bg-surface hover:text-ink-secondary sm:flex lg:w-72"
            aria-label="Open command palette (Ctrl+K)"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-muted">
              ⌘K
            </kbd>
          </button>
          <Button variant="ghost" size="icon" onClick={openPalette} className="sm:hidden" aria-label="Search (Ctrl+K)">
            <Search className="h-4.5 w-4.5" aria-hidden />
          </Button>

          <h2 className="ml-2 hidden font-display text-sm font-semibold tracking-[-0.01em] text-ink xl:block">
            {current?.label}
          </h2>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                  <PersonAvatar name={user.name} className="h-8 w-8 text-[11px]" />
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-40 truncate text-sm font-medium leading-tight text-ink">{user.name}</span>
                    <span className="block max-w-40 truncate text-[11px] leading-tight text-ink-muted">{user.roleNames.join(", ")}</span>
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium text-ink">{user.name}</p>
                  <p className="truncate text-xs font-normal text-ink-muted">{user.email}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {user.roleNames.map((r) => (
                      <span key={r} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {r}
                      </span>
                    ))}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-1 pb-1">
                  <ThemeSwitcher />
                </div>
                <DropdownMenuSeparator />
                {canDo(user, "admin.view") ? (
                  <DropdownMenuItem onClick={() => onNavigate("admin")}>
                    <Settings className="h-4 w-4" aria-hidden /> Administration
                  </DropdownMenuItem>
                ) : null}
                {canDo(user, "portal.use") ? (
                  <DropdownMenuItem onClick={() => onNavigate("portal")}>
                    <UserRound className="h-4 w-4" aria-hidden /> My Portal
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout} className="text-danger focus:text-danger">
                  <LogOut className="h-4 w-4" aria-hidden /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-in-out lg:flex no-print",
            collapsed ? "w-[68px]" : "w-60"
          )}
        >
          {Brand}
          {NavList}
        </aside>

        {/* Module content — page transition: fade + 8px slide (fade-only under reduced motion) */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0.12 : 0.16, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </div>
        </main>
      </div>

      {/* Sticky footer (mt-auto pins it to the bottom on short pages) */}
      <footer className="mt-auto border-t bg-surface-sunken/50 no-print">
        <div className="flex flex-col items-center justify-between gap-1.5 px-4 py-3 text-[11px] text-ink-muted sm:flex-row sm:px-6">
          <p>Grace ChMS · local build · data stored on this machine (SQLite)</p>
          <p>Signed in as {user.name} — {user.roleNames.join(", ")}</p>
        </div>
      </footer>
    </div>
  );
}
