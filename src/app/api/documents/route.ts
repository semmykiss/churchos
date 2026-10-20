// ChurchOS — Document Library API
// GET  /api/documents         — list documents filtered by accessLevel/category (server-enforced role access)
// POST /api/documents         — create document metadata + optional file upload (multipart/form-data)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = ['policy', 'template', 'minutes', 'form', 'report', 'resource'] as const
const VALID_ACCESS_LEVELS = ['public', 'members', 'staff', 'leaders', 'finance', 'pastoral'] as const
type AccessLevel = (typeof VALID_ACCESS_LEVELS)[number]

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xlsx', 'pptx', 'txt', 'jpg', 'jpeg', 'png']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const UPLOAD_DIR = '/home/z/my-project/upload'

// role -> set of access levels that role can view
const ACCESS_MATRIX: Record<string, AccessLevel[]> = {
  super_admin: ['public', 'members', 'staff', 'leaders', 'finance', 'pastoral'],
  church_admin: ['public', 'members', 'staff', 'leaders', 'finance'],
  pastor: ['public', 'members', 'staff', 'leaders', 'pastoral'],
  finance_officer: ['public', 'members', 'staff', 'finance'],
  department_head: ['public', 'members', 'staff', 'leaders'],
  department_assistant: ['public', 'members', 'staff'],
  unit_leader: ['public', 'members', 'staff'],
  member: ['public', 'members'],
  guest: ['public'],
}

function canAccess(role: string, level: string): boolean {
  const allowed = ACCESS_MATRIX[role] ?? ['public']
  return allowed.includes(level as AccessLevel)
}

interface ListResponse {
  items: any[]
  total: number
  stats: { total: number; byCategory: Record<string, number> }
}

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('documents', 'view')
  const { organizationId, role } = ctx

  const sp = req.nextUrl.searchParams
  const category = sp.get('category') ?? ''
  const accessLevel = sp.get('accessLevel') ?? ''
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

  // Server-side access filter — role determines which access levels are visible
  const visibleLevels = ACCESS_MATRIX[role] ?? ['public']
  const where: any = { organizationId, accessLevel: { in: visibleLevels } }
  if (category && VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    where.category = category
  }
  if (accessLevel && VALID_ACCESS_LEVELS.includes(accessLevel as AccessLevel)) {
    where.accessLevel = accessLevel
  }
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
    ]
  }

  const [items, total, categoryGroups] = await Promise.all([
    db.document.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.document.count({ where }),
    db.document.groupBy({
      by: ['category'],
      where: { organizationId, accessLevel: { in: visibleLevels } },
      _count: true,
    }),
  ])

  const byCategory: Record<string, number> = {}
  categoryGroups.forEach((g) => (byCategory[g.category] = g._count))

  return NextResponse.json({
    items: items.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      category: d.category,
      accessLevel: d.accessLevel,
      fileUrl: d.fileUrl,
      fileName: d.fileName,
      version: d.version,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      downloadable: !!d.fileUrl,
    })),
    total,
    page,
    pageSize,
    stats: { total, byCategory },
  } as ListResponse)
})

interface CreateBody {
  title?: string
  description?: string
  category?: string
  accessLevel?: string
}

function safeFileName(original: string): string {
  // Strip path separators + dangerous chars; lowercase; collapse spaces
  const base = original.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_')
  return `${Date.now()}_${base.toLowerCase()}`
}

function getExtension(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('documents', 'create')
  const { organizationId, role } = ctx

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const title = (form.get('title') as string | null)?.trim()
  const description = (form.get('description') as string | null)?.trim() || null
  const category = (form.get('category') as string | null) ?? 'policy'
  const accessLevel = (form.get('accessLevel') as string | null) ?? 'staff'

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }
  if (!VALID_ACCESS_LEVELS.includes(accessLevel as AccessLevel)) {
    return NextResponse.json({ error: 'Invalid accessLevel' }, { status: 400 })
  }

  // Cannot create a doc with a level higher than what you can access
  if (!canAccess(role, accessLevel)) {
    return NextResponse.json(
      { error: `You cannot create a document with accessLevel "${accessLevel}"` },
      { status: 403 },
    )
  }

  // File upload (optional)
  const file = form.get('file') as File | null
  let fileUrl: string | null = null
  let fileName: string | null = null

  if (file && typeof file === 'object' && file.size > 0) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 400 },
      )
    }
    const ext = getExtension(file.name)
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `File type .${ext || '???'} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` },
        { status: 400 },
      )
    }
    const fs = await import('fs/promises')
    const path = await import('path')
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    const safeName = safeFileName(file.name)
    const fullPath = path.join(UPLOAD_DIR, safeName)
    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(fullPath, buffer)
    fileUrl = safeName
    fileName = file.name
  }

  const created = await db.document.create({
    data: {
      organizationId,
      title,
      description,
      category,
      accessLevel,
      fileUrl,
      fileName,
      version: 1,
    },
  })

  await audit(ctx, 'documents.create', 'document', created.id, {
    title,
    category,
    accessLevel,
    hasFile: !!fileUrl,
    fileName,
  })

  return NextResponse.json(
    {
      id: created.id,
      title: created.title,
      description: created.description,
      category: created.category,
      accessLevel: created.accessLevel,
      fileUrl: created.fileUrl,
      fileName: created.fileName,
      version: created.version,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    },
    { status: 201 },
  )
})
