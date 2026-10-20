'use client'

import { useState } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Church, Loader2, ShieldCheck, Users, CalendarCheck, HeartHandshake } from 'lucide-react'
import { toast } from 'sonner'

const DEMO_ACCOUNTS = [
  { email: 'admin@gracechapel.org', role: 'Church Admin' },
  { email: 'pastor@gracechapel.org', role: 'Pastor' },
  { email: 'finance@gracechapel.org', role: 'Finance Officer' },
  { email: 'worship@gracechapel.org', role: 'Department Head' },
  { email: 'assistant@gracechapel.org', role: 'Dept Assistant' },
  { email: 'member@gracechapel.org', role: 'Member' },
]

export function LoginScreen() {
  const [email, setEmail] = useState('admin@gracechapel.org')
  const [password, setPassword] = useState('churchos123')
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
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="lg:w-1/2 bg-church-gradient flex flex-col justify-between p-8 lg:p-12 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-lg shadow-primary/20">
            <Church className="size-6" />
          </div>
          <div>
            <p className="font-semibold text-lg leading-none">ChurchOS</p>
            <p className="text-xs text-muted-foreground mt-1">Church Management System</p>
          </div>
        </div>

        <div className="py-12 lg:py-0">
          <h1 className="text-3xl lg:text-5xl font-bold tracking-tight leading-tight">
            One platform for <br className="hidden lg:block" />
            your entire church.
          </h1>
          <p className="mt-4 text-muted-foreground text-lg max-w-md">
            Membership, attendance, finance, pastoral care, events, volunteers, assets and reporting — secured by role-based access control.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
            {[
              { icon: Users, label: 'Member CRM' },
              { icon: CalendarCheck, label: 'Attendance' },
              { icon: HeartHandshake, label: 'Pastoral Care' },
              { icon: ShieldCheck, label: 'Role-based Security' },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 backdrop-blur px-3 py-2.5">
                <f.icon className="size-4 text-primary" />
                <span className="text-sm font-medium">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} ChurchOS. Default timezone Africa/Lagos · Currency NGN.
        </p>
      </div>

      <div className="lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">
          <Card className="border-border/60 shadow-xl shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-2xl">Sign in</CardTitle>
              <CardDescription>Enter your church account credentials to continue.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                  Sign in
                </Button>
              </form>

              <div className="mt-6 pt-5 border-t border-border/60">
                <p className="text-xs font-medium text-muted-foreground mb-2.5">Demo accounts (password: churchos123)</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {DEMO_ACCOUNTS.map((a) => (
                    <button
                      key={a.email}
                      type="button"
                      onClick={() => quickFill(a.email)}
                      className="text-left text-xs rounded-md border border-border/60 hover:border-primary/50 hover:bg-accent/50 px-2.5 py-1.5 transition-colors"
                    >
                      <div className="font-medium">{a.role}</div>
                      <div className="text-muted-foreground truncate">{a.email}</div>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
