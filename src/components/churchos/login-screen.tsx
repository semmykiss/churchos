'use client'

import { useState } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Church, Loader2, ShieldCheck, Users, CalendarCheck, HeartHandshake,
  Eye, EyeOff, ArrowRight, Sparkles, Lock,
} from 'lucide-react'
import { toast } from 'sonner'

const DEMO_ACCOUNTS = [
  { email: 'admin@gracechapel.org', role: 'Church Admin', tone: 'Admin' },
  { email: 'pastor@gracechapel.org', role: 'Pastor', tone: 'Pastoral' },
  { email: 'finance@gracechapel.org', role: 'Finance Officer', tone: 'Finance' },
  { email: 'worship@gracechapel.org', role: 'Department Head', tone: 'Dept Head' },
  { email: 'assistant@gracechapel.org', role: 'Dept Assistant', tone: 'Dept Asst' },
  { email: 'member@gracechapel.org', role: 'Member', tone: 'Member' },
]

export function LoginScreen() {
  const [email, setEmail] = useState('admin@gracechapel.org')
  const [password, setPassword] = useState('churchos123')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
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

  function quickFill(em: string) {
    setEmail(em)
    setPassword('churchos123')
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background">
      {/* Left — branded navy panel */}
      <div className="lg:w-[52%] relative overflow-hidden bg-navy-gradient text-white flex flex-col justify-between p-8 lg:p-14">
        {/* dotted overlay */}
        <div
          className="absolute inset-0 opacity-[0.18] pointer-events-none"
          style={{
            backgroundImage: 'rad-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)',
          }}
        />
        {/* glow */}
        <div className="absolute -top-24 -right-24 size-80 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-16 size-72 rounded-full bg-violet-500/15 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="size-11 rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/20 grid place-items-center shadow-lg shadow-black/20">
            <Church className="size-6 text-white" />
          </div>
          <div>
            <p className="font-semibold text-lg leading-none tracking-tight">ChurchOS</p>
            <p className="text-xs text-white/60 mt-1">Church Management System</p>
          </div>
        </div>

        <div className="relative z-10 py-16 lg:py-0 max-w-xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 ring-1 ring-white/15 px-3 py-1 text-[11px] font-medium mb-5 backdrop-blur">
            <Sparkles className="size-3" /> The complete church operations platform
          </div>
          <h1 className="text-4xl lg:text-5xl font-semibold tracking-tight leading-[1.1]">
            Run your church with <br className="hidden lg:block" />
            <span className="bg-gradient-to-r from-indigo-300 to-violet-200 bg-clip-text text-transparent">clarity and care.</span>
          </h1>
          <p className="mt-5 text-white/70 text-base lg:text-lg leading-relaxed">
            Membership, attendance, finance, pastoral care, events, volunteers, assets and reporting — secured by granular, role-based access control.
          </p>
          <div className="mt-9 grid grid-cols-2 gap-3 max-w-md">
            {[
              { icon: Users, label: 'Member CRM' },
              { icon: CalendarCheck, label: 'Attendance' },
              { icon: HeartHandshake, label: 'Pastoral Care' },
              { icon: ShieldCheck, label: 'Role-based Security' },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-2.5 rounded-lg bg-white/[0.06] ring-1 ring-white/10 backdrop-blur px-3 py-2.5">
                <f.icon className="size-4 text-indigo-200" />
                <span className="text-sm font-medium text-white/90">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-white/50">
          © {new Date().getFullYear()} ChurchOS · Default timezone Africa/Lagos · Currency NGN.
        </p>
      </div>

      {/* Right — auth panel */}
      <div className="lg:w-[48%] flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-background">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">Sign in to your account</h2>
            <p className="text-sm text-muted-foreground mt-1">Welcome back. Enter your credentials to continue.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@church.org"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                <button type="button" className="text-xs text-primary hover:underline focus-ring rounded">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-ring rounded"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
              <Label htmlFor="remember" className="text-sm text-muted-foreground font-normal cursor-pointer">
                Keep me signed in for 7 days
              </Label>
            </div>

            <Button type="submit" className="w-full h-11 text-sm font-medium" disabled={submitting}>
              {submitting ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Signing in…</>
              ) : (
                <>Sign in <ArrowRight className="size-4 ml-2" /></>
              )}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-border/60">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="size-3 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground">Demo accounts · password <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">churchos123</code></p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => quickFill(a.email)}
                  className="text-left text-xs rounded-lg border border-border/60 hover:border-primary/40 hover:bg-accent/50 transition-all px-2.5 py-2"
                >
                  <div className="font-medium text-foreground">{a.role}</div>
                  <div className="text-muted-foreground truncate text-[11px]">{a.email}</div>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-8 text-center text-[11px] text-muted-foreground/70 leading-relaxed">
            By signing in you agree to the <span className="underline">Terms of Service</span> and <span className="underline">Privacy Policy</span>.
            <br />Unauthorized access is prohibited and logged.
          </p>
        </div>
      </div>
    </div>
  )
}
