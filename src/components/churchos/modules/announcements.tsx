'use client'

// ChurchOS — Communications / Announcements module (Module 8)
// Manages announcement records + in-app notification center entries.
// Real message delivery (email/SMS/WhatsApp) is NOT wired — provider adapters are stubs.
import { useState, useMemo, useCallback, useEffect } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Megaphone, Bell, Plus, MoreHorizontal, Pencil, Trash2, Pin, RefreshCw,
  AlertTriangle, Search, X, Mail, Send, CheckCheck, Info, Globe,
} from 'lucide-react'

// ---------- types ----------
interface Announcement {
  id: string
  title: string
  body: string
  audience: string
  departmentId?: string | null
  published: boolean
  pinned: boolean
  publishedAt: string
  createdAt: string
  authorId?: string | null
  notificationsQueued?: number
}
interface AnnouncementListResponse {
  items: Announcement[]
  total: number
  stats: { total: number; pinned: number; published: number; drafts: number }
}
interface NotificationItem {
  id: string
  title: string
  message: string
  link?: string | null
  read: boolean
  createdAt: string
}
interface NotificationListResponse {
  items: NotificationItem[]
  total: number
  page: number
  pageSize: number
  unread: number
}
interface DepartmentRef { id: string; name: string }

// ---------- helpers ----------
const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'Everyone (all members)' },
  { value: 'members', label: 'Members only' },
  { value: 'department', label: 'Specific department' },
  { value: 'leaders', label: 'Leaders (pastors/admins/dept heads)' },
]
const AUDIENCE_BADGE_STYLES: Record<string, string> = {
  all: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  members: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300',
  department: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300',
  leaders: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
}

