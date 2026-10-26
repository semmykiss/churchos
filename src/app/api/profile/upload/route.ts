// ChurchOS — Avatar upload API
// POST /api/profile/upload (multipart/form-data, field "file")
// Validates the image (PNG/JPEG/WebP/GIF, ≤400KB), converts it to a base64
// data URL, and persists it to the logged-in user's avatarUrl. Data-URL
// storage keeps this serverless-safe (no filesystem writes). Returns { url, ok }.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 400 * 1024

// Extension per allowed content type — used to build the data URL.
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data with a "file" field.' },
      { status: 400 },
    )
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing "file" field.' }, { status: 400 })
  }

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) {
    return NextResponse.json(
      { error: 'Unsupported image type. Use PNG, JPEG, WebP, or GIF.' },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image is too large (max 400KB).' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length === 0) {
    return NextResponse.json({ error: 'Uploaded file is empty.' }, { status: 400 })
  }

  const url = `data:image/${ext};base64,${buffer.toString('base64')}`

  const updated = await db.user.update({
    where: { id: ctx.user.id },
    data: { avatarUrl: url },
    select: { id: true, avatarUrl: true },
  })

  await audit(ctx, 'profile.avatar.upload', 'user', ctx.user.id, {
    type: file.type,
    size: file.size,
  })

  return NextResponse.json({ url: updated.avatarUrl, ok: true })
})
