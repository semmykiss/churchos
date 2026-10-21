'use client'

import { useState } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Church, Loader2, Eye, EyeOff, ArrowRight, Mail, Lock,
  ShieldCheck, Users, CalendarCheck, HeartHandshake, Sparkles, TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'

const DEMO_ACCOUNTS = [
  { email: 'admin@gracechapel.org', role: 'Church Admin' },
  { email: 'pastor@gracechapel.org', role: 'Pastor' },
  { email: 'finance@gracechapel.org', role: 'Finance Officer' },
  { email: 'worship@gracechapel.org', role: 'Department Head' },
  { email: 'member@gracechapel.org', role: 'Member' },
  { email: 'super@churchos.app', role: 'Super Admin' },
]

export function LoginScreen() {
  const [email, setEmail] = useState('admin@gracechapel.org')
  const [password, setPassword] = useState('churchos123')
  const [showPassword, setShowPassword] = useState(false)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
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
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-gray-100">
      {/* Floating split-card */}
      <div className="relative w-full max-w-[1040px] grid grid-cols-1 lg:grid-cols-2 rounded-[24px] overflow-hidden shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] ring-1 ring-black/5 lg:h-[640px] bg-white">
        {/* ===== LEFT — Auth Panel (white) ===== */}
        <div className="flex flex-col justify-center px-8 sm:px-12 lg:px-16 py-10 lg:py-12 order-2 lg:order-1">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-8">
            <div className="size-9 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 grid place-items-center shadow-md shadow-teal-500/20">
              <Church className="size-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-gray-900">ChurchOS</span>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-2xl lg:text-[26px] font-bold tracking-tight text-gray-900">
              {mode === 'signin' ? 'Welcome to ChurchOS' : 'Create your account'}
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              {mode === 'signin'
                ? 'Start your experience with ChurchOS by signing in to your church account.'
                : 'Join your church community and get started in minutes.'}
            </p>
          </div>

          {/* Tab switcher */}
          <div className="flex p-1 bg-gray-100 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                mode === 'signin'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                mode === 'signup'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[13px] font-medium text-gray-600">
                Email Address <span className="text-teal-600">*</span>
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400 pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className="h-12 pl-11 border-gray-300 text-gray-900 placeholder:text-gray-300 rounded-lg focus-visible:border-teal-500 focus-visible:ring-teal-500/15"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[13px] font-medium text-gray-600">
                Password <span className="text-teal-600">*</span>
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400 pointer-events-none" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-12 pl-11 pr-11 border-gray-300 text-gray-900 placeholder:text-gray-300 rounded-lg focus-visible:border-teal-500 focus-visible:ring-teal-500/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                </button>
              </div>
            </div>

            {/* Primary button */}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-xl text-white font-semibold text-[15px] border-0 transition-all hover:opacity-90 hover:shadow-lg hover:shadow-teal-500/25"
              style={{
                background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
                boxShadow: '0 4px 6px -1px rgba(13, 148, 136, 0.3)',
              }}
            >
              {submitting ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Signing in…</>
              ) : (
                <>{mode === 'signin' ? 'Sign In' : 'Sign Up'} <ArrowRight className="size-4 ml-2" /></>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-[13px] text-gray-400">Or continue with</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Social buttons */}
          <div className="flex items-center justify-center gap-3">
            {[
              { label: 'Google', svg: <svg className="size-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
              { label: 'Apple', svg: <svg className="size-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg> },
              { label: 'Facebook', svg: <svg className="size-5" viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg> },
              { label: 'X', svg: <svg className="size-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> },
            ].map((s) => (
              <button
                key={s.label}
                type="button"
                aria-label={`Continue with ${s.label}`}
                className="size-11 rounded-full bg-white border border-gray-200 grid place-items-center shadow-sm hover:shadow-md hover:border-gray-300 transition-all"
              >
                {s.svg}
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 mt-8 text-[11px] text-gray-400">
            <span>© {new Date().getFullYear()} ChurchOS</span>
            <span>·</span>
            <button type="button" className="hover:text-gray-600 transition-colors">Terms &amp; Conditions</button>
            <span>·</span>
            <button type="button" className="hover:text-gray-600 transition-colors">Privacy Policy</button>
          </div>

          {/* Demo accounts */}
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2 text-center">
              Demo accounts · password <code className="font-mono bg-gray-100 px-1 py-0.5 rounded text-gray-500">churchos123</code>
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => quickFill(a.email)}
                  className="text-[11px] rounded-lg border border-gray-200 hover:border-teal-400 hover:bg-teal-50 text-gray-500 hover:text-teal-700 transition-colors px-2 py-1.5 leading-tight"
                >
                  {a.role}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ===== RIGHT — Branded Panel (dark teal) ===== */}
        <div className="relative overflow-hidden order-1 lg:order-2 min-h-[280px] lg:min-h-0"
          style={{ background: 'linear-gradient(160deg, #0f3045 0%, #134e4a 50%, #0f3d3a 100%)' }}
        >
          {/* Glow effects */}
          <div className="absolute -top-20 -right-20 size-72 rounded-full bg-teal-500/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 size-60 rounded-full bg-teal-400/10 blur-3xl pointer-events-none" />
          {/* Dot grid */}
          <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          />

          <div className="relative z-10 h-full flex flex-col items-center justify-center px-10 py-12 text-center">
            {/* Brand icon */}
            <div className="size-16 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 grid place-items-center shadow-xl shadow-teal-500/30 mb-6 ring-1 ring-white/20">
              <Church className="size-8 text-white" />
            </div>

            {/* Headline */}
            <h2 className="text-white text-xl lg:text-[26px] font-bold tracking-tight leading-snug max-w-md">
              A unified platform for smarter church management.
            </h2>
            <p className="text-teal-100/70 text-sm lg:text-[15px] mt-3 max-w-sm leading-relaxed">
              ChurchOS empowers you with a complete church operations command center — membership, attendance, finance, pastoral care, and more in one place.
            </p>

            {/* Floating glass cards */}
            <div className="mt-8 w-full max-w-sm space-y-3">
              {/* Card 1 — Members */}
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.08] backdrop-blur-md ring-1 ring-white/15 p-3.5 text-left shadow-lg" style={{ transform: 'rotate(-1.5deg)' }}>
                <div className="size-10 rounded-lg bg-teal-500/20 grid place-items-center shrink-0">
                  <Users className="size-5 text-teal-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-teal-100/60">Total Members</p>
                  <p className="text-lg font-bold text-white nums">1,247</p>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-emerald-300 font-medium">
                  <TrendingUp className="size-3" /> +12%
                </div>
              </div>
              {/* Card 2 — Finance */}
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.08] backdrop-blur-md ring-1 ring-white/15 p-3.5 text-left shadow-lg ml-6" style={{ transform: 'rotate(1deg)' }}>
                <div className="size-10 rounded-lg bg-teal-500/20 grid place-items-center shrink-0">
                  <ShieldCheck className="size-5 text-teal-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-teal-100/60">Giving This Month</p>
                  <p className="text-lg font-bold text-white nums">₦4.38M</p>
                </div>
              </div>
              {/* Card 3 — Attendance */}
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.08] backdrop-blur-md ring-1 ring-white/15 p-3.5 text-left shadow-lg" style={{ transform: 'rotate(-0.5deg)' }}>
                <div className="size-10 rounded-lg bg-teal-500/20 grid place-items-center shrink-0">
                  <CalendarCheck className="size-5 text-teal-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-teal-100/60">Last Service Attendance</p>
                  <p className="text-lg font-bold text-white nums">552</p>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="absolute bottom-8 left-10 right-10">
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-teal-400" style={{ width: '65%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Partner Portal link */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <a href="/partner" className="text-[11px] text-gray-400 hover:text-teal-600 transition-colors underline-offset-2 hover:underline">
          Partner Portal
        </a>
      </div>
    </div>
  )
}
