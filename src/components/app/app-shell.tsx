"use client";

/**
 * App shell — TaskFlow layout (2026 reference style, adopted app-wide):
 * a floating white rounded sidebar (brand block, grouped nav, assistant card
 * in the promo slot) and a floating white rounded header bar (module title +
 * campus subtitle, pill search, circular bell, user chip with name + email)
 * both float on the soft gray canvas; content runs the full width of the
 * column (no center squeeze). Mobile swaps the sidebar for a labeled Sheet.
 * Keeps the ⌘K command palette, role-aware nav, notification bell, theme
 * switcher, page transitions, and the sticky-footer contract (mt-auto).
 */
import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { moduleLevel, type SessionUser } from "@/lib/types";
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
  Church, LogOut, Menu, MapPin, Sparkles, Search, Settings, UserRound, ChevronDown,
} from "lucide-react";

interface ShellProps {
  user: SessionUser;
  active: string;
  onNavigate: (key: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export default function AppShell({ user, active, onNavigate, onLogout, children }: ShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const reduce = useReducedMotion();
  const mods = modulesFor(user);
  const current: ModuleDef | undefined = mods.find((m) => m.key === active) ?? mods[0];
  const groups: ModuleDef["group"][] = ["overview", "ministry", "finance", "system"];
  const { openPalette, palette } = useCommandPalette(user, onNavigate, onLogout);

  // cross-module navigation requests (e.g. a notification click) hop through here
  useEffect(() => {
    const onNav = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (typeof key === "string" && mods.some((m) => m.key === key)) onNavigate(key);
    };
    window.addEventListener("chms:navigate", onNav);
    return () => window.removeEventListener("chms:navigate", onNav);
  }, [mods, onNavigate]);

  /* Shared nav items (desktop rail + mobile sheet) — JSX render fn, not a component */
  function renderNavItems(onPicked?: () => void) {
    return (
      <>
        {groups.map((g) => {
          const items = mods.filter((m) => m.group === g);
          if (!items.length) return null;
          return (
            <div key={g} className="flex flex-col gap-0.5">
              <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted/80">
                {GROUP_LABELS[g]}
              </p>
              {items.map((m) => {
                const Icon = m.icon;
                const isActive = m.key === current?.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => { onNavigate(m.key); onPicked?.(); }}
                    aria-current={isActive ? "page" : undefined}
                    title={m.label}
                    className={cn(
                      "flex h-10 w-full shrink-0 items-center gap-3 rounded-xl px-3 text-sm transition-all duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      isActive
                        ? "bg-primary font-medium text-primary-foreground shadow-sm"
                        : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}

        {/* Ask Shepherd — additive AI-assistant entry (launcher decides visibility) */}
        {moduleLevel(user, "ai") >= 1 ? (
          <div className="mt-3 border-t border-border/60 pt-3">
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent("chms:ai:open")); onPicked?.(); }}
              className="flex h-10 w-full shrink-0 items-center gap-3 rounded-xl px-3 text-sm text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary">
                <Sparkles className="h-2.5 w-2.5 text-primary-foreground" aria-hidden />
              </span>
              <span className="truncate">Ask Shepherd</span>
            </button>
          </div>
        ) : null}
      </>
    );
  }

  /* Brand block (sidebar top / sheet top / header on mobile) — JSX render fn */
  function renderBrand(compact?: boolean) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Church className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-sm font-bold tracking-[-0.01em] text-ink">Grace ChMS</p>
          {!compact ? (
            <p className="flex items-center gap-1 truncate text-[11px] text-ink-muted">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden /> {user.orgName} — {user.campusName ?? "Main campus"}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  /* ── Mobile sheet nav ──────────────────────────────────────────────────── */
  const mobileNav = (
    <Sheet open={navOpen} onOpenChange={setNavOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full bg-surface-sunken hover:bg-surface-sunken lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-surface p-0 text-sidebar-foreground">
        <SheetHeader className="border-b border-sidebar-border p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
        </SheetHeader>
        <div className="flex h-full flex-col">
          <div className="px-4 py-4">
            {renderBrand()}
          </div>
          <nav aria-label="Main navigation" className="flex-1 overflow-y-auto scroll-slim px-3 pb-4">
            {renderNavItems(() => setNavOpen(false))}
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {palette}

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col p-3 sm:p-4">
        <div className="flex flex-1 gap-3 sm:gap-4">

          {/* ── Desktop sidebar — floating white rounded panel ─────────────── */}
          <aside className="sticky top-4 z-30 hidden h-[calc(100dvh-2rem)] w-60 shrink-0 flex-col rounded-2xl border border-border/60 bg-surface shadow-sm lg:flex no-print">
            <div className="px-4 pb-2 pt-4">
              {renderBrand()}
            </div>

            <nav aria-label="Main navigation" className="flex-1 overflow-y-auto scroll-slim px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {renderNavItems()}
            </nav>

            {/* Assistant promo card — the sidebar's bottom slot */}
            {moduleLevel(user, "ai") >= 1 ? (
              <div className="px-3 pb-3">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("chms:ai:open"))}
                  aria-label="Ask Shepherd — AI assistant"
                  className="flex w-full items-center gap-3 rounded-xl bg-primary/8 p-3 text-left transition-colors hover:bg-primary/12 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                    <Sparkles className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-sm font-semibold text-ink">Ask Shepherd</span>
                    <span className="block truncate text-[11px] text-ink-muted">Your AI church assistant</span>
                  </span>
                </button>
              </div>
            ) : null}
          </aside>

          {/* ── Right column: header · content · footer ────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">

            {/* Sticky scrim wrapper — opaque canvas strip so scrolled content never
                peeks through the gap above the floating rounded header */}
            <div className="sticky top-0 z-40 -mt-3 bg-background pb-1 pt-3 no-print sm:-mt-4 sm:pt-4">
              <header className="flex h-16 shrink-0 items-center gap-2 rounded-2xl border border-border/60 bg-surface px-3 shadow-sm sm:px-4">
              {mobileNav}

              {/* Mobile brand (sidebar is hidden) */}
              <button
                type="button"
                onClick={() => mods[0] && onNavigate(mods[0].key)}
                className="flex items-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 rounded-xl lg:hidden"
                aria-label="Go to home module"
              >
                {renderBrand(true)}
              </button>

              {/* Desktop: module title + nav-group subtitle (TaskFlow header text) */}
              <div className="hidden min-w-0 leading-tight lg:block">
                <p className="truncate font-display text-[15px] font-bold tracking-[-0.01em] text-ink">
                  {current?.label}
                </p>
                <p className="truncate text-[11px] text-ink-muted">
                  {current ? GROUP_LABELS[current.group] : ""}
                </p>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* Global search / command palette trigger */}
                <button
                  type="button"
                  onClick={openPalette}
                  className="hidden h-10 w-56 items-center gap-2 rounded-full bg-surface-sunken px-4 text-sm text-ink-muted transition-colors hover:bg-surface-sunken/70 lg:flex xl:w-80"
                  aria-label="Open command palette (Ctrl+K)"
                >
                  <Search className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="flex-1 text-left">Search here…</span>
                  <kbd className="rounded-full bg-surface px-2 py-0.5 font-mono text-[10px] font-medium text-ink-muted shadow-sm">
                    ⌘K
                  </kbd>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openPalette}
                  className="h-10 w-10 rounded-full bg-surface-sunken hover:bg-surface-sunken lg:hidden"
                  aria-label="Search (Ctrl+K)"
                >
                  <Search className="h-4.5 w-4.5" aria-hidden />
                </Button>

                <NotificationBell className="h-10 w-10 rounded-full bg-surface-sunken hover:bg-surface-sunken hover:shadow-md" />

                {/* User chip — avatar + name + email (TaskFlow profile chip) */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-10 gap-2.5 rounded-full bg-surface-sunken pl-1.5 pr-2 hover:bg-surface-sunken hover:shadow-md"
                      aria-label="Account menu"
                    >
                      <PersonAvatar name={user.name} className="h-8 w-8 text-[11px]" />
                      <span className="hidden text-left leading-tight sm:block">
                        <span className="block max-w-36 truncate text-sm font-semibold text-ink">{user.name}</span>
                        <span className="block max-w-40 truncate text-[10px] text-ink-muted">{user.email}</span>
                      </span>
                      <ChevronDown className="hidden h-3.5 w-3.5 text-ink-muted sm:block" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 rounded-2xl">
                    <DropdownMenuLabel>
                      <p className="text-sm font-medium text-ink">{user.name}</p>
                      <p className="truncate text-xs font-normal text-ink-muted">{user.email}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {user.roleNames.map((r) => (
                          <span key={r} className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-semibold text-ink-secondary">
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
                      <DropdownMenuItem onClick={() => onNavigate("admin")} className="rounded-xl">
                        <Settings className="h-4 w-4" aria-hidden /> Administration
                      </DropdownMenuItem>
                    ) : null}
                    {canDo(user, "portal.use") ? (
                      <DropdownMenuItem onClick={() => onNavigate("portal")} className="rounded-xl">
                        <UserRound className="h-4 w-4" aria-hidden /> My Portal
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onLogout} className="rounded-xl text-danger focus:text-danger">
                      <LogOut className="h-4 w-4" aria-hidden /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              </header>
            </div>

            {/* Module content — page transition: fade + 8px slide (fade-only under reduced motion) */}
            <main className="min-w-0 flex-1">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0.12 : 0.16, ease: "easeOut" }}
              >
                {children}
              </motion.div>
            </main>

            {/* Sticky footer (mt-auto pins it to the bottom on short pages) */}
            <footer className="mt-auto no-print">
              <div className="flex flex-col items-center justify-between gap-1.5 px-1 pb-1 pt-1.5 text-[11px] text-ink-muted sm:flex-row">
                <p>Grace ChMS · local build · data stored on this machine (SQLite)</p>
                <p>Signed in as {user.name} — {user.roleNames.join(", ")}</p>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
