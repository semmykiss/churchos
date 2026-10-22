// ChurchOS — Profile image upload API
// POST /api/profile/upload (multipart/form-data, field "file")
import { NextResponse, type NextRequest } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { requireUser, audit, apiHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requireUser()
  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  const file = formData.get('file')
  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
  const ext = ALLOWED[file.type]
  if (!ext) return NextResponse.json({ error: 'Invalid file type. Allowed: jpg, png, webp, gif.' }, { status: 400 })

  const uploadDir = '/home/z/my-project/upload'
  await mkdir(uploadDir, { recursive: true })
  const fileName = `profile-${ctx.user.id}-${Date.now()}.${ext}`
  const filePath = path.join(uploadDir, fileName)
  const arrayBuffer = await file.arrayBuffer()
  await writeFile(filePath, Buffer.from(arrayBuffer))
  const urlPath = `/upload/${fileName}`

  await audit(ctx, 'profile.avatar.upload', 'user', ctx.user.id, { fileName, size: file.size, type: file.type })
  return NextResponse.json({ url: urlPath, fileName, size: file.size }, { status: 201 })
})
