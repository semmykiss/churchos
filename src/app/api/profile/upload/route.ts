// ChurchOS — Profile image upload API
// POST /api/profile/upload  (multipart/form-data, field "file")
//   - Validates image type (jpg/png/webp/gif) and size (≤5MB)
//   - Saves to /home/z/my-project/upload/ with a unique name
//   - Returns { url } — relative path served via /upload/* through Caddy/static handler.
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, audit, apiHandler } from '@/lib/api'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

const UPLOAD_DIR = '/home/z/my-project/upload'
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

function getExtension(mime: string, filename: string): string {
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  if (byMime[mime]) return byMime[mime]
  const ext = path.extname(filename || '').toLowerCase().replace(/^\./, '')
  return ALLOWED_EXTS.has(ext) ? ext : 'bin'
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const form = await req.formData()
  const file = form.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart field "file")' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB)` }, { status: 413 })
  }
  // Type validation — accept either declared mime or filename extension
  const declaredType = file.type || ''
  const okMime = ALLOWED_TYPES.has(declaredType)
  const ext = getExtension(declaredType, file.name)
  const okExt = ALLOWED_EXTS.has(ext)
  if (!okMime && !okExt) {
    return NextResponse.json({ error: 'Unsupported file type. Allowed: jpg, png, webp, gif.' }, { status: 415 })
  }
  // Magic-byte sniff for additional safety (best-effort, not exhaustive)
  const arrayBuf = await file.arrayBuffer()
  const head = new Uint8Array(arrayBuf.slice(0, 12))
  const sniffed = sniffImageType(head)
  if (!sniffed) {
    return NextResponse.json({ error: 'File content does not match an allowed image type.' }, { status: 415 })
  }

  await mkdir(UPLOAD_DIR, { recursive: true })
  const random = randomBytes(12).toString('hex')
  const safeName = `profile-${ctx.user.id}-${Date.now()}-${random}.${sniffed}`
  const fullPath = path.join(UPLOAD_DIR, safeName)
  await writeFile(fullPath, Buffer.from(arrayBuf))

  // Public URL — served via /upload/* route below (relative path).
  const url = `/upload/${safeName}`

  await audit(ctx, 'profile.upload', 'user', ctx.user.id, {
    size: file.size, type: sniffed, name: safeName,
  })

  return NextResponse.json({ url, ok: true, size: file.size }, { status: 201 })
})

function sniffImageType(head: Uint8Array): string | null {
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) return 'png'
  // GIF: 47 49 46 38 (GIF8)
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return 'gif'
  // WEBP: starts with RIFF....WEBP
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return 'webp'
  return null
}
