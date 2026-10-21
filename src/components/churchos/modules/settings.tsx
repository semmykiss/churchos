'use client'

// ChurchOS — Settings & System Admin module (Module 16) + Profile/My Account
// Sections: My Account | Church Profile | Branches | Users & Roles | System
// - All authenticated roles see My Account + read-only Church Profile.
// - Only settings:manage (church_admin, super_admin) can edit + see Users/Branches/System.
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { can } from '@/lib/permissions'
import { relativeTime, titleCase } from '@/lib/format'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  Settings as SettingsIcon, User as UserIcon, Building2, Users as UsersIcon,
  Save, Plus, MoreHorizontal, Pencil, Power, Lock, AlertTriangle,
  KeyRound, Mail, MapPin, CheckCircle2, XCircle, Database, Server, Cloud,
  Info, Network, Coins,
} from 'lucide-react'
import {
  PageHeader, EmptyState, SectionCard, Toolbar, TableSkeleton,
} from '@/components/churchos/ui'

const ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300' },
  { value: 'church_admin', label: 'Church Admin', color: 'bg-primary/10 text-primary border-primary/20' },
  { value: 'pastor', label: 'Pastor', color: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300' },
  { value: 'finance_officer', label: 'Finance Officer', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300' },
  { value: 'department_head', label: 'Department Head', color: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300' },
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
  const [section, setSection] = useState<'account' | 'church' | 'branches' | 'users' | 'system'>('account')

  // If a non-admin (member/guest/assistant) opens Settings, default them to My Account.
  // Guard is applied at the Tabs onValueChange handler below (no useEffect).

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        eyebrow="Configuration"
        description="Manage your account and church configuration."
        icon={SettingsIcon}
      />

      <Tabs value={section} onValueChange={(v) => {
        const next = v as typeof section
        if (!canManage && (next === 'users' || next === 'system')) return
        setSection(next)
      }}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="account" className="gap-1.5"><UserIcon className="size-4" /> My Account</TabsTrigger>
          <TabsTrigger value="church" className="gap-1.5"><Building2 className="size-4" /> Church Profile</TabsTrigger>
          {canManage && <TabsTrigger value="branches" className="gap-1.5"><Network className="size-4" /> Branches</TabsTrigger>}
          {canManage && <TabsTrigger value="users" className="gap-1.5"><UsersIcon className="size-4" /> Users & Roles</TabsTrigger>}
          {canManage && <TabsTrigger value="system" className="gap-1.5"><Server className="size-4" /> System</TabsTrigger>}
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
      <Card className="border-border/60 hover:shadow-premium transition-shadow">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center ring-1 ring-inset ring-primary/15">
              <Network className="size-5" />
            </div>
            <div>
              <p className="font-medium">Departments</p>
              <p className="text-xs text-muted-foreground">
                Manage ministry departments, units, and team rosters.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setModule('departments')} className="gap-2">
            Open Departments
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ============= MY ACCOUNT =============
function MyAccountSection() {
  const { user, organization } = useAuth()
  const role = user?.role ?? 'member'
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
      <SectionCard
        title="My profile"
        description="Update your name, phone, and avatar URL."
        action={<UserIcon className="size-4 text-muted-foreground" />}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={name || user?.name || '?'} /> : null}
              <AvatarFallback className="bg-primary/10 text-primary">
                {initials(name || user?.name || '?')}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{user?.name}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <Badge variant="outline" className={`mt-1 text-[11px] font-medium ${roleStyle(role)}`}>{roleLabel(role)}</Badge>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name" className="text-sm font-medium">Full name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phone" className="text-sm font-medium">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 800 000 0000" className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="avatarUrl" className="text-sm font-medium">Avatar URL</Label>
            <Input id="avatarUrl" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" className="h-9" />
          </div>
          <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5"><Mail className="size-3" /> Email and role are managed by administrators and cannot be edited here.</p>
          </div>
          <Button onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending || !name.trim()} className="gap-2">
            <Save className="size-4" /> {profileMutation.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </SectionCard>

      {/* Password card */}
      <SectionCard
        title="Change password"
        description="For your security, verify your current password before setting a new one."
        action={<KeyRound className="size-4 text-muted-foreground" />}
      >
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="oldPassword" className="text-sm font-medium">Current password</Label>
            <Input id="oldPassword" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="newPassword" className="text-sm font-medium">New password</Label>
            <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm new password</Label>
            <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="h-9" />
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
          <p className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-700 dark:text-amber-300">
            <Lock className="mr-1 inline size-3" />
            Password changes are audited and visible to administrators in the Audit Log.
          </p>
        </div>
      </SectionCard>
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
            <Card key={k} className="border-border/60">
              <CardContent className="p-3.5">
                <p className="text-xs text-muted-foreground">{titleCase(k)}</p>
                <p className="text-xl font-semibold nums mt-0.5">{v as number}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SectionCard
        title="Church profile"
        description={canManage ? 'Edit your church identity and contact details.' : 'View your church profile.'}
        action={<Building2 className="size-4 text-muted-foreground" />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="orgName" className="text-sm font-medium">Organization name</Label>
            <Input id="orgName" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="orgEmail" className="text-sm font-medium">Email</Label>
            <Input id="orgEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canManage} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="orgPhone" className="text-sm font-medium">Phone</Label>
            <Input id="orgPhone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canManage} className="h-9" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="orgAddress" className="text-sm font-medium">Address</Label>
            <Input id="orgAddress" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={!canManage}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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
            <Label className="text-sm font-medium">Currency</Label>
            <Select value={currency} onValueChange={setCurrency} disabled={!canManage}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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
            <Label htmlFor="logoUrl" className="text-sm font-medium">Logo URL</Label>
            <Input id="logoUrl" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} disabled={!canManage} placeholder="https://…" className="h-9" />
          </div>
          {canManage && (
            <div className="sm:col-span-2">
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()} className="gap-2">
                <Save className="size-4" /> {mutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </div>
      </SectionCard>
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
      <SectionCard
        title="Branches"
        description="Manage church branches and locations."
        action={
          <Button onClick={() => setAddOpen(true)} size="sm" className="gap-2">
            <Plus className="size-4" /> Add Branch
          </Button>
        }
      >
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : branches.length === 0 ? (
          <EmptyState
            icon={Network}
            title="No branches yet"
            description="Add your first church branch."
            action={
              <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                <Plus className="size-4" /> Add Branch
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((b: any) => (
              <Card key={b.id} className="border-border/60 hover:shadow-premium-md hover:-translate-y-0.5 transition-all">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center ring-1 ring-inset ring-primary/15">
                      <Building2 className="size-4" />
                    </div>
                    <p className="font-medium">{b.name}</p>
                  </div>
                  {b.location && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3" /> {b.location}
                    </p>
                  )}
                  {b.counts && (
                    <div className="flex flex-wrap gap-1 pt-2">
                      <Badge variant="outline" className="text-[10px] font-medium"><span className="nums">{b.counts.members}</span> members</Badge>
                      <Badge variant="outline" className="text-[10px] font-medium"><span className="nums">{b.counts.services}</span> services</Badge>
                      <Badge variant="outline" className="text-[10px] font-medium"><span className="nums">{b.counts.events}</span> events</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </SectionCard>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Branch</DialogTitle>
            <DialogDescription>Register a new church branch or campus.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label htmlFor="branchName" className="text-sm font-medium">Name</Label>
              <Input id="branchName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lekki Campus" className="h-9" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branchLocation" className="text-sm font-medium">Location</Label>
              <Input id="branchLocation" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Lekki Phase 1, Lagos" className="h-9" />
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
      <SectionCard
        title="Users & Roles"
        description="Invite team members and assign roles. Role changes are heavily audited."
        action={
          <Button onClick={() => setAddOpen(true)} size="sm" className="gap-2">
            <Plus className="size-4" /> Invite User
          </Button>
        }
      >
        <div className="space-y-4">
          {/* Role distribution */}
          {Object.keys(roles).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <Badge key={r.value} variant="outline" className={`text-[10px] font-medium ${r.color}`}>
                  {r.label}: <span className="nums ml-0.5">{roles[r.value] ?? 0}</span>
                </Badge>
              ))}
            </div>
          )}

          {/* Filters */}
          <Toolbar>
            <Input
              placeholder="Search by name, email, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 max-w-xs"
              aria-label="Search users"
            />
            <Select value={roleFilter || '__all'} onValueChange={(v) => setRoleFilter(v === '__all' ? '' : v)}>
              <SelectTrigger className="w-full md:w-48 h-9" aria-label="Filter by role"><SelectValue placeholder="All roles" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Toolbar>

          {isLoading ? (
            <TableSkeleton rows={6} />
          ) : users.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No users found"
              description="Try adjusting your search."
            />
          ) : (
            <Card className="border-border/60">
              <CardContent className="p-0">
                <div className="max-h-[calc(100vh-26rem)] overflow-auto scroll-thin">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow className="bg-muted/30 hover:bg-muted/30 border-border/60">
                        <TableHead className="pl-4 text-xs uppercase tracking-wide text-muted-foreground font-medium">User</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Role</TableHead>
                        <TableHead className="hidden md:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Department</TableHead>
                        <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wide text-muted-foreground font-medium">Last login</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Status</TableHead>
                        <TableHead className="pr-4 text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u: any) => {
                        const isSelf = u.id === currentUser?.id
                        return (
                          <TableRow key={u.id} className="hover:bg-muted/40 border-border/60">
                            <TableCell className="pl-4">
                              <div className="flex items-center gap-2.5">
                                <Avatar className="size-8">
                                  {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt={u.name} /> : null}
                                  <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{initials(u.name)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="font-medium text-sm">{u.name} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}</p>
                                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] font-medium ${roleStyle(u.role)}`}>
                                {roleLabel(u.role)}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {u.department ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="size-2 rounded-full" style={{ background: u.department.color ?? '#888' }} />
                                  {u.department.name}
                                </span>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-xs text-muted-foreground nums">
                              {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}
                            </TableCell>
                            <TableCell>
                              {u.active ? (
                                <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 text-[10px] font-medium"><CheckCircle2 className="mr-1 size-3" /> Active</Badge>
                              ) : (
                                <Badge variant="outline" className="border-rose-500/30 text-rose-700 text-[10px] font-medium"><XCircle className="mr-1 size-3" /> Inactive</Badge>
                              )}
                            </TableCell>
                            <TableCell className="pr-4 text-right">
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
        </div>
      </SectionCard>

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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>
            Create a new team member account. The user can sign in immediately with the password you set.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2 max-h-[70vh] overflow-y-auto scroll-thin pr-1">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="u-name" className="text-sm font-medium">Full name</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-email" className="text-sm font-medium">Email</Label>
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-password" className="text-sm font-medium">Initial password</Label>
            <Input id="u-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-phone" className="text-sm font-medium">Phone</Label>
            <Input id="u-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" className="h-9" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label className="text-sm font-medium">Department (optional)</Label>
            <Select value={departmentId || '__none'} onValueChange={(v) => setDepartmentId(v === '__none' ? '' : v)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="No department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No department</SelectItem>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 rounded-xl border border-border/60 p-3">
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Edit {user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2 max-h-[70vh] overflow-y-auto scroll-thin pr-1">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="e-name" className="text-sm font-medium">Full name</Label>
            <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Role</Label>
            <Select value={role} onValueChange={setRole} disabled={isSelf}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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
            <Label htmlFor="e-phone" className="text-sm font-medium">Phone</Label>
            <Input id="e-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Department</Label>
            <Select value={departmentId || '__none'} onValueChange={(v) => setDepartmentId(v === '__none' ? '' : v)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="No department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No department</SelectItem>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border/60 p-3">
            <Switch checked={active} onCheckedChange={setActive} id="e-active" disabled={isSelf} />
            <Label htmlFor="e-active" className="text-sm">Active</Label>
            {isSelf && (
              <p className="text-xs text-amber-600 ml-auto">(cannot change own status)</p>
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
      <SectionCard
        title="Integration status"
        description="Provider adapters for outbound communications and payments."
        action={<Server className="size-4 text-muted-foreground" />}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <IntegrationCard icon={Mail} name="Email (SMTP)" status="Not configured" />
          <IntegrationCard icon={Coins} name="Payments (Paystack/Stripe)" status="Not configured" />
          <IntegrationCard icon={Cloud} name="Storage (S3/Local)" status="Local sandbox" />
        </div>
      </SectionCard>

      <SectionCard
        title="Data retention"
        description="How long ChurchOS retains operational data."
        action={<Database className="size-4 text-muted-foreground" />}
      >
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <span>Audit logs</span>
            <Badge variant="outline" className="text-[10px] font-medium">7 years (compliance)</Badge>
          </div>
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <span>Attendance records</span>
            <Badge variant="outline" className="text-[10px] font-medium">Indefinite</Badge>
          </div>
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <span>Member records</span>
            <Badge variant="outline" className="text-[10px] font-medium">Indefinite (deletable on request)</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Pastoral case notes</span>
            <Badge variant="outline" className="text-[10px] font-medium">Indefinite (restricted access)</Badge>
          </div>
        </div>
      </SectionCard>

      <Card className="border-rose-500/30">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="size-9 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300 grid place-items-center ring-1 ring-inset ring-rose-500/15">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">Danger zone</h3>
              <p className="text-xs text-muted-foreground">Destructive actions require re-authentication.</p>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex flex-col gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Deactivate my account</p>
                <p className="text-xs text-muted-foreground">
                  Disables your login. Another administrator must re-enable access for you.
                </p>
              </div>
              <Button variant="outline" disabled size="sm" className="border-rose-500/40 text-rose-700">
                Requires re-authentication
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <Info className="mr-1 inline size-3" />
              For data export requests, contact your church administrator or use the per-module Export buttons.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationCard({ icon: Icon, name, status }: { icon: any; name: string; status: string }) {
  return (
    <div className="rounded-xl border border-border/60 p-3.5 hover:shadow-premium transition-shadow">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-muted p-1.5 ring-1 ring-inset ring-black/5 dark:ring-white/10">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-xs text-muted-foreground">{status}</p>
        </div>
      </div>
    </div>
  )
}