// ---------- main module ----------
export default function AnnouncementsModule() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'announcements', 'create')
  const canUpdate = can(role, 'announcements', 'update')
  const canDelete = can(role, 'announcements', 'delete')

  const [tab, setTab] = useState<'announcements' | 'notifications'>('announcements')
  const [audienceFilter, setAudienceFilter] = useState('')
  const [search, setSearch] = useState('')

  // Add/Edit dialog state
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteTitle, setDeleteTitle] = useState('')

  const queryKey = useMemo(
    () => ['announcements', 'list', audienceFilter, search] as const,
    [audienceFilter, search],
  )

  const { data, isLoading, isError, refetch } = useQuery<AnnouncementListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (audienceFilter) params.set('audience', audienceFilter)
      if (search) params.set('q', search)
      const res = await fetch(`/api/announcements?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load announcements')
      }
      return res.json()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/announcements/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Announcement deleted')
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      setDeleteId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openEdit = useCallback((id: string) => {
    setEditId(id)
    setEditOpen(true)
  }, [])
  const openDelete = useCallback((id: string, title: string) => {
    setDeleteId(id)
    setDeleteTitle(title)
  }, [])

  const stats = data?.stats ?? { total: 0, pinned: 0, published: 0, drafts: 0 }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
              <Megaphone className="size-4" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Communications</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage church announcements and in-app notifications.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4 mr-1.5" /> New Announcement
            </Button>
          )}
        </div>
      </div>

      {/* Delivery notice banner */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="size-9 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400 grid place-items-center shrink-0">
            <Info className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Message delivery (email/SMS/WhatsApp) requires configured provider credentials.
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Announcements create in-app notifications only. External provider adapters are stubs.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'announcements' | 'notifications')}>
        <TabsList>
          <TabsTrigger value="announcements">
            <Megaphone className="size-3.5 mr-1.5" /> Announcements
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="size-3.5 mr-1.5" /> Notifications
          </TabsTrigger>
        </TabsList>

        {/* ANNOUNCEMENTS TAB */}
        <TabsContent value="announcements" className="space-y-4 mt-4">
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatMini icon={Megaphone} label="Total" value={stats.total} accent="bg-primary/10 text-primary" />
            <StatMini icon={Pin} label="Pinned" value={stats.pinned} accent="bg-amber-500/10 text-amber-600" />
            <StatMini icon={Send} label="Published" value={stats.published} accent="bg-emerald-500/10 text-emerald-600" />
            <StatMini icon={AlertTriangle} label="Drafts" value={stats.drafts} accent="bg-rose-500/10 text-rose-600" />
          </div>

          {/* Filters */}
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search announcements…"
                    className="pl-9"
                    aria-label="Search announcements"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
                      aria-label="Clear search"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                <Select value={audienceFilter} onValueChange={(v) => setAudienceFilter(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-full md:w-52" aria-label="Filter by audience">
                    <SelectValue placeholder="All audiences" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All audiences</SelectItem>
                    {AUDIENCE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label.split('(')[0].trim()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => { setAudienceFilter(''); setSearch('') }}>
                  <RefreshCw className="size-3.5 mr-1.5" /> Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* List */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-44 w-full" />
              ))}
            </div>
          ) : isError ? (
            <Card>
              <CardContent className="p-10 text-center">
                <AlertTriangle className="size-8 text-destructive mx-auto mb-3" />
                <p className="text-sm font-medium">Failed to load announcements</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                  <RefreshCw className="size-3.5 mr-1.5" /> Retry
                </Button>
              </CardContent>
            </Card>
          ) : !data || data.items.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="size-12 rounded-full bg-muted grid place-items-center mx-auto mb-3">
                  <Megaphone className="size-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">No announcements found</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  {search || audienceFilter
                    ? 'Try adjusting your filters.'
                    : 'Create your first announcement to share with the church.'}
                </p>
                {canCreate && (
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="size-4 mr-1.5" /> New Announcement
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.items.map((a) => (
                <AnnouncementCard
                  key={a.id}
                  a={a}
                  canUpdate={canUpdate}
                  canDelete={canDelete}
                  onEdit={() => openEdit(a.id)}
                  onDelete={() => openDelete(a.id, a.title)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* NOTIFICATIONS TAB */}
        <TabsContent value="notifications" className="mt-4">
          <NotificationsPanel />
        </TabsContent>
      </Tabs>

      {/* Add dialog */}
      {addOpen && (
        <AnnouncementFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false)
            queryClient.invalidateQueries({ queryKey: ['announcements'] })
          }}
        />
      )}

      {/* Edit dialog */}
      {editOpen && editId && (
        <AnnouncementFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          editId={editId}
          onSaved={() => {
            setEditOpen(false)
            setEditId(null)
            queryClient.invalidateQueries({ queryKey: ['announcements'] })
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &quot;{deleteTitle}&quot; and its in-app notifications.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- announcement card ----------
function AnnouncementCard({
  a, canUpdate, canDelete, onEdit, onDelete,
}: {
  a: Announcement
  canUpdate: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card className="border-border/60 hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {a.pinned && (
              <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
                <Pin className="size-3" /> Pinned
              </Badge>
            )}
            <Badge variant="outline" className={AUDIENCE_BADGE_STYLES[a.audience] ?? ''}>
              {a.audience === 'all' && <Globe className="size-3 mr-1" />}
              {titleCase(a.audience)}
            </Badge>
            {!a.published && (
              <Badge variant="outline" className="bg-muted text-muted-foreground">Draft</Badge>
            )}
          </div>
          {(canUpdate || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 shrink-0">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate && (
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="size-3.5 mr-2" /> Edit
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    {canUpdate && <DropdownMenuSeparator />}
                    <DropdownMenuItem onClick={onDelete} className="text-destructive">
                      <Trash2 className="size-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <h3 className="font-semibold text-base leading-snug mb-1.5">{a.title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">{a.body}</p>
        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border/60 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Send className="size-3" /> {a.published ? formatDate(a.publishedAt) : 'Draft'}
          </span>
          {a.notificationsQueued !== undefined && a.notificationsQueued > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Bell className="size-3" /> {a.notificationsQueued} notified
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- form dialog (create/edit) ----------
function AnnouncementFormDialog({
  open, onOpenChange, editId, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editId?: string
  onSaved: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState('all')
  const [departmentId, setDepartmentId] = useState('')
  const [pinned, setPinned] = useState(false)
  const [published, setPublished] = useState(true)
  const [departments, setDepartments] = useState<DepartmentRef[]>([])
  const [loading, setLoading] = useState(false)

  // Load existing announcement when editing
  useQuery({
    queryKey: ['announcement', editId] as const,
    queryFn: async () => {
      if (!editId) return null
      const res = await fetch(`/api/announcements/${editId}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load')
      }
      const data: Announcement = await res.json()
      setTitle(data.title)
      setBody(data.body)
      setAudience(data.audience)
      setDepartmentId(data.departmentId ?? '')
      setPinned(data.pinned)
      setPublished(data.published)
      return data
    },
    enabled: !!editId && open,
  })

  // Load departments list (for audience=department)
  useQuery({
    queryKey: ['departments', 'list', 'short'] as const,
    queryFn: async () => {
      const res = await fetch('/api/departments?pageSize=100')
      if (!res.ok) return []
      const data = await res.json()
      const list = (data.items ?? []).map((d: any) => ({ id: d.id, name: d.name }))
      setDepartments(list)
      return list
    },
    enabled: open,
  })

  // Reset when closed
  useEffect(() => {
    if (!open && !editId) {
      setTitle('')
      setBody('')
      setAudience('all')
      setDepartmentId('')
      setPinned(false)
      setPublished(true)
    }
  }, [open, editId])

  const isEdit = !!editId

  const save = async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    if (!body.trim()) {
      toast.error('Message body is required')
      return
    }
    if (audience === 'department' && !departmentId) {
      toast.error('Please select a department')
      return
    }
    setLoading(true)
    try {
      const payload: any = {
        title: title.trim(),
        body: body.trim(),
        audience,
        pinned,
        published,
      }
      if (audience === 'department') payload.departmentId = departmentId
      const url = isEdit ? `/api/announcements/${editId}` : '/api/announcements'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Save failed')
      }
      const data = await res.json()
      const queued = data.notificationsQueued ?? 0
      toast.success(
        isEdit
          ? 'Announcement updated'
          : `Announcement created${queued > 0 ? ` — ${queued} notification${queued === 1 ? '' : 's'} queued` : ''}`,
      )
      onSaved()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Announcement' : 'New Announcement'}</DialogTitle>
          <DialogDescription>
            Compose a church announcement. In-app notifications will be queued for the selected audience.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="ann-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sunday Service Time Change"
              className="mt-1.5"
              maxLength={140}
            />
          </div>
          <div>
            <Label htmlFor="ann-body">Message <span className="text-destructive">*</span></Label>
            <Textarea
              id="ann-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the announcement message…"
              rows={5}
              className="mt-1.5"
              maxLength={4000}
            />
            <p className="text-xs text-muted-foreground mt-1">{body.length}/4000 characters</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ann-audience">Audience</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger id="ann-audience" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {audience === 'department' && (
              <div>
                <Label htmlFor="ann-dept">Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger id="ann-dept" className="mt-1.5">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div>
                <Label htmlFor="ann-pinned" className="font-medium">Pin to top</Label>
                <p className="text-xs text-muted-foreground">Highlight on the announcements list</p>
              </div>
              <Switch id="ann-pinned" checked={pinned} onCheckedChange={setPinned} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div>
                <Label htmlFor="ann-published" className="font-medium">Published</Label>
                <p className="text-xs text-muted-foreground">Publish immediately to audience</p>
              </div>
              <Switch id="ann-published" checked={published} onCheckedChange={setPublished} />
            </div>
          </div>
          <div className="rounded-md bg-muted/40 border border-border/60 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <Mail className="size-3.5 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-foreground">Provider status:</span>{' '}
              Email, SMS and WhatsApp adapters are not configured — only in-app notifications will be queued.
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save changes' : 'Create & queue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- notifications panel ----------
function NotificationsPanel() {
  const queryClient = useQueryClient()
  const [onlyUnread, setOnlyUnread] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery<NotificationListResponse>({
    queryKey: ['notifications', 'list', onlyUnread] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '50' })
      if (onlyUnread) params.set('unread', '1')
      const res = await fetch(`/api/notifications?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load notifications')
      }
      return res.json()
    },
  })

  const markAllRead = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(`Marked ${data.updated ?? 0} notifications as read`)
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const markOneRead = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unread = data?.unread ?? 0

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="size-4" /> Your Notifications
              {unread > 0 && (
                <Badge className="bg-primary text-primary-foreground">{unread} unread</Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              In-app notifications sent to you from announcements and other modules.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={onlyUnread ? 'default' : 'outline'}
              onClick={() => setOnlyUnread((v) => !v)}
            >
              {onlyUnread ? 'Showing unread' : 'Unread only'}
            </Button>
            {unread > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="size-3.5 mr-1.5" /> Mark all read
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center">
            <AlertTriangle className="size-7 text-destructive mx-auto mb-2" />
            <p className="text-sm font-medium">Failed to load notifications</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              <RefreshCw className="size-3.5 mr-1.5" /> Retry
            </Button>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-10 text-center">
            <div className="size-12 rounded-full bg-muted grid place-items-center mx-auto mb-3">
              <Bell className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {onlyUnread ? 'No unread notifications' : 'No notifications yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {onlyUnread ? 'You are all caught up.' : 'New announcements and activity will appear here.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 max-h-[600px] overflow-y-auto custom-scroll -mx-2">
            {data.items.map((n) => (
              <li
                key={n.id}
                className={`flex items-start gap-3 px-2 py-3 transition-colors ${n.read ? 'opacity-70' : 'bg-primary/5'}`}
              >
                <div className={`size-2 rounded-full mt-2 shrink-0 ${n.read ? 'bg-muted-foreground/40' : 'bg-primary'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug">{n.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                  <p className="text-xs text-muted-foreground/80 mt-1">{relativeTime(n.createdAt)} · {formatDateTime(n.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!n.read && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => markOneRead.mutate(n.id)}
                      disabled={markOneRead.isPending}
                    >
                      <CheckCheck className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- shared mini stat ----------
function StatMini({ icon: Icon, label, value, accent }: {
  icon: any
  label: string
  value: number
  accent: string
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`size-9 rounded-lg grid place-items-center ${accent}`}>
          <Icon className="size-4" />
        </div>
        <div>
          <p className="text-xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}
