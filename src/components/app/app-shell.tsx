"use client";

/**
 * App shell — responsive sidebar + topbar + sticky footer.
 * Layout contract: min-h-screen flex flex-col; footer uses mt-auto so it
 * sticks to the bottom on short pages and is pushed down on long ones.
 */
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/types";
import { GROUP_LABELS, modulesFor, type ModuleDef } from "@/components/app/module-registry";
import NotificationBell from "@/components/app/notifications/notification-bell";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Church, LogOut, Menu, MapPin, Sparkles } from "lucide-react";

interface ShellProps {
  user: SessionUser;
  active: string;
  onNavigate: (key: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export default function AppShell({ user, active, onNavigate, onLogout, children }: ShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const mods = modulesFor(user);
  const current: ModuleDef | undefined = mods.find((m) => m.key === active) ?? mods[0];
  const groups: ModuleDef["group"][] = ["overview", "ministry", "finance", "system"];

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
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/45">{GROUP_LABELS[g]}</p>
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
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {m.label}
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
          className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400">
            <Sparkles className="h-2.5 w-2.5 text-white" />
          </span>
          Ask Shepherd
        </button>
      </div>
    </nav>
  );

  const Brand = (
    <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary/20">
        <Church className="h-4.5 w-4.5 text-sidebar-primary" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-sidebar-foreground">{user.orgName}</p>
        <p className="flex items-center gap-1 truncate text-[11px] text-sidebar-foreground/55">
          <MapPin className="h-3 w-3" /> {user.campusName ?? "Main campus"}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Topbar */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 no-print">
        <div className="flex h-14 items-center gap-3 px-4">
          {/* Mobile nav */}
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu className="h-5 w-5" />
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

          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary/15">
              <Church className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold">{user.orgName}</span>
          </div>

          <h2 className="hidden text-sm font-semibold lg:block">{current?.label}</h2>

          <div className="ml-auto flex items-center gap-1.5">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                      {user.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-40 truncate text-sm font-medium leading-tight">{user.name}</span>
                    <span className="block max-w-40 truncate text-[11px] leading-tight text-muted-foreground">{user.roleNames.join(", ")}</span>
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout}>
                  <LogOut className="h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col bg-sidebar lg:flex no-print">
          {Brand}
          {NavList}
        </aside>

        {/* Module content */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>

      {/* Sticky footer (mt-auto pins it to the bottom on short pages) */}
      <footer className="mt-auto border-t bg-muted/40 no-print">
        <div className="flex flex-col items-center justify-between gap-1.5 px-4 py-3 text-[11px] text-muted-foreground sm:flex-row sm:px-6">
          <p>Grace ChMS · local build · data stored on this machine (SQLite)</p>
          <p>Signed in as {user.name} — {user.roleNames.join(", ")}</p>
        </div>
      </footer>
    </div>
  );
}
