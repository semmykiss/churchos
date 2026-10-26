'use client'

import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import {
  Search, ArrowRight, Church, Moon, Sun,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-store'
import { visibleModules, type Module } from '@/lib/permissions'
import { NAV_ITEMS } from '@/lib/nav'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const { user, setModule, permissions } = useAuth()
  const { setTheme } = useTheme()

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  if (!user) return null

  const permModules = permissions?.modules ?? null
  const visible = (permModules ?? visibleModules(user.role)).filter((m) =>
    NAV_ITEMS.some((n) => n.id === m),
  )

  function go(modId: Module) {
    setModule(modId)
    setOpen(false)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      className={cn(
        'fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4',
      )}
      overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-sm"
    >
      <div
        className={cn(
          'w-full max-w-xl overflow-hidden rounded-2xl glass-strong',
          'shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)]',
          'flex flex-col max-h-[60vh]',
        )}
        role="dialog"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
          <Search className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <Command.Input
            placeholder="Search modules or jump to…"
            className="cmdk-input flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground"
            autoFocus
          />
          <kbd className="kbd">esc</kbd>
        </div>

        {/* Results */}
        <Command.List className="flex-1 overflow-y-auto scroll-thin p-2">
          <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          <Command.Group heading="Navigate" className="text-muted-foreground">
            {visible.map((modId) => {
              const item = NAV_ITEMS.find((n) => n.id === modId)
              if (!item) return null
              const Icon = item.icon
              return (
                <Command.Item
                  key={modId}
                  value={`${item.label} ${modId} navigate go to`}
                  onSelect={() => go(modId)}
                  className="cmdk-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm cursor-pointer aria-selected:bg-accent"
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1 text-foreground">{item.label}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-aria-selected:opacity-100" aria-hidden="true" />
                </Command.Item>
              )
            })}
          </Command.Group>

          <Command.Group heading="Appearance" className="text-muted-foreground">
            <Command.Item
              value="theme dark mode"
              onSelect={() => { setTheme('dark'); setOpen(false) }}
              className="cmdk-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm cursor-pointer"
            >
              <Moon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">Dark theme</span>
            </Command.Item>
            <Command.Item
              value="theme light mode"
              onSelect={() => { setTheme('light'); setOpen(false) }}
              className="cmdk-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm cursor-pointer"
            >
              <Sun className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">Light theme</span>
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Quick info" className="text-muted-foreground">
            <Command.Item
              value="church organization info"
              onSelect={() => { setModule('dashboard'); setOpen(false) }}
              className="cmdk-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm cursor-pointer"
            >
              <Church className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">{user.role} · {user.name}</span>
            </Command.Item>
          </Command.Group>
        </Command.List>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/40 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
            <span>navigate</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="kbd">↵</kbd>
            <span>select</span>
          </div>
        </div>
      </div>
    </Command.Dialog>
  )
}
