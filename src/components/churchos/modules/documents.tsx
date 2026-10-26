'use client'

// ChurchOS — Document Library module (Module 11)
// Files stored with access-level permissions; uploads validated (type/size) and saved to local /home/z/my-project/upload
import { useState, useMemo, useEffect } from 'react'
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
import { Progress } from '@/components/ui/progress'
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
  FileText, Plus, MoreHorizontal, Pencil, Trash2, RefreshCw, AlertTriangle,
  Search, X, Download, Upload, File, FileImage, FileSpreadsheet, Presentation,
  FileType, Info, ShieldCheck, Lock,
} from 'lucide-react'
import {
  PageHeader, EmptyState, Toolbar, SectionCard,
} from '@/components/churchos/ui'

// ---------- types ----------
interface DocumentItem {
  id: string
  title: string
  description?: string | null
  category: string
  accessLevel: string
  fileUrl?: string | null
  fileName?: string | null
  version: number
  createdAt: string
  updatedAt: string
  downloadable: boolean
}
interface DocumentListResponse {
  items: DocumentItem[]
  total: number
  stats: { total: number; byCategory: Record<string, number> }
}

const CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'policy', label: 'Policy' },
  { value: 'template', label: 'Template' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'form', label: 'Form' },
  { value: 'report', label: 'Report' },
  { value: 'resource', label: 'Resource' },
]
const ACCESS_LEVELS = [
  { value: '', label: 'All access levels' },
  { value: 'public', label: 'Public' },
  { value: 'members', label: 'Members' },
  { value: 'staff', label: 'Staff' },
  { value: 'leaders', label: 'Leaders' },
  { value: 'finance', label: 'Finance' },
  { value: 'pastoral', label: 'Pastoral' },
]
// Access-level colors (per Task 10-B spec, emerald/teal palette):
// public=emerald, members=teal, staff=violet, leaders=amber, finance=teal, pastoral=rose
const ACCESS_LEVEL_STYLES: Record<string, string> = {
  public: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  members: 'bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300',
  staff: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300',
  leaders: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  finance: 'bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300',
  pastoral: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300',
}
const CATEGORY_STYLES: Record<string, string> = {
  policy: 'bg-primary/10 text-primary border-primary/20',
  template: 'bg-teal-500/10 text-teal-700 border-teal-500/20 dark:text-teal-300',
  minutes: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  form: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  report: 'bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300',
  resource: 'bg-muted text-muted-foreground border-border',
}

