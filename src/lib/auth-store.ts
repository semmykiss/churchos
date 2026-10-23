'use client'

import { create } from 'zustand'
import type { Module, Action } from '@/lib/permissions'

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
  isPartnerAdmin?: boolean
  orgStatus?: string
  roleLabel?: string | null
  roleColor?: string | null
  roleIsSystem?: boolean
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

export interface PermissionsSnapshot {
  modules: Module[]
  allowed: Record<string, Action[]>
  roleActive: boolean
}

interface AuthState {
  user: AuthUser | null
  organization: OrgInfo | null
  loading: boolean
  activeModule: Module
  memberIdDetail: string | null
  /** When a notification is clicked, this is set to { module, refId } so the
   *  target module can open the specific record (member profile, event detail,
   *  townhall room, task, tithe, pastoral case, announcement, etc.). */
  detailRef: { module: string; refId: string; action?: string; nonce: number } | null
  permissions: PermissionsSnapshot | null
  setUser: (u: AuthUser | null) => void
  setOrganization: (o: OrgInfo | null) => void
  setLoading: (b: boolean) => void
  setModule: (m: Module) => void
  openMember: (id: string | null) => void
  /** Open a specific record in a module. `nonce` (Date.now()) ensures the same
   *  refId triggers a re-open even if the module is already viewing it. */
  openDetail: (module: string, refId: string, action?: string) => void
  clearDetail: () => void
  setPermissions: (p: PermissionsSnapshot | null) => void
  canClient: (mod: Module, action: Action) => boolean
  logout: () => void
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  organization: null,
  loading: true,
  activeModule: 'dashboard',
  memberIdDetail: null,
  detailRef: null,
  permissions: null,
  setUser: (user) => set({ user }),
  setOrganization: (organization) => set({ organization }),
  setLoading: (loading) => set({ loading }),
  setModule: (activeModule) => set({ activeModule, memberIdDetail: null }),
  openMember: (memberIdDetail) => set({ memberIdDetail }),
  openDetail: (module, refId, action) =>
    set({ detailRef: { module, refId, action, nonce: Date.now() } }),
  clearDetail: () => set({ detailRef: null }),
  canClient: (mod, action) => {
    const p = get().permissions
    if (!p) return false
    return !!p.allowed[mod]?.includes(action)
  },
  logout: async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    set({ user: null, organization: null, activeModule: 'dashboard', memberIdDetail: null, detailRef: null, permissions: null })
  },
}))

export async function loadSession(): Promise<void> {
  try {
    const res = await fetch('/api/me', { cache: 'no-store' })
    const data = await res.json()
    useAuth.setState({
      user: data.user ?? null,
      organization: data.organization ?? null,
      permissions: data.permissions ?? null,
      loading: false,
    })
  } catch {
    useAuth.setState({ user: null, organization: null, permissions: null, loading: false })
  }
}
