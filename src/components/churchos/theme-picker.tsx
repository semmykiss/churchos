'use client'

// ChurchOS — Theme picker for app + chat themes.
// Shows a popover with color swatches for app themes + chat themes.
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Palette, Check } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { toast } from 'sonner'

const APP_THEMES = [
  { id: 'indigo', label: 'Indigo', color: '#4f46e5', desc: 'Default brand' },
  { id: 'emerald', label: 'Emerald', color: '#059669', desc: 'Church green' },
  { id: 'purple', label: 'Royal Purple', color: '#7c3aed', desc: 'Royal' },
  { id: 'rose', label: 'Rose Gold', color: '#e11d48', desc: 'Warm' },
  { id: 'ocean', label: 'Ocean Blue', color: '#0284c7', desc: 'Cool blue' },
  { id: 'amber', label: 'Sunset Amber', color: '#d97706', desc: 'Warm gold' },
  { id: 'midnight', label: 'Midnight', color: '#1e1b4b', desc: 'Dark premium' },
]

const CHAT_THEMES = [
  { id: 'emerald', label: 'Emerald', color: '#059669' },
  { id: 'ocean', label: 'Ocean', color: '#0284c7' },
  { id: 'sunset', label: 'Sunset', color: '#e11d48' },
  { id: 'forest', label: 'Forest', color: '#0d9488' },
  { id: 'royal', label: 'Royal', color: '#7c3aed' },
  { id: 'gold', label: 'Gold', color: '#d97706' },
  { id: 'slate', label: 'Slate', color: '#475569' },
  { id: 'indigo', label: 'Indigo', color: '#4f46e5' },
]

export function ThemePicker({ mode = 'app' }: { mode?: 'app' | 'chat' }) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)

  // Read chat theme lazily when popover opens (not in an effect)
  const chatTheme = typeof window !== 'undefined' ? (localStorage.getItem('churchos-chat-theme') ?? 'emerald') : 'emerald'

  const themes = mode === 'app' ? APP_THEMES : CHAT_THEMES
  const current = mode === 'app' ? (theme?.replace('-dark', '') || 'indigo') : chatTheme

  function selectTheme(id: string) {
    if (mode === 'app') {
      // Preserve dark/light mode
      const isDark = theme?.includes('dark') || document.documentElement.classList.contains('dark')
      setTheme(isDark ? `${id}-dark` : id)
      document.documentElement.setAttribute('data-theme', id)
      localStorage.setItem('churchos-app-theme', id)
      toast.success(`App theme: ${APP_THEMES.find((t) => t.id === id)?.label}`)
    } else {
      setChatTheme(id)
      localStorage.setItem('churchos-chat-theme', id)
      // Apply to all chat containers
      document.querySelectorAll('[data-chat-container]').forEach((el) => {
        el.setAttribute('data-chat-theme', id)
      })
      toast.success(`Chat theme: ${CHAT_THEMES.find((t) => t.id === id)?.label}`)
    }
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
          {mode === 'app' ? 'App Theme' : 'Chat Theme'}
        </p>
        <div className="grid grid-cols-4 gap-3">
          {themes.map((t) => (
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
        {mode === 'app' && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <p className="text-[10px] text-muted-foreground text-center">
              Toggle dark/light with the sun/moon icon
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
