"use client";

/**
 * App shell — "canvas & float" layout (2026 reference style):
 * a slim icon rail floats on the soft gray canvas (active module = ink-black
 * circle), the topbar is a floating row (brand mark, pill search, circular
 * actions, user chip), and every page renders white floating cards on the
 * canvas. Mobile swaps the rail for a labeled Sheet. Keeps the ⌘K command
 * palette, role-aware nav, notification bell, theme switcher, page
 * transitions, and the sticky-footer contract (mt-auto).
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

  /* ── Mobile sheet nav (labeled list, ink-pill active) ─────────────────── */
  const MobileNavList = (
    <nav aria-label="Main navigation" className="flex-1 space-y-4 overflow-y-auto px-3 py-4 scroll-slim">
      {groups.map((g) => {
        const items = mods.filter((m) => m.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/45">
              {GROUP_LABELS[g]}
            </p>
            <ul className="space-y-0.5">
              {items.map((m) => {
                const Icon = m.icon;
                const isActive = m.key === current?.key;
                return (
                  <li key={m.key}>
                    <button
                      onClick={() => { onNavigate(m.key); setNavOpen(false); }}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors duration-150",
                        isActive
                          ? "bg-primary font-medium text-primary-foreground shadow-sm"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{m.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* Ask Shepherd — additive AI-assistant entry (launcher decides visibility) */}
      {moduleLevel(user, "ai") >= 1 ? (
      <div className="border-t border-sidebar-border pt-3">
        <button
          onClick={() => { window.dispatchEvent(new CustomEvent("chms:ai:open")); setNavOpen(false); }}
          className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary">
            <Sparkles className="h-2.5 w-2.5 text-primary-foreground" aria-hidden />
          </span>
          <span>Ask Shepherd</span>
        </button>
      </div>
      ) : null}
    </nav>
  );

  const MobileBrand = (
    <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-primary text-primary-foreground shadow-sm">
        <Church className="h-4.5 w-4.5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-bold tracking-[-0.01em] text-sidebar-foreground">Grace ChMS</p>
        <p className="flex items-center gap-1 truncate text-[11px] text-sidebar-foreground/55">
          <MapPin className="h-3 w-3" aria-hidden /> {user.orgName} — {user.campusName ?? "Main campus"}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {palette}

      {/* ── Topbar: brand mark · pill search · circular actions — static opaque background ── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background no-print">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
          {/* Mobile nav */}
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 bg-surface shadow-sm hover:bg-surface lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-surface p-0 text-sidebar-foreground">
              <SheetHeader className="border-b border-sidebar-border p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
              </SheetHeader>
              {MobileBrand}
              {MobileNavList}
            </SheetContent>
          </Sheet>

          {/* Brand mark + wordmark */}
          <button
            type="button"
            onClick={() => mods[0] && onNavigate(mods[0].key)}
            className="flex items-center gap-2.5 rounded-2xl px-1 py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            aria-label="Go to home module"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-primary text-primary-foreground shadow-sm">
              <Church className="h-4.5 w-4.5" aria-hidden />
            </span>
            <span className="hidden leading-tight md:block">
              <span className="block font-display text-sm font-bold tracking-[-0.01em] text-ink">Grace ChMS</span>
              <span className="flex max-w-48 items-center gap-1 truncate text-[11px] text-ink-muted">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                {user.orgName} — {user.campusName ?? "Main campus"}
              </span>
            </span>
          </button>

          {/* Global search / command palette trigger — white pill */}
          <button
            type="button"
            onClick={openPalette}
            className="ml-2 hidden h-10 w-56 items-center gap-2 rounded-full border border-border/60 bg-surface px-4 text-sm text-ink-muted shadow-sm transition-shadow hover:shadow-md lg:flex xl:w-80"
            aria-label="Open command palette (Ctrl+K)"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded-full bg-surface-sunken px-2 py-0.5 font-mono text-[10px] font-medium text-ink-muted">
              ⌘K
            </kbd>
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={openPalette}
            className="h-10 w-10 bg-surface shadow-sm hover:bg-surface lg:hidden"
            aria-label="Search (Ctrl+K)"
          >
            <Search className="h-4.5 w-4.5" aria-hidden />
          </Button>

          {/* Current module name — desktop only, quiet */}
          <h2 className="ml-1 hidden font-display text-sm font-semibold tracking-[-0.01em] text-ink xl:block">
            {current?.label}
          </h2>

          <div className="ml-auto flex items-center gap-2">
            <NotificationBell className="h-10 w-10 bg-surface shadow-sm hover:bg-surface hover:shadow-md" />

            {/* User chip — white pill with avatar + name */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-10 gap-2 rounded-full bg-surface px-2 pr-3 shadow-sm hover:bg-surface hover:shadow-md"
                  aria-label="Account menu"
                >
                  <PersonAvatar name={user.name} className="h-7 w-7 text-[10px]" />
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-36 truncate text-sm font-semibold leading-tight text-ink">{user.name}</span>
                    <span className="block max-w-36 truncate text-[10px] leading-tight text-ink-muted">{user.roleNames[0]}</span>
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
        </div>
      </header>

      {/* ── Body: icon rail + content, both on the canvas ── */}
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 gap-3 px-3 sm:gap-4 sm:px-5">
        {/* Desktop rail — labeled module nav (ink-pill active). Height leaves
            room for header + footer so short pages don't scroll a stray 42px. */}
        <aside className="sticky top-16 z-30 hidden h-[calc(100dvh-6.625rem)] w-52 shrink-0 flex-col py-1 lg:flex no-print">
          <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-0.5 overflow-y-auto scroll-slim py-1 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {groups.map((g) => {
              const items = mods.filter((m) => m.group === g);
              if (!items.length) return null;
              return (
                <div key={g} className="flex flex-col gap-0.5">
                  <p className="px-3.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted/80">
                    {GROUP_LABELS[g]}
                  </p>
                  {items.map((m) => {
                    const Icon = m.icon;
                    const isActive = m.key === current?.key;
                    return (
                      <button
                        key={m.key}
                        onClick={() => onNavigate(m.key)}
                        aria-current={isActive ? "page" : undefined}
                        title={m.label}
                        className={cn(
                          "flex h-10 w-full shrink-0 items-center gap-3 rounded-full px-3.5 text-sm transition-all duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                          isActive
                            ? "bg-primary font-medium text-primary-foreground shadow-md"
                            : "text-ink-secondary hover:bg-surface hover:text-ink hover:shadow-sm"
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
          </nav>

          {/* Ask Shepherd — quiet card pinned to the rail bottom (AI module access) */}
          {moduleLevel(user, "ai") >= 1 ? (
          <div className="pt-2">
            <div className="mx-1 border-t border-border/70 pb-2" aria-hidden />
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("chms:ai:open"))}
              aria-label="Ask Shepherd — AI assistant"
              title="Ask Shepherd"
              className="flex h-10 w-full shrink-0 items-center gap-3 rounded-full bg-surface px-2.5 text-sm text-ink shadow-sm transition-all duration-150 hover:shadow-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="truncate">Ask Shepherd</span>
            </button>
          </div>
          ) : null}
        </aside>

        {/* Module content — page transition: fade + 8px slide (fade-only under reduced motion) */}
        <main className="min-w-0 flex-1 pb-6 pt-1 sm:pb-8">
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
      <footer className="mt-auto no-print">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-1.5 border-t border-border/60 px-4 py-3 text-[11px] text-ink-muted sm:flex-row sm:px-5">
          <p>Grace ChMS · local build · data stored on this machine (SQLite)</p>
          <p>Signed in as {user.name} — {user.roleNames.join(", ")}</p>
        </div>
      </footer>
    </div>
  );
}
