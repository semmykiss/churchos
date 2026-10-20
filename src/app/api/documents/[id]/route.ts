// ChurchOS — Document detail API
// GET    /api/documents/[id]             — metadata (access-level gated)
// GET    /api/documents/[id]?download=1  — stream file (permission-checked)
// PATCH  /api/documents/[id]             — update metadata/accessLevel; bump version on file/content change
// DELETE /api/documents/[id]             — delete document + remove file (audit)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = ['policy', 'template', 'minutes', 'form', 'report', 'resource'] as const
const VALID_ACCESS_LEVELS = ['public', 'members', 'staff', 'leaders', 'finance', 'pastoral'] as const
type AccessLevel = (typeof VALID_ACCESS_LEVELS)[number]

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

const UPLOAD_DIR = '/home/z/my-project/upload'

type Ctx = Awaited<ReturnType<typeof requirePermission>>

async function getScoped(id: string, ctx: Ctx) {
  return db.document.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
}

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

function getExtension(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
}

export const GET = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('documents', 'view')
    const { id } = await params
    const d = await getScoped(id, ctx)
    if (!d) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    // Access-level gate
    if (!canAccess(ctx.role, d.accessLevel)) {
      return NextResponse.json(
        { error: 'You do not have permission to access this document.' },
        { status: 403 },
      )
    }

    const download = req.nextUrl.searchParams.get('download') === '1'
    if (download) {
      if (!d.fileUrl) {
        return NextResponse.json({ error: 'No file attached' }, { status: 404 })
      }
      const fs = await import('fs/promises')
      const path = await import('path')
      const fullPath = path.join(UPLOAD_DIR, d.fileUrl)
      try {
        const buf = await fs.readFile(fullPath)
        const ext = getExtension(d.fileName ?? d.fileUrl)
        const mime = MIME_MAP[ext] ?? 'application/octet-stream'
        // Audit download
        await audit(ctx, 'documents.download', 'document', d.id, { fileName: d.fileName })
        return new NextResponse(buf, {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(buf.length),
            'Content-Disposition': `attachment; filename="${(d.fileName ?? d.fileUrl).replace(/[^\x20-\x7E]/g, '_')}"`,
            'Cache-Control': 'private, no-cache',
          },
        })
      } catch (e: any) {
        if (e?.code === 'ENOENT') {
          return NextResponse.json({ error: 'File not found on disk' }, { status: 410 })
        }
        throw e
      }
    }

    return NextResponse.json({
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
      downloadUrl: d.fileUrl ? `/api/documents/${d.id}?download=1` : null,
    })
  },
)

interface PatchBody {
  title?: string
  description?: string | null
  category?: string
  accessLevel?: string
  bumpVersion?: boolean
}

export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('documents', 'update')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody
    const existing = await getScoped(id, ctx)
    if (!existing) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
      }
      data.title = body.title.trim()
    }
    if (body.description !== undefined) {
      data.description = typeof body.description === 'string' ? body.description.trim() : null
    }
    if (body.category !== undefined) {
      if (!VALID_CATEGORIES.includes(body.category as (typeof VALID_CATEGORIES)[number])) {
        return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
      }
      data.category = body.category
    }
    if (body.accessLevel !== undefined) {
      if (!VALID_ACCESS_LEVELS.includes(body.accessLevel as AccessLevel)) {
        return NextResponse.json({ error: 'Invalid accessLevel' }, { status: 400 })
      }
      if (!canAccess(ctx.role, body.accessLevel)) {
        return NextResponse.json(
          { error: `You cannot set accessLevel "${body.accessLevel}"` },
          { status: 403 },
        )
      }
      data.accessLevel = body.accessLevel
    }

    // Bump version on content change (title/description/category/accessLevel)
    const contentChanged =
      body.title !== undefined ||
      body.description !== undefined ||
      body.category !== undefined ||
      body.accessLevel !== undefined ||
      body.bumpVersion === true

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ id: existing.id, ok: true, version: existing.version })
    }

    if (contentChanged) {
      data.version = (existing.version ?? 1) + 1
    }

    const updated = await db.document.update({ where: { id }, data })

    await audit(ctx, 'documents.update', 'document', id, {
      fields: Object.keys(data),
      versionBumped: contentChanged,
      version: updated.version,
    })

    return NextResponse.json({ id: updated.id, ok: true, version: updated.version })
  },
)

export const DELETE = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requirePermission('documents', 'delete')
    const { id } = await params
    const existing = await getScoped(id, ctx)
    if (!existing) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    // Remove file from disk if attached
    if (existing.fileUrl) {
      const fs = await import('fs/promises')
      const path = await import('path')
      const fullPath = path.join(UPLOAD_DIR, existing.fileUrl)
      try {
        await fs.unlink(fullPath)
      } catch (e: any) {
        if (e?.code !== 'ENOENT') {
          console.error('[documents] failed to delete file', e)
        }
      }
    }
    await db.document.delete({ where: { id } })
    await audit(ctx, 'documents.delete', 'document', id, {
      title: existing.title,
      fileName: existing.fileName,
    })
    return NextResponse.json({ ok: true, id })
  },
)
