// ChurchOS — Upload static serving route
// GET /upload/[file] — serves files from /home/z/my-project/upload/
// Used for profile avatars and other user-uploaded images.
import { NextResponse, type NextRequest } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-static'

const UPLOAD_DIR = '/home/z/my-project/upload'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  // Reject any path traversal attempts
  if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) {
    return new NextResponse('Not found', { status: 404 })
  }
  const ext = path.extname(file).toLowerCase().replace(/^\./, '')
  const mime = MIME[ext] ?? 'application/octet-stream'
  const fullPath = path.join(UPLOAD_DIR, file)
  try {
    const info = await stat(fullPath)
    if (!info.isFile()) return new NextResponse('Not found', { status: 404 })
    const buf = await readFile(fullPath)
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=86400, immutable',
        'Content-Length': String(buf.length),
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
