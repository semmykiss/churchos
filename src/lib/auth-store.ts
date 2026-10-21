'use client'

import { create } from 'zustand'
import type { Module } from '@/lib/permissions'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
  phone?: string | null
  avatarUrl?: string | null
  organizationId: string
  departmentId?: string | null
  departmentName?: string | null
  memberId?: string | null
}

export interface OrgInfo {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  currency: string
  timezone: string
}

interface AuthState {
  user: AuthUser | null
  organization: OrgInfo | null
  loading: boolean
  activeModule: Module
  memberIdDetail: string | null // member detail context
  setUser: (u: AuthUser | null) => void
  setOrganization: (o: OrgInfo | null) => void
  setLoading: (b: boolean) => void
  setModule: (m: Module) => void
  openMember: (id: string | null) => void
  logout: () => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  organization: null,
  loading: true,
  activeModule: 'dashboard',
  memberIdDetail: null,
  setUser: (user) => set({ user }),
  setOrganization: (organization) => set({ organization }),
  setLoading: (loading) => set({ loading }),
  setModule: (activeModule) => set({ activeModule, memberIdDetail: null }),
  openMember: (memberIdDetail) => set({ memberIdDetail }),
  logout: async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    set({ user: null, organization: null, activeModule: 'dashboard', memberIdDetail: null })
  },
}))

export async function loadSession(): Promise<void> {
  try {
    const res = await fetch('/api/me', { cache: 'no-store' })
    const data = await res.json()
    useAuth.setState({
      user: data.user ?? null,
      organization: data.organization ?? null,
      loading: false,
    })
  } catch {
    useAuth.setState({ user: null, organization: null, loading: false })
  }
}
