'use client'

// ChurchOS — App theme picker.
// Shows a popover with color swatches for the app accent themes.
//
// HOW THEMING WORKS (keep this split intact):
//  - next-themes owns light/dark/system ONLY (providers.tsx: attribute="class",
//    themes light/dark/system). The sun/moon toggle in app-shell calls setTheme.
//  - Color themes are applied via the `data-theme` attribute on <html> and
//    persisted in localStorage ('churchos-app-theme') — exactly what
//    providers.tsx re-applies on mount. globals.css styles them with
//    `[data-theme="x"]` and `[data-theme="x"].dark` selectors, so a color
//    theme and dark mode COMPOSE; never pass a color id to setTheme — those
//    names are not registered with next-themes and would clobber the .dark
//    class on <html>.
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Palette, Check } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

// Only themes that actually have CSS blocks in globals.css. Emerald is the
// brand default ('Indigo' has no CSS block — removed).
const APP_THEMES = [
  { id: 'emerald', label: 'Emerald', color: '#059669' },
  { id: 'purple', label: 'Royal Purple', color: '#7c3aed' },
  { id: 'rose', label: 'Rose Gold', color: '#e11d48' },
  { id: 'ocean', label: 'Ocean Blue', color: '#0284c7' },
  { id: 'amber', label: 'Sunset Amber', color: '#d97706' },
  { id: 'midnight', label: 'Midnight', color: '#1e1b4b' },
]

export function ThemePicker({ mode = 'app' }: { mode?: 'app' }) {
  const [open, setOpen] = useState(false)
  // Lazily read the saved theme (client-only — the swatch grid lives inside the
  // popover, which never renders during SSR/hydration).
  const [current, setCurrent] = useState(
    () => (typeof window !== 'undefined' ? localStorage.getItem('churchos-app-theme') : null) ?? 'emerald',
  )

  function selectTheme(id: string) {
    // Color theme ONLY — light/dark stays with next-themes (sun/moon toggle).
    document.documentElement.setAttribute('data-theme', id)
    localStorage.setItem('churchos-app-theme', id)
    setCurrent(id)
    toast.success(`App theme: ${APP_THEMES.find((t) => t.id === id)?.label}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme picker">
          <Palette className="size-4.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" align="end">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          App Theme
        </p>
        <div className="grid grid-cols-4 gap-3">
          {APP_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTheme(t.id)}
              className="flex flex-col items-center gap-1.5 group"
              title={t.label}
            >
              <div
                className={`size-10 rounded-full ring-2 transition-all ${
                  current === t.id ? 'ring-foreground scale-110' : 'ring-transparent group-hover:ring-border'
                }`}
                style={{ background: t.color }}
              >
                {current === t.id && (
                  <div className="size-full grid place-items-center">
                    <Check className="size-4 text-white drop-shadow" />
                  </div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground text-center leading-tight">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border/40">
          <p className="text-[10px] text-muted-foreground text-center">
            Toggle dark/light with the sun/moon icon
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
