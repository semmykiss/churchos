'use client'

import { useState } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Church, Loader2, Eye, EyeOff, ArrowRight, Mail, Lock,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const DEMO_ACCOUNTS = [
  { email: 'admin@gracechapel.org', role: 'Admin', icon: '⚙️' },
  { email: 'pastor@gracechapel.org', role: 'Pastor', icon: '⛪' },
  { email: 'finance@gracechapel.org', role: 'Finance', icon: '💰' },
  { email: 'worship@gracechapel.org', role: 'Dept Head', icon: '🎵' },
  { email: 'member@gracechapel.org', role: 'Member', icon: '👤' },
  { email: 'super@churchos.app', role: 'Super', icon: '🛡️' },
]

export function LoginScreen() {
  const [email, setEmail] = useState('admin@gracechapel.org')
  const [password, setPassword] = useState('churchos123')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Login failed')
        return
      }
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}!`)
      await loadSession()
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="aurora-root min-h-screen w-full flex items-center justify-center p-4 sm:p-6 aurora-bg">
      <div className="relative z-10 w-full max-w-[440px]">
        {/* Brand mark */}
        <div className="flex flex-col items-center mb-8">
          <div className="size-14 rounded-2xl bg-primary/10 ring-1 ring-primary/25 grid place-items-center shadow-premium-md mb-4">
            <Church className="size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome to ChurchOS
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Sign in to manage your church with clarity and care.
          </p>
        </div>

        {/* Glass auth card */}
        <div className="glass-strong rounded-2xl p-7 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] aurora-fade-up">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[13px] font-medium text-foreground/80">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50 pointer-events-none" aria-hidden="true" />
                <Input
                  id="email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@church.org…"
                  className="h-11 pl-11 bg-foreground/[0.03] border-border/60 text-foreground placeholder:text-muted-foreground/50 rounded-lg focus-visible:border-primary/50 focus-visible:ring-primary/15 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-[13px] font-medium text-foreground/80">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50 pointer-events-none" aria-hidden="true" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password…"
                  className="h-11 pl-11 pr-11 bg-foreground/[0.03] border-border/60 text-foreground placeholder:text-muted-foreground/50 rounded-lg focus-visible:border-primary/50 focus-visible:ring-primary/15 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Sign in button */}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-semibold text-sm border-0 hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
            >
              {submitting ? (
                <><Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" /> Signing in…</>
              ) : (
                <>Sign In <ArrowRight className="size-4 ml-2" aria-hidden="true" /></>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-muted-foreground/70 uppercase tracking-wider">Demo accounts</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Demo account chips */}
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => { setEmail(a.email); setPassword('churchos123') }}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg glass-subtle px-2 py-2.5',
                  'text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all',
                  email === a.email && 'border-primary/40 text-primary bg-primary/5',
                )}
              >
                <span className="text-base" aria-hidden="true">{a.icon}</span>
                <span className="font-medium">{a.role}</span>
              </button>
            ))}
          </div>

          <p className="mt-4 text-center text-[10px] text-muted-foreground/70">
            Password for all demo accounts: <code className="font-mono text-foreground/70 bg-foreground/5 px-1.5 py-0.5 rounded">churchos123</code>
          </p>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/70">
          <Sparkles className="size-3" aria-hidden="true" />
          <span>ChurchOS · {new Date().getFullYear()} · Secure church operations</span>
        </div>
      </div>
    </div>
  )
}
