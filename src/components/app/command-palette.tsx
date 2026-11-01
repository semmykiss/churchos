"use client";

/**
 * CommandPalette — ⌘K / Ctrl+K global launcher (cmdk-based).
 * Role-aware: module entries come from modulesFor(user), i.e. the exact same
 * permission checks that shape the sidebar — nothing is bypassed. Also offers
 * theme switching (via the chms:theme:set event handled by ThemeProvider),
 * the AI assistant (permission-gated) and sign out.
 *
 * Mount once inside AppShell; open via the "chms:palette:open" window event
 * or ⌘K / Ctrl+K.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem,
  CommandList, CommandSeparator,
} from "@/components/ui/command";
import { modulesFor, GROUP_LABELS, type ModuleDef } from "@/components/app/module-registry";
import { THEMES } from "@/components/app/theme/theme";
import { canDo, moduleLevel, type SessionUser } from "@/lib/types";
import { LogOut, Monitor, Palette, Sparkles } from "lucide-react";

const GROUP_ORDER: ModuleDef["group"][] = ["overview", "ministry", "finance", "system"];

export function useCommandPalette(
  user: SessionUser,
  onNavigate: (key: string) => void,
  onLogout: () => void
) {
  const openPalette = useCallback(() => {
    window.dispatchEvent(new CustomEvent("chms:palette:open"));
  }, []);

  const palette = <CommandPalette user={user} onNavigate={onNavigate} onLogout={onLogout} />;

  return { openPalette, palette };
}

function CommandPalette({
  user,
  onNavigate,
  onLogout,
}: {
  user: SessionUser;
  onNavigate: (key: string) => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen((v) => !v);
    window.addEventListener("chms:palette:open", onOpen);
    return () => window.removeEventListener("chms:palette:open", onOpen);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  function run(action: () => void) {
    setOpen(false);
    // let the dialog exit before mutating the DOM underneath
    window.setTimeout(action, 80);
  }

  const mods = modulesFor(user); // same permission filter as the sidebar
  // Shepherd AI entry: visible when the user's module matrix grants the AI module
  const canOpenShepherd = moduleLevel(user, "ai") >= 1;

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search modules and actions">
      <CommandInput placeholder="Search modules and actions…" />
      <CommandList className="max-h-[360px] scroll-slim">
        <CommandEmpty>No matching commands.</CommandEmpty>

        {GROUP_ORDER.map((group) => {
          const items = mods.filter((m) => m.group === group);
          if (!items.length) return null;
          return (
            <CommandGroup key={group} heading={GROUP_LABELS[group]}>
              {items.map((m) => {
                const Icon = m.icon;
                return (
                  <CommandItem
                    key={m.key}
                    value={`${m.label} ${m.key}`}
                    onSelect={() => run(() => onNavigate(m.key))}
                  >
                    <Icon className="text-ink-muted" aria-hidden />
                    <span>{m.label}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-muted">Module</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}

        <CommandSeparator />
        <CommandGroup heading="Appearance">
          <CommandItem
            value="theme match system"
            onSelect={() => run(() => window.dispatchEvent(new CustomEvent("chms:theme:set", { detail: "system" })))}
          >
            <Monitor className="text-ink-muted" aria-hidden /> Match system theme
            <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-muted">Theme</span>
          </CommandItem>
          {THEMES.map((t) => (
            <CommandItem
              key={t.key}
              value={`theme ${t.label} ${t.hint}`}
              onSelect={() => run(() => window.dispatchEvent(new CustomEvent("chms:theme:set", { detail: t.key })))}
            >
              <Palette className="text-ink-muted" aria-hidden />
              {t.label}
              <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-muted">Theme</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {canOpenShepherd ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Assistant">
              <CommandItem
                value="ask shepherd ai assistant"
                onSelect={() => run(() => window.dispatchEvent(new CustomEvent("chms:ai:open")))}
              >
                <Sparkles className="text-ink-muted" aria-hidden /> Ask Shepherd
                <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-muted">AI</span>
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading="Session">
          <CommandItem value="sign out logout" onSelect={() => run(onLogout)}>
            <LogOut className="text-ink-muted" aria-hidden /> Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
