'use client'

import { useState } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Church, Loader2, Eye, EyeOff, ArrowRight, Mail, Lock,
  Users, CalendarCheck, Wallet, TrendingUp, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

const DEMO_ACCOUNTS = [
  { email: 'admin@gracechapel.org', role: 'Church Admin' },
  { email: 'pastor@gracechapel.org', role: 'Pastor' },
  { email: 'finance@gracechapel.org', role: 'Finance' },
  { email: 'worship@gracechapel.org', role: 'Dept Head' },
  { email: 'member@gracechapel.org', role: 'Member' },
  { email: 'super@churchos.app', role: 'Super Admin' },
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
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 lg:p-8" style={{ background: '#E5E7EB' }}>
      {/* Framed split-card */}
      <div className="relative w-full max-w-[1040px] grid grid-cols-1 lg:grid-cols-[45%_55%] rounded-[24px] overflow-hidden shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] ring-4 ring-white lg:h-[640px] bg-white">

        {/* ===== LEFT — Branded Panel (deep teal) ===== */}
        <div className="relative overflow-hidden hidden lg:flex flex-col justify-center items-center px-10 py-12 text-center order-2 lg:order-1"
          style={{ background: 'linear-gradient(160deg, #0F7B8C 0%, #0C6473 50%, #0A5562 100%)' }}
        >
          {/* Subtle diagonal pattern */}
          <div className="absolute inset-0 opacity-[0.05] pointer-events-none"
            style={{
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(255,255,255,0.8) 35px, rgba(255,255,255,0.8) 70px)',
            }}
          />
          {/* Glow */}
          <div className="absolute -top-20 -left-10 size-60 rounded-full bg-teal-300/15 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 right-0 size-72 rounded-full bg-teal-400/10 blur-3xl pointer-events-none" />

          {/* Small dot top-left */}
          <div className="absolute top-6 left-6 size-3 rounded-full bg-white/80" />

          <div className="relative z-10 w-full">
            {/* Brand icon */}
            <div className="flex justify-center mb-6">
              <div className="size-14 rounded-2xl bg-white/10 backdrop-blur-md ring-1 ring-white/20 grid place-items-center shadow-xl">
                <Church className="size-7 text-white" />
              </div>
            </div>

            {/* Headline */}
            <h2 className="text-white text-xl lg:text-[26px] font-bold tracking-tight leading-snug max-w-md">
              Unlock The Full Power of Your Church
            </h2>
            <p className="text-teal-100/70 text-sm mt-3 max-w-sm leading-relaxed">
              Just a few simple steps and you'll be ready to manage membership, attendance, finance, and pastoral care like never before.
            </p>

            {/* Floating glassmorphism dashboard card */}
            <div className="mt-8 mx-auto max-w-xs" style={{ transform: 'rotate(-4deg)' }}>
              <div className="rounded-2xl bg-white/90 backdrop-blur-xl shadow-2xl p-5 ring-1 ring-white/40">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] text-gray-500 font-medium">Church Overview</p>
                    <p className="text-lg font-bold text-gray-900 nums">1,247 members</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold">
                    <TrendingUp className="size-3" /> +12%
                  </div>
                </div>
                {/* Mini bar chart */}
                <div className="flex items-end gap-1.5 h-16 mb-3">
                  {[40, 65, 50, 80, 60, 90, 75].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: i === 5 ? '#0F7B8C' : '#0F7B8C40' }} />
                  ))}
                </div>
                {/* Mini stat chips */}
                <div className="flex gap-2">
                  <div className="flex-1 rounded-lg bg-gray-100 p-2">
                    <p className="text-[9px] text-gray-500">Attendance</p>
                    <p className="text-xs font-bold text-gray-900 nums">552</p>
                  </div>
                  <div className="flex-1 rounded-lg bg-gray-100 p-2">
                    <p className="text-[9px] text-gray-500">Giving</p>
                    <p className="text-xs font-bold text-gray-900 nums">₦4.38M</p>
                  </div>
                </div>
              </div>
              {/* Floating pill tags */}
              <div className="absolute -top-2 -right-3 rounded-full bg-white shadow-lg px-2.5 py-1 text-[10px] font-semibold text-teal-700 ring-1 ring-teal-100" style={{ transform: 'rotate(8deg)' }}>
                Members
              </div>
              <div className="absolute -bottom-2 -left-3 rounded-full bg-white shadow-lg px-2.5 py-1 text-[10px] font-semibold text-teal-700 ring-1 ring-teal-100" style={{ transform: 'rotate(-6deg)' }}>
                Finance
              </div>
            </div>

            {/* Footer */}
            <p className="absolute bottom-6 left-10 text-[10px] text-white/50">
              © {new Date().getFullYear()} ChurchOS. All Rights Reserved.
            </p>
          </div>
        </div>

        {/* ===== RIGHT — Auth Panel (clean white card on light gray) ===== */}
        <div className="relative flex flex-col items-center justify-center px-8 sm:px-12 lg:px-16 py-10 lg:py-12 order-1 lg:order-2"
          style={{ background: '#F9FAFB' }}
        >
          {/* Faint blueprint grid */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />

          {/* Auth card */}
          <div className="relative z-10 w-full max-w-[400px] bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] p-8 ring-1 ring-gray-100">
            {/* Logo */}
            <div className="flex items-center justify-center gap-2.5 mb-6">
              <div className="size-10 rounded-xl grid place-items-center shadow-md" style={{ background: '#0F7B8C' }}>
                <Church className="size-5 text-white" />
              </div>
              <span className="text-lg font-bold tracking-tight text-gray-900">ChurchOS</span>
            </div>

            {/* Heading */}
            <div className="text-center mb-6">
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-gray-900">
                Sign in to your account
              </h1>
              <p className="text-sm text-gray-500 mt-1.5">
                Manage your church with clarity and care.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="email" className="text-[13px] font-medium text-gray-600">Email</Label>
                </div>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400 pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="h-12 pl-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg focus-visible:border-teal-600 focus-visible:ring-teal-600/15"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[13px] font-medium text-gray-600">Password</Label>
                  <button type="button" className="text-xs text-blue-600 hover:underline">Forgot password?</button>
                </div>
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
                    className="h-12 pl-11 pr-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg focus-visible:border-teal-600 focus-visible:ring-teal-600/15"
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

              {/* Primary button — teal pill */}
              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-full text-white font-semibold text-[15px] border-0 transition-all hover:opacity-90 hover:shadow-lg"
                style={{
                  background: '#0F7B8C',
                  boxShadow: '0 4px 12px rgba(15, 123, 140, 0.3)',
                }}
              >
                {submitting ? (
                  <><Loader2 className="size-4 mr-2 animate-spin" /> Signing in…</>
                ) : (
                  <>Sign In <ArrowRight className="size-4 ml-2" /></>
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-[13px] text-gray-400">or continue with</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Social buttons */}
            <div className="flex items-center justify-center gap-3">
              {[
                { label: 'Google', svg: <svg className="size-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
                { label: 'Apple', svg: <svg className="size-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg> },
                { label: 'Facebook', svg: <svg className="size-5" viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg> },
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

            {/* Demo accounts */}
            <div className="mt-6 pt-5 border-t border-gray-100">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2 text-center">
                Demo accounts · password <code className="font-mono bg-gray-100 px-1 py-0.5 rounded text-gray-500">churchos123</code>
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => { setEmail(a.email); setPassword('churchos123') }}
                    className="text-[11px] rounded-lg border border-gray-200 hover:border-teal-400 hover:bg-teal-50 text-gray-500 hover:text-teal-700 transition-colors px-2 py-1.5"
                  >
                    {a.role}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Partner Portal link */}
          <div className="mt-4">
            <a href="/partner" className="text-[11px] text-gray-400 hover:text-teal-600 transition-colors underline-offset-2 hover:underline">
              Partner Portal
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