function FileIcon({ filename, className }: { filename?: string | null; className?: string }) {
  const ext = (filename ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return <FileImage className={className} />
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <FileSpreadsheet className={className} />
  if (['pptx', 'ppt'].includes(ext)) return <Presentation className={className} />
  if (ext === 'txt') return <FileType className={className} />
  return <File className={className} />
}

// ---------- main module ----------
export default function DocumentsModule() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const role = user?.role ?? 'member'

  const canCreate = can(role, 'documents', 'create')
  const canUpdate = can(role, 'documents', 'update')
  const canDelete = can(role, 'documents', 'delete')

  const [categoryFilter, setCategoryFilter] = useState('')
  const [accessFilter, setAccessFilter] = useState('')
  const [search, setSearch] = useState('')

  // Dialogs
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteTitle, setDeleteTitle] = useState('')

  const queryKey = useMemo(
    () => ['documents', 'list', categoryFilter, accessFilter, search] as const,
    [categoryFilter, accessFilter, search],
  )

  const { data, isLoading, isError, refetch } = useQuery<DocumentListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (categoryFilter) params.set('category', categoryFilter)
      if (accessFilter) params.set('accessLevel', accessFilter)
      if (search) params.set('q', search)
      const res = await fetch(`/api/documents?${params}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load documents')
      }
      return res.json()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Document deleted')
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      setDeleteId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openEdit = (id: string) => {
    setEditId(id)
    setEditOpen(true)
  }
  const openDelete = (id: string, title: string) => {
    setDeleteId(id)
    setDeleteTitle(title)
  }

  const download = async (doc: DocumentItem) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}?download=1`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Download failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.fileName ?? doc.title
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Download started')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Download failed')
    }
  }

  const byCategory = data?.stats.byCategory ?? {}

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Resources"
        title="Document Library"
        description="Policies, templates, minutes, forms, reports and resources — with role-based access control."
        icon={FileText}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-2">
              <Upload className="size-4" /> Upload Document
            </Button>
          ) : undefined
        }
      />

      {/* Notice — file validation + access-level policy */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/15 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/20">
            <ShieldCheck className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Files are stored with access-level permissions.</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              This sandbox stores file metadata; uploads write to local <code className="text-[11px] bg-muted px-1 py-0.5 rounded">/home/z/my-project/upload</code> with safe filenames + size validation (max 10MB).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Stats — category breakdown */}
      {data && data.stats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {CATEGORIES.filter((c) => c.value).map((c) => (
            <Card key={c.value} className="border-border/60">
              <CardContent className="p-3.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{c.label}</p>
                <p className="text-lg font-bold mt-0.5 nums">{byCategory[c.value] ?? 0}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <Toolbar>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title or description…"
                className="pl-9 h-9"
                aria-label="Search documents"
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
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full md:w-48 h-9" aria-label="Filter by category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value || 'all'} value={c.value || 'all'}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={accessFilter} onValueChange={setAccessFilter}>
              <SelectTrigger className="w-full md:w-48 h-9" aria-label="Filter by access level">
                <SelectValue placeholder="All access levels" />
              </SelectTrigger>
              <SelectContent>
                {ACCESS_LEVELS.map((a) => (
                  <SelectItem key={a.value || 'all'} value={a.value || 'all'}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => { setCategoryFilter(''); setAccessFilter(''); setSearch('') }} className="shrink-0 gap-2">
              <RefreshCw className="size-3.5" /> Reset
            </Button>
          </Toolbar>
        </CardContent>
      </Card>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load documents"
              description="Please try again or adjust your filters."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={FileText}
              title="No documents found"
              description={search || categoryFilter || accessFilter
                ? 'Try adjusting your filters.'
                : 'Upload your first document to share with the church.'}
              action={canCreate ? (
                <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-2">
                  <Upload className="size-4" /> Upload Document
                </Button>
              ) : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((d) => (
            <Card key={d.id} className="border-border/60 rounded-xl hover:shadow-premium-md hover:-translate-y-0.5 transition-all flex flex-col">
              <CardContent className="p-5 flex flex-col flex-1">
                <div className="flex items-start gap-3 mb-3">
                  <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-inset ring-primary/15">
                    <FileIcon filename={d.fileName} className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base leading-snug line-clamp-2" title={d.title}>{d.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 nums">v{d.version} · Updated {relativeTime(d.updatedAt)}</p>
                  </div>
                  {(canUpdate || canDelete) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Document actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canUpdate && (
                          <DropdownMenuItem onClick={() => openEdit(d.id)}>
                            <Pencil className="size-3.5 mr-2" /> Edit
                          </DropdownMenuItem>
                        )}
                        {d.downloadable && (
                          <DropdownMenuItem onClick={() => download(d)}>
                            <Download className="size-3.5 mr-2" /> Download
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <>
                            {(canUpdate || d.downloadable) && <DropdownMenuSeparator />}
                            <DropdownMenuItem onClick={() => openDelete(d.id, d.title)} className="text-destructive">
                              <Trash2 className="size-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {d.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3 flex-1">{d.description}</p>
                )}
                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  <Badge variant="outline" className={`text-[10px] font-medium ${CATEGORY_STYLES[d.category] ?? ''}`}>
                    {titleCase(d.category)}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] font-medium ${ACCESS_LEVEL_STYLES[d.accessLevel] ?? ''}`}>
                    {d.accessLevel === 'pastoral' || d.accessLevel === 'finance' ? <Lock className="size-3 mr-1" /> : null}
                    {titleCase(d.accessLevel)}
                  </Badge>
                  {d.downloadable && (
                    <Badge variant="outline" className="text-[10px] font-medium bg-muted text-muted-foreground">
                      <File className="size-3 mr-1" />
                      {(d.fileName ?? '').split('.').pop()?.toUpperCase() ?? 'FILE'}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border/60">
                  <span className="text-xs text-muted-foreground nums">{formatDate(d.createdAt)}</span>
                  {d.downloadable ? (
                    <Button size="sm" variant="outline" onClick={() => download(d)} className="gap-2">
                      <Download className="size-3.5" /> Download
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No file attached</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upload dialog */}
      {uploadOpen && (
        <DocumentFormDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onSaved={() => {
            setUploadOpen(false)
            queryClient.invalidateQueries({ queryKey: ['documents'] })
          }}
        />
      )}

      {/* Edit dialog */}
      {editOpen && editId && (
        <DocumentFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          editId={editId}
          onSaved={() => {
            setEditOpen(false)
            setEditId(null)
            queryClient.invalidateQueries({ queryKey: ['documents'] })
          }}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &quot;{deleteTitle}&quot; and its attached file. This cannot be undone.
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

// ---------- form dialog ----------
const ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'xlsx', 'pptx', 'txt', 'jpg', 'jpeg', 'png']
const MAX_FILE_MB = 10

function DocumentFormDialog({
  open, onOpenChange, editId, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editId?: string
  onSaved: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('policy')
  const [accessLevel, setAccessLevel] = useState('staff')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)

  useQuery({
    queryKey: ['document', editId] as const,
    queryFn: async () => {
      if (!editId) return null
      const res = await fetch(`/api/documents/${editId}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to load')
      }
      const d: DocumentItem = await res.json()
      setTitle(d.title)
      setDescription(d.description ?? '')
      setCategory(d.category)
      setAccessLevel(d.accessLevel)
      return d
    },
    enabled: !!editId && open,
  })

  useEffect(() => {
    if (!open && !editId) {
      setTitle('')
      setDescription('')
      setCategory('policy')
      setAccessLevel('staff')
      setFile(null)
    }
  }, [open, editId])

  const isEdit = !!editId

  const validateFile = (f: File): string | null => {
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      return `File too large. Max ${MAX_FILE_MB}MB.`
    }
    const ext = (f.name.split('.').pop() ?? '').toLowerCase()
    if (!ALLOWED_EXTS.includes(ext)) {
      return `File type .${ext || '???'} not allowed. Allowed: ${ALLOWED_EXTS.join(', ')}`
    }
    return null
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) {
      setFile(null)
      return
    }
    const err = validateFile(f)
    if (err) {
      toast.error(err)
      e.target.value = ''
      setFile(null)
      return
    }
    setFile(f)
  }

  const save = async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    setLoading(true)
    try {
      if (isEdit) {
        // Edit: only metadata — file replace is not supported via this dialog (would need a separate replace flow)
        const res = await fetch(`/api/documents/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            category,
            accessLevel,
          }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e.error || 'Save failed')
        }
        toast.success('Document updated')
        onSaved()
        return
      }
      // Create with multipart
      const form = new FormData()
      form.set('title', title.trim())
      form.set('description', description.trim())
      form.set('category', category)
      form.set('accessLevel', accessLevel)
      if (file) form.set('file', file)
      const res = await fetch('/api/documents', { method: 'POST', body: form })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Upload failed')
      }
      const data = await res.json()
      toast.success(file ? 'Document uploaded' : 'Document created')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Document' : 'Upload Document'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update document metadata. File replace is not supported here.'
              : 'Upload a file or create metadata-only entry. Access levels enforce server-side visibility.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="doc-title" className="text-sm font-medium">Title <span className="text-destructive">*</span></Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Volunteer Code of Conduct"
              className="mt-1.5 h-9"
              maxLength={200}
            />
          </div>
          <div>
            <Label htmlFor="doc-desc" className="text-sm font-medium">Description</Label>
            <Textarea
              id="doc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of the document…"
              rows={3}
              className="mt-1.5"
              maxLength={1000}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="doc-cat" className="text-sm font-medium">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="doc-cat" className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter((c) => c.value).map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="doc-access" className="text-sm font-medium">Access level</Label>
              <Select value={accessLevel} onValueChange={setAccessLevel}>
                <SelectTrigger id="doc-access" className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCESS_LEVELS.filter((a) => a.value).map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!isEdit && (
            <div>
              <Label htmlFor="doc-file" className="text-sm font-medium">File (optional)</Label>
              <div className="mt-1.5 border-2 border-dashed border-border/60 rounded-xl p-5 text-center hover:border-primary/40 transition-colors">
                <input
                  id="doc-file"
                  type="file"
                  onChange={onFileChange}
                  accept=".pdf,.doc,.docx,.xlsx,.pptx,.txt,.jpg,.jpeg,.png"
                  className="hidden"
                />
                <Label htmlFor="doc-file" className="cursor-pointer inline-flex flex-col items-center">
                  <Upload className="size-6 text-muted-foreground mb-2" />
                  <span className="text-sm font-medium">{file ? file.name : 'Click to choose a file'}</span>
                  <span className="text-xs text-muted-foreground mt-1">
                    Max {MAX_FILE_MB}MB · {ALLOWED_EXTS.join(', ')}
                  </span>
                </Label>
              </div>
              {file && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs">
                  <span className="truncate max-w-[80%]">{file.name}</span>
                  <span className="text-muted-foreground nums">{(file.size / 1024 / 1024).toFixed(2)}MB</span>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remove file"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="rounded-lg bg-muted/40 border border-border/60 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <Info className="size-3.5 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-foreground">Access levels:</span>{' '}
              public (everyone), members (member+), staff (church_admin/pastor/dept_head+), leaders (pastor/church_admin/dept_head), finance (finance_officer+), pastoral (pastor/super_admin).
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={save} disabled={loading || !title.trim()} className="gap-2">
            {loading ? 'Saving…' : isEdit ? 'Save changes' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
