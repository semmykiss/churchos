'use client'

// ChurchOS — Settings & System Admin module (Module 16) + Profile/My Account
// Sections: My Account | Church Profile | Branches | Users & Roles | System
// - All authenticated roles see My Account + read-only Church Profile.
// - Only settings:manage (church_admin, super_admin) can edit + see Users/Branches/System.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { formatDate, formatDateTime, relativeTime, titleCase } from '@/lib/format'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  Settings as SettingsIcon, User as UserIcon, Building2, Users as UsersIcon,
  ShieldCheck, Save, Plus, MoreHorizontal, Pencil, Power, Lock, AlertTriangle,
  KeyRound, Mail, Phone, MapPin, CheckCircle2, XCircle, Database, Server, Cloud,
  Info, Network, RefreshCw, Globe, Coins, Image,
} from 'lucide-react'

const ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300' },
  { value: 'church_admin', label: 'Church Admin', color: 'bg-primary/10 text-primary border-primary/20' },
  { value: 'pastor', label: 'Pastor', color: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300' },
  { value: 'finance_officer', label: 'Finance Officer', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300' },
  { value: 'department_head', label: 'Department Head', color: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300' },
  { value: 'department_assistant', label: 'Department Assistant', color: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300' },
  { value: 'unit_leader', label: 'Unit Leader', color: 'bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300' },
  { value: 'member', label: 'Member', color: 'bg-muted text-muted-foreground border-border' },
  { value: 'guest', label: 'Guest', color: 'bg-muted text-muted-foreground border-border' },
]

function roleStyle(role: string): string {
  return ROLES.find((r) => r.value === role)?.color ?? 'bg-muted text-muted-foreground border-border'
}
function roleLabel(role: string): string {
  return ROLES.find((r) => r.value === role)?.label ?? titleCase(role)
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export default function SettingsModule() {
  const { user, organization, setModule } = useAuth()
  const role = user?.role ?? 'member'
  const canManage = can(role, 'settings', 'manage')
  const canView = can(role, 'settings', 'view')
  const [section, setSection] = useState<'account' | 'church' | 'branches' | 'users' | 'system'>('account')

  // If a non-admin (member/guest/assistant) opens Settings, default them to My Account.
  // Guard is applied at the Tabs onValueChange handler below (no useEffect).

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <SettingsIcon className="size-6 text-primary" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and church configuration.
        </p>
      </div>

      <Tabs value={section} onValueChange={(v) => {
        const next = v as typeof section
        if (!canManage && (next === 'users' || next === 'system')) return
        setSection(next)
      }}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="account" className="gap-2"><UserIcon className="size-4" /> My Account</TabsTrigger>
          <TabsTrigger value="church" className="gap-2"><Building2 className="size-4" /> Church Profile</TabsTrigger>
          {canManage && <TabsTrigger value="branches" className="gap-2"><Network className="size-4" /> Branches</TabsTrigger>}
          {canManage && <TabsTrigger value="users" className="gap-2"><UsersIcon className="size-4" /> Users & Roles</TabsTrigger>}
          {canManage && <TabsTrigger value="system" className="gap-2"><Server className="size-4" /> System</TabsTrigger>}
        </TabsList>

        <TabsContent value="account" className="space-y-6">
          <MyAccountSection />
        </TabsContent>
        <TabsContent value="church" className="space-y-6">
          <ChurchProfileSection canManage={canManage} />
        </TabsContent>
        {canManage && (
          <>
            <TabsContent value="branches" className="space-y-6">
              <BranchesSection />
            </TabsContent>
            <TabsContent value="users" className="space-y-6">
              <UsersSection />
            </TabsContent>
            <TabsContent value="system" className="space-y-6">
              <SystemSection />
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* Departments footer link */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Network className="size-5 text-primary" />
            <div>
              <p className="font-medium">Departments</p>
              <p className="text-xs text-muted-foreground">
                Manage ministry departments, units, and team rosters.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setModule('departments')}>Open Departments</Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ============= MY ACCOUNT =============
function MyAccountSection() {
  const { user, organization } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    if (user) {
      // Defer to keep effect body free of synchronous setState.
      void Promise.resolve().then(() => {
        setName(user.name ?? '')
        setPhone(user.phone ?? '')
        setAvatarUrl(user.avatarUrl ?? '')
      })
    }
  }, [user])

  const profileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone: phone || null,
          avatarUrl: avatarUrl || null,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Update failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Profile updated')
      // Reload session to reflect new name everywhere
      fetch('/api/me', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => {
          if (data.user) {
            useAuth.setState({ user: data.user, organization: data.organization })
          }
        })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const passwordMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'changePassword',
          oldPassword,
          newPassword,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Password change failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Password changed')
      setOldPassword(''); setNewPassword(''); setConfirmPassword('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Profile card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserIcon className="size-5" /> My profile</CardTitle>
          <CardDescription>Update your name, phone, and avatar URL.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
              <AvatarFallback className="bg-primary/10 text-primary">
                {initials(name || user?.name || '?')}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{user?.name}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <Badge variant="outline" className={`mt-1 ${roleStyle(role)}`}>{roleLabel(role)}</Badge>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 800 000 0000" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="avatarUrl">Avatar URL</Label>
            <Input id="avatarUrl" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-1"><Mail className="size-3" /> Email and role are managed by administrators and cannot be edited here.</p>
          </div>
          <Button onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending || !name.trim()} className="gap-2">
            <Save className="size-4" /> {profileMutation.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </CardContent>
      </Card>

      {/* Password card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="size-5" /> Change password</CardTitle>
          <CardDescription>For your security, verify your current password before setting a new one.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="oldPassword">Current password</Label>
            <Input id="oldPassword" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            {confirmPassword && newPassword && confirmPassword !== newPassword && (
              <p className="text-xs text-rose-600">Passwords do not match</p>
            )}
          </div>
          <Button
            onClick={() => passwordMutation.mutate()}
            disabled={
              passwordMutation.isPending ||
              !oldPassword ||
              !newPassword ||
              newPassword.length < 6 ||
              newPassword !== confirmPassword
            }
            className="gap-2"
          >
            {passwordMutation.isPending ? 'Updating…' : 'Update password'}
          </Button>
          <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            <Lock className="mr-1 inline size-3" />
            Password changes are audited and visible to administrators in the Audit Log.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ============= CHURCH PROFILE =============
function ChurchProfileSection({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings', 'church'],
    queryFn: async () => {
      const res = await fetch('/api/settings')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load settings')
      }
      return res.json()
    },
  })

  const org = data?.organization
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [timezone, setTimezone] = useState('')
  const [currency, setCurrency] = useState('')
  const [logoUrl, setLogoUrl] = useState('')

  useEffect(() => {
    if (org) {
      void Promise.resolve().then(() => {
        setName(org.name ?? '')
        setEmail(org.email ?? '')
        setPhone(org.phone ?? '')
        setAddress(org.address ?? '')
        setTimezone(org.timezone ?? 'Africa/Lagos')
        setCurrency(org.currency ?? 'NGN')
        setLogoUrl(org.logoUrl ?? '')
      })
    }
  }, [org])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email: email || null, phone: phone || null,
          address: address || null, timezone, currency,
          logoUrl: logoUrl || null,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Update failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Church profile updated')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      // Refresh session so topbar shows updated org name
      fetch('/api/me', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => {
          if (data.organization) {
            useAuth.setState({ organization: data.organization })
          }
        })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />

  return (
    <div className="space-y-6">
      {data?.counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Object.entries(data.counts).map(([k, v]) => (
            <Card key={k}>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">{titleCase(k)}</p>
                <p className="text-xl font-semibold">{v as number}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="size-5" /> Church profile</CardTitle>
          <CardDescription>
            {canManage ? 'Edit your church identity and contact details.' : 'View your church profile.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="orgName">Organization name</Label>
            <Input id="orgName" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="orgEmail">Email</Label>
            <Input id="orgEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canManage} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="orgPhone">Phone</Label>
            <Input id="orgPhone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canManage} />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="orgAddress">Address</Label>
            <Input id="orgAddress" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage} />
          </div>
          <div className="grid gap-2">
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={!canManage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Africa/Lagos">Africa/Lagos</SelectItem>
                <SelectItem value="Africa/Nairobi">Africa/Nairobi</SelectItem>
                <SelectItem value="Africa/Accra">Africa/Accra</SelectItem>
                <SelectItem value="Africa/Johannesburg">Africa/Johannesburg</SelectItem>
                <SelectItem value="America/New_York">America/New_York</SelectItem>
                <SelectItem value="America/Chicago">America/Chicago</SelectItem>
                <SelectItem value="America/Los_Angeles">America/Los_Angeles</SelectItem>
                <SelectItem value="Europe/London">Europe/London</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency} disabled={!canManage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NGN">NGN — Nigerian Naira</SelectItem>
                <SelectItem value="USD">USD — US Dollar</SelectItem>
                <SelectItem value="GBP">GBP — British Pound</SelectItem>
                <SelectItem value="EUR">EUR — Euro</SelectItem>
                <SelectItem value="KES">KES — Kenyan Shilling</SelectItem>
                <SelectItem value="GHS">GHS — Ghanaian Cedi</SelectItem>
                <SelectItem value="ZAR">ZAR — South African Rand</SelectItem>
                <SelectItem value="CAD">CAD — Canadian Dollar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input id="logoUrl" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} disabled={!canManage} placeholder="https://…" />
          </div>
          {canManage && (
            <div className="sm:col-span-2">
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()} className="gap-2">
                <Save className="size-4" /> {mutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ============= BRANCHES =============
function BranchesSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'branches'],
    queryFn: async () => {
      const res = await fetch('/api/settings/branches')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load branches')
      }
      return res.json()
    },
  })
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, location: location || null }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to add branch')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Branch added')
      setAddOpen(false); setName(''); setLocation('')
      queryClient.invalidateQueries({ queryKey: ['settings', 'branches'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const branches = data?.items ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Branches</h2>
          <p className="text-sm text-muted-foreground">Manage church branches and locations.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2"><Plus className="size-4" /> Add Branch</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : branches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Network className="size-10 text-muted-foreground/60" />
            <p className="font-medium">No branches yet</p>
            <p className="text-sm text-muted-foreground">Add your first church branch.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b: any) => (
            <Card key={b.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <Building2 className="size-5 text-primary" />
                  <p className="font-medium">{b.name}</p>
                </div>
                {b.location && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3" /> {b.location}
                  </p>
                )}
                {b.counts && (
                  <div className="flex flex-wrap gap-1 pt-2">
                    <Badge variant="outline" className="text-[10px]">{b.counts.members} members</Badge>
                    <Badge variant="outline" className="text-[10px]">{b.counts.services} services</Badge>
                    <Badge variant="outline" className="text-[10px]">{b.counts.events} events</Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Branch</DialogTitle>
            <DialogDescription>Register a new church branch or campus.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label htmlFor="branchName">Name</Label>
              <Input id="branchName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lekki Campus" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branchLocation">Location</Label>
              <Input id="branchLocation" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Lekki Phase 1, Lagos" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()} className="gap-2">
              {mutation.isPending ? 'Adding…' : 'Add branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============= USERS & ROLES =============
function UsersSection() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState<any | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'users', 'list', search, roleFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '200' })
      if (search) params.set('q', search)
      if (roleFilter) params.set('role', roleFilter)
      const res = await fetch(`/api/settings/users?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load users')
      }
      return res.json()
    },
  })

  const users = data?.items ?? []
  const departments = data?.departments ?? []
  const roles = data?.roles ?? {}

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; role?: string; active?: boolean; departmentId?: string | null }) => {
      const res = await fetch('/api/settings/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Update failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('User updated')
      queryClient.invalidateQueries({ queryKey: ['settings', 'users'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users & Roles</h2>
          <p className="text-sm text-muted-foreground">
            Invite team members and assign roles. Role changes are heavily audited.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2"><Plus className="size-4" /> Add User</Button>
      </div>

      {/* Role distribution */}
      {Object.keys(roles).length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap gap-2 p-3">
            {ROLES.map((r) => (
              <Badge key={r.value} variant="outline" className={r.color}>
                {r.label}: {roles[r.value] ?? 0}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={roleFilter || '__all'} onValueChange={(v) => setRoleFilter(v === '__all' ? '' : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <UsersIcon className="size-10 text-muted-foreground/60" />
            <p className="font-medium">No users found</p>
            <p className="text-sm text-muted-foreground">Try adjusting your search.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-22rem)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Last login</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u: any) => {
                    const isSelf = u.id === currentUser?.id
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="size-8">
                              {u.avatarUrl ? <AvatarImage src={u.avatarUrl} /> : null}
                              <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{initials(u.name)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{u.name} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${roleStyle(u.role)}`}>
                            {roleLabel(u.role)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.department ? (
                            <span className="flex items-center gap-1">
                              <span className="size-2 rounded-full" style={{ background: u.department.color ?? '#888' }} />
                              {u.department.name}
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}
                        </TableCell>
                        <TableCell>
                          {u.active ? (
                            <Badge variant="outline" className="border-emerald-500/30 text-emerald-700"><CheckCircle2 className="mr-1 size-3" /> Active</Badge>
                          ) : (
                            <Badge variant="outline" className="border-rose-500/30 text-rose-700"><XCircle className="mr-1 size-3" /> Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-7">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditUser(u); setEditOpen(true) }}>
                                <Pencil className="mr-2 size-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel className="text-xs text-muted-foreground">Quick role</DropdownMenuLabel>
                              {ROLES.map((r) => (
                                <DropdownMenuItem
                                  key={r.value}
                                  disabled={r.value === u.role || isSelf}
                                  onClick={() => updateMutation.mutate({ id: u.id, role: r.value })}
                                >
                                  {r.label}
                                  {r.value === u.role && <CheckCircle2 className="ml-auto size-3" />}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={isSelf}
                                onClick={() => updateMutation.mutate({ id: u.id, active: !u.active })}
                              >
                                <Power className="mr-2 size-4" />
                                {u.active ? 'Deactivate' : 'Activate'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add User Dialog */}
      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        departments={departments}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['settings', 'users'] })}
      />

      {/* Edit User Dialog */}
      <EditUserDialog
        user={editUser}
        open={editOpen}
        onOpenChange={setEditOpen}
        departments={departments}
        currentUserId={currentUser?.id ?? ''}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['settings', 'users'] })}
      />
    </div>
  )
}

function AddUserDialog({
  open,
  onOpenChange,
  departments,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  departments: any[]
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('member')
  const [phone, setPhone] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [active, setActive] = useState(true)

  useEffect(() => {
    if (!open) {
      void Promise.resolve().then(() => {
        setName(''); setEmail(''); setPassword(''); setRole('member')
        setPhone(''); setDepartmentId(''); setActive(true)
      })
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, password, role,
          phone: phone || null,
          departmentId: departmentId || null,
          active,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to add user')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('User created')
      onOpenChange(false)
      onSaved()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>
            Create a new team member account. The user can sign in immediately with the password you set.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-password">Initial password</Label>
            <Input id="u-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-phone">Phone</Label>
            <Input id="u-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>Department (optional)</Label>
            <Select value={departmentId || '__none'} onValueChange={(v) => setDepartmentId(v === '__none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="No department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No department</SelectItem>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch checked={active} onCheckedChange={setActive} id="u-active" />
            <Label htmlFor="u-active" className="text-sm">Active (user can sign in)</Label>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim() || !email.trim() || password.length < 6} className="gap-2">
            {mutation.isPending ? 'Creating…' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({
  user,
  open,
  onOpenChange,
  departments,
  currentUserId,
  onSaved,
}: {
  user: any | null
  open: boolean
  onOpenChange: (v: boolean) => void
  departments: any[]
  currentUserId: string
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('member')
  const [phone, setPhone] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [active, setActive] = useState(true)
  const isSelf = user?.id === currentUserId

  useEffect(() => {
    if (user) {
      void Promise.resolve().then(() => {
        setName(user.name ?? '')
        setRole(user.role ?? 'member')
        setPhone(user.phone ?? '')
        setDepartmentId(user.departmentId ?? '')
        setActive(user.active ?? true)
      })
    }
  }, [user])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          name,
          role,
          phone: phone || null,
          departmentId: departmentId || null,
          active,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to update user')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('User updated')
      onOpenChange(false)
      onSaved()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="e-name">Full name</Label>
            <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole} disabled={isSelf}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-xs text-amber-600">
                <Lock className="mr-1 inline size-3" /> You cannot change your own role. Ask another admin.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="e-phone">Phone</Label>
            <Input id="e-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Department</Label>
            <Select value={departmentId || '__none'} onValueChange={(v) => setDepartmentId(v === '__none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="No department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No department</SelectItem>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} id="e-active" disabled={isSelf} />
            <Label htmlFor="e-active" className="text-sm">Active</Label>
            {isSelf && (
              <p className="text-xs text-amber-600">(cannot change own status)</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()} className="gap-2">
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============= SYSTEM =============
function SystemSection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="size-5" /> Integration status</CardTitle>
          <CardDescription>Provider adapters for outbound communications and payments.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <IntegrationCard icon={Mail} name="Email (SMTP)" status="Not configured" />
          <IntegrationCard icon={Coins} name="Payments (Paystack/Stripe)" status="Not configured" />
          <IntegrationCard icon={Cloud} name="Storage (S3/Local)" status="Local sandbox" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="size-5" /> Data retention</CardTitle>
          <CardDescription>How long ChurchOS retains operational data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b pb-2">
            <span>Audit logs</span>
            <Badge variant="outline">7 years (compliance)</Badge>
          </div>
          <div className="flex items-center justify-between border-b pb-2">
            <span>Attendance records</span>
            <Badge variant="outline">Indefinite</Badge>
          </div>
          <div className="flex items-center justify-between border-b pb-2">
            <span>Member records</span>
            <Badge variant="outline">Indefinite (deletable on request)</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Pastoral case notes</span>
            <Badge variant="outline">Indefinite (restricted access)</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-rose-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
            <AlertTriangle className="size-5" /> Danger zone
          </CardTitle>
          <CardDescription>Destructive actions require re-authentication.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-col gap-2 rounded-md border border-rose-500/20 bg-rose-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Deactivate my account</p>
              <p className="text-xs text-muted-foreground">
                Disables your login. Another administrator must re-enable access for you.
              </p>
            </div>
            <Button variant="outline" disabled className="border-rose-500/40 text-rose-700">
              Requires re-authentication
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            <Info className="mr-1 inline size-3" />
            For data export requests, contact your church administrator or use the per-module Export buttons.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationCard({ icon: Icon, name, status }: { icon: any; name: string; status: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2">
        <div className="rounded-md bg-muted p-1.5">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{status}</p>
        </div>
      </div>
    </div>
  )
}
