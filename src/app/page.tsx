'use client'

import { useEffect } from 'react'
import { useAuth, loadSession } from '@/lib/auth-store'
import { LoginScreen } from '@/components/churchos/login-screen'
import { AppShell } from '@/components/churchos/app-shell'
import { Church } from 'lucide-react'

export default function Home() {
  const { user, loading } = useAuth()

  useEffect(() => {
    loadSession()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-12 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-lg shadow-primary/20">
            <Church className="size-6 animate-pulse" />
          </div>
          <p className="text-sm">Loading ChurchOS…</p>
        </div>
      </div>
    )
  }

  return user ? <AppShell /> : <LoginScreen />
}
